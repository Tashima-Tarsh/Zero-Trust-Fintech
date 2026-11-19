'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {spawn}=require('node:child_process'),{Pool}=require('pg');
(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['127.0.0.1','localhost','::1'].includes(new URL(url).hostname))
  throw Error('Quantum Signal HTTP test requires disposable localhost PostgreSQL');
 const pg=new Pool({connectionString:url,max:4});
 const port=30000+crypto.randomInt(20000),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),
  env:{...process.env,PORT:String(port),DB_BACKEND:'postgres',DATABASE_URL:url,
   MERCHANT_UPI_ID:'qa-receiver@oksbi',NODE_ENV:'test',APP_URL:base,WEBAUTHN_RP_ORIGIN:base},
  stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const rows=[],rnd=()=>crypto.randomBytes(8).toString('hex');
 async function create(kind){
  const id='PAY_QS_'+rnd(),token=crypto.randomBytes(24).toString('hex'),
   vault=crypto.randomBytes(16).toString('hex'),ts=Date.now(),
   pa=kind==='P2M'?'test-store@ypbiz':'qa-receiver@oksbi',tr='PAYQS'+rnd();
  const uri='upi://pay?pa='+encodeURIComponent(pa)+'&pn=DISHA&am=1.00&cu=INR'+
    (kind==='P2M'?'&mc=5411&tr='+tr:'');
  await pg.query('INSERT INTO sessions(session_id,order_id,challenge_amount,base_amount,txn_ref,'+
   "vpa_address,upi_uri,status,state,created_at,expires_at,qr_refresh_at) VALUES"+
   "($1,$2,'1.00','1.00',$3,$4,$5,'PENDING','WAITING',$6,$7,$8)",
   [token,id,tr,pa,uri,ts,ts+180000,ts+15000]);
  rows.push({id,vault});
  return {id,token,vault,pa};
 }
 async function grant(o){
  const h=crypto.createHash('sha256').update(o.token).digest('hex');
  await pg.query('INSERT INTO disha_vault_authorizations(vault_session_id,order_id,'+
   'checkout_token_hash,authorized_at,expires_at) VALUES($1,$2,$3,$4,$5)',
   [o.vault,o.id,h,Date.now(),Date.now()+180000]);
 }
 async function call(route,body,token){
  const r=await fetch(base+'/api/quantum-signal/'+route,{method:'POST',headers:{
   'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})},
   body:JSON.stringify(body),signal:AbortSignal.timeout(9000)});
  return {http:r.status,body:await r.json()};
 }
 const start=o=>({orderId:o.id,token:o.token,vaultSessionId:o.vault});
 const event=(o,nonce,params={},kind='RETURN',eventId='qs_'+crypto.randomBytes(16).toString('hex'))=>
  ({orderId:o.id,token:o.token,nonce,eventKind:kind,eventId,app:'gpay',returnParams:params});
 try{
  let ready=false;
  for(let i=0;i<75;i++){
   if(child.exitCode!==null)throw Error('Server stopped: '+logs.slice(-3200));
   try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(300)});if(r.ok){ready=true;break}}catch(_){}
   await new Promise(r=>setTimeout(r,120));
  }
  assert.ok(ready,'Server failed: '+logs.slice(-3200));
  const a=await create('P2P'),b=await create('P2M');
  let r=await call('start',start(a),a.token);
  assert.equal(r.http,403,'No forged Vault authorization');
  await grant(a);await grant(b);
  assert.equal((await call('start',start(a),'BAD')).http,403,'CSRF required');
  assert.equal((await call('start',{...start(a),vaultSessionId:b.vault},a.token)).http,403,
   'Vault of other order must fail');
  r=await call('start',start(a),a.token);
  assert.equal(r.http,201,JSON.stringify(r));
  assert.equal(r.body.paymentType,'P2P');
  const nonceA=r.body.nonce;
  assert.equal((await call('start',start(a),a.token)).body.nonce,nonceA,'Idempotent start');
  assert.equal((await call('event',event(a,nonceA,{},'HANDOFF'),a.token)).http,403,
   'Events must be forbidden before server challenge acknowledgement');
  const cha=await call('challenge',{orderId:a.id,token:a.token,nonce:nonceA},a.token);
  assert.equal(cha.http,201,JSON.stringify(cha));
  assert.equal(cha.body.protocol,'DISHA-SIGNAL-V1');
  const ackA={orderId:a.id,token:a.token,nonce:nonceA,
   challengeId:cha.body.challengeId,challenge:cha.body.challenge};
  assert.equal((await call('ack',{...ackA,challenge:'0'.repeat(48)},a.token)).http,403,
   'Incorrect challenge ACK must fail');
  assert.equal((await call('ack',ackA,b.token)).http,403,'Cross-session ACK must fail');
  assert.equal((await call('ack',ackA,a.token)).body.acknowledged,true);
  assert.equal((await call('ack',ackA,a.token)).body.acknowledged,true,'Idempotent ACK');
  assert.equal((await call('event',event(a,nonceA,{},'HANDOFF'),a.token)).http,202);
  const result=event(a,nonceA,{Status:'SUCCESS',txnId:'123456789012',am:'1.00',pa:a.pa});
  r=await call('event',result,a.token);
  assert.equal(r.http,202);
  assert.equal(r.body.eventState,'UTR_CANDIDATE_UNVERIFIED');
  assert.equal(r.body.decision,'UNKNOWN','Browser success is not a trusted result');
  assert.equal((await call('event',result,a.token)).body.replayed,true);
  assert.equal((await call('event',{...result,returnParams:{txnId:'999999999999'}},a.token)).http,409,
   'Changed replay must fail');
  r=await call('event',event(a,nonceA,{am:'5.00'}),a.token);
  assert.equal(r.body.decision,'NO','Amount mismatch');
  assert.equal(r.body.eventState,'CONFLICTING_EVIDENCE');
  const status=await fetch(base+'/api/quantum-signal/status/'+a.id+'?token='+a.token);
  assert.equal(status.status,200);
  assert.equal((await status.json()).initialized,true);
  r=await call('start',{orderId:b.id,token:b.token},b.token);
  assert.equal(r.http,201);
  assert.equal(r.body.paymentType,'P2M','P2M cannot downgrade to P2P');
  assert.equal(r.body.authorizationMode,'SESSION','No second Vault gesture in P2M preflight');
  const nonceB=r.body.nonce;
  const chb=await call('challenge',{orderId:b.id,token:b.token,nonce:nonceB},b.token);
  assert.equal(chb.http,201);
  assert.equal((await call('ack',{orderId:b.id,token:b.token,nonce:nonceB,
   challengeId:chb.body.challengeId,challenge:chb.body.challenge},b.token)).body.acknowledged,true);
  r=await call('event',event(b,nonceB,{txnId:'123456789012',am:'1.00',pa:b.pa}),b.token);
  assert.equal(r.body.decision,'NO');
  assert.equal(r.body.eventState,'CONFLICTING_EVIDENCE','UTR reuse on another order');
  r=await call('event',event(b,nonceB,{}),b.token);
  assert.equal(r.body.eventState,'RETURN_OBSERVED_NO_UTR');
  assert.equal((await call('event',event(b,nonceB,{}),null)).http,403);
  for(const o of [a,b]){
   const s=(await pg.query('SELECT status,utr FROM sessions WHERE order_id=$1',[o.id])).rows[0];
   assert.equal(s.status,'PENDING');assert.equal(s.utr,null);
   assert.equal((await pg.query('SELECT count(*)::int n FROM transactions WHERE order_id=$1',[o.id])).rows[0].n,0);
   assert.equal((await pg.query('SELECT count(*)::int n FROM disha_core_journals WHERE order_id=$1',[o.id])).rows[0].n,0);
  }
  console.log('QUANTUM_SIGNAL_POSTGRES_PASS: order twin, both modes, WebAuthn binding, CSRF, replay, duplicate UTR, no false credit');
 }finally{
  child.kill('SIGTERM');
  await new Promise(r=>{if(child.exitCode!==null)r();else{child.once('exit',r);setTimeout(r,2500)}});
  for(const o of rows){
   await pg.query('DELETE FROM disha_quantum_events WHERE order_id=$1',[o.id]).catch(()=>{});
   await pg.query('DELETE FROM disha_quantum_twins WHERE order_id=$1',[o.id]).catch(()=>{});
   await pg.query('DELETE FROM disha_vault_authorizations WHERE vault_session_id=$1',[o.vault]).catch(()=>{});
   await pg.query('DELETE FROM sessions WHERE order_id=$1',[o.id]).catch(()=>{});
  }
  await pg.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
