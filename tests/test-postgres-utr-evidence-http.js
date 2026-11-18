'use strict';
/** Actual Express + disposable PostgreSQL: customer-supplied UTR cannot mint money.
 * No bank, gateway, provider, financial keys or real transfer. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const {Pool}=require('pg');

(async()=>{
 const dburl=process.env.TEST_DATABASE_URL;
 if(!dburl||!['127.0.0.1','localhost','::1'].includes(new URL(dburl).hostname))
   throw new Error('UTR safety HTTP tests may ONLY use disposable localhost PostgreSQL');
 const pool=new Pool({connectionString:dburl,max:2});
 const port=29000+crypto.randomInt(8000);
 const base='http://127.0.0.1:'+port;
 const app=spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,PORT:String(port),DB_BACKEND:'postgres',DATABASE_URL:dburl,
   MERCHANT_UPI_ID:'qa-receiver@oksbi',NODE_ENV:'test',APP_URL:base,WEBAUTHN_RP_ORIGIN:base},
  stdio:['ignore','pipe','pipe']
 });
 let serverLog='';app.stdout.on('data',b=>serverLog+=b.toString());
 app.stderr.on('data',b=>serverLog+=b.toString());
 const uniq=()=>crypto.randomBytes(6).toString('hex').toUpperCase();
 const cases=[];
 async function createCase(){
  const id='ORD_UTR_'+uniq();
  const token=crypto.randomBytes(24).toString('hex');
  const utr=String(crypto.randomInt(100000000000,999999999999));
  const t=Date.now();
  await pool.query(
   "INSERT INTO sessions(session_id,order_id,challenge_amount,base_amount,txn_ref,vpa_address,status,state,created_at,expires_at,qr_refresh_at) "+
   "VALUES($1,$2,$3,$3,$4,$5,'PENDING','VERIFY_WINDOW',$6,$7,$8)",
   [token,id,'499.01','TXN_'+uniq(),'qa-receiver@oksbi',t-30000,t+150000,t+20000]);
  cases.push({id,token,utr});
  return {id,token,utr};
 }
 async function send(url,body,options={}){
  const res=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json',...(options.headers||{})},
   body:JSON.stringify(body),signal:AbortSignal.timeout(9000)});
  return {status:res.status,data:await res.json()};
 }
 async function assertNoMoney(orders){
  for(const o of orders){
   const s=(await pool.query("SELECT status,state FROM sessions WHERE order_id=$1",[o.id])).rows[0];
   assert.equal(s.status,'PENDING','A mere UTR must not mark paid: '+o.id);
   assert.notEqual(s.state,'VERIFIED');
   const t=await pool.query('SELECT count(*)::int AS n FROM transactions WHERE order_id=$1',[o.id]);
   assert.equal(t.rows[0].n,0,'No COMPLETED transaction from unverified reference');
   const j=await pool.query('SELECT count(*)::int AS n FROM disha_core_journals WHERE order_id=$1',[o.id]);
   assert.equal(j.rows[0].n,0,'No financial journal from unverified reference');
  }
 }
 try {
  let ready=false;
  for(let i=0;i<60;i++){
   if(app.exitCode!==null)throw Error('Express exited: '+serverLog.slice(-3000));
   try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break}}catch(_){}
   await new Promise(resolve=>setTimeout(resolve,110));
  }
  assert.ok(ready,'Express not ready: '+serverLog.slice(-3500));
  const receiptCase=await createCase();
  const fakeReceipt='UPI Payment Successful\nDISHA QA Merchant\nTo: qa-receiver@oksbi\nAmount INR 499.01\nUTR: '+receiptCase.utr+'\nDate: Today';
  const rec=await send('/api/verify',{utr:receiptCase.utr,amount:'499.01',orderId:receiptCase.id,receipt:fakeReceipt});
  assert.equal(rec.status,202,'Fake 95-point receipt must not authorize payment: '+JSON.stringify(rec));
  assert.equal(rec.data.verified,false);
  assert.equal(rec.data.state,'UTR_OBSERVED');
  console.log('PASS untrusted SUCCESS receipt: observation only');

  const cfc=await createCase();
  const claim=await send('/api/verify-cfc',{utr:cfc.utr,orderId:cfc.id,token:cfc.token},
    {headers:{'X-CSRF-Token':cfc.token}});
  assert.equal(claim.status,202,'12-digit UTR and session token cannot mint a ledger entry: '+JSON.stringify(claim));
  assert.equal(claim.data.verified,false);
  assert.equal(claim.data.state,'UTR_OBSERVED');
  console.log('PASS UTR-only CFC: no success/credit');

  const other=await createCase();
  const replay=await send('/api/verify-cfc',{utr:cfc.utr,orderId:other.id,token:other.token},
    {headers:{'X-CSRF-Token':other.token}});
  assert.equal(replay.status,400);
  assert.equal(replay.data.error,'UTR_BOUND_TO_OTHER_ORDER');
  console.log('PASS cross-order UTR replay rejected');

  const share=await createCase();
  const shared='UPI Payment Successful\nTo: qa-receiver@oksbi\nAmount INR 499.01\nUTR: '+
   share.utr+'\nOrder ID: '+share.id;
  const sharedResult=await send('/handle-share',{text:shared});
  assert.equal(sharedResult.status,202,'Share-target return is not bank credit: '+JSON.stringify(sharedResult));
  assert.equal(sharedResult.data.verified,false);
  console.log('PASS Android share-sheet claim: observation only');

  const callback=await send('/api/npci-callback',
   {Status:'SUCCESS',responseCode:'00',txnId:'631902884112',amount:'499.01'});
  assert.equal(callback.status,202,'Public callback parameters cannot be official proof');
  assert.equal(callback.data.verified,false);
  assert.equal(callback.data.status,'UTR_OBSERVED');
  console.log('PASS spoofed NPCI callback: no fake success');

  const gaming=await send('/api/gaming/verify-payment',{utr:'631902884112',amount:'499.01'});
  assert.ok([403,409].includes(gaming.status),
    'Legacy gaming claim must be refused by IP access guard (403) or settlement guard (409); observed '+gaming.status);
  if(gaming.status===409)assert.equal(gaming.data.verified,false);
  console.log('PASS legacy direct UTR gaming claim blocked (HTTP '+gaming.status+')');

  await assertNoMoney(cases);
  console.log('UTR_POSTGRES_E2E_SECURITY_PASS: no sessions SUCCESS, no journals, no transactions.');
 }finally{
  app.kill('SIGTERM');
  await new Promise(resolve=>{
   if(app.exitCode!==null)resolve();
   else{app.once('exit',resolve);setTimeout(resolve,2500);}
  });
  await pool.end();
 }
})().catch(err=>{console.error(err);process.exitCode=1});
