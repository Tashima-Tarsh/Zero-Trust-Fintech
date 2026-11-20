'use strict';
// Actual Express + disposable localhost PostgreSQL: a verified Vault authorizes
// browser-evidence storage but NEVER a financial credit. WebAuthn authorization
// rows below are synthetic CI fixtures (not a mocked bank transaction).
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {Pool}=require('pg');

async function findAvailablePort(){
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',resolve);
  });
  const port=probe.address().port;
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))
    throw Error('Vault evidence HTTP tests must use disposable localhost PostgreSQL');
  const pg=new Pool({connectionString:url,max:3});
  const port=await findAvailablePort(),base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..'),
    env:{...process.env,PORT:String(port),DB_BACKEND:'postgres',DATABASE_URL:url,
      MERCHANT_UPI_ID:'qa-receiver@oksbi',NODE_ENV:'test',APP_URL:base,
      WEBAUTHN_RP_ORIGIN:base},
    stdio:['ignore','pipe','pipe']
  });
  let logs='';
  server.stdout.on('data',v=>logs+=v.toString());
  server.stderr.on('data',v=>logs+=v.toString());
  const rand=()=>crypto.randomBytes(8).toString('hex');
  const utr=()=>String(crypto.randomInt(100000000000,999999999999));
  async function makeOrder(){
    const orderId='ORD_VAULT_'+rand();
    const token=crypto.randomBytes(24).toString('hex');
    const vault=crypto.randomBytes(16).toString('hex');
    const created=Date.now()-30000,expires=created+180000;
    await pg.query(
      'INSERT INTO sessions(session_id,order_id,challenge_amount,base_amount,txn_ref,'+
      "vpa_address,status,state,created_at,expires_at,qr_refresh_at) "+
      "VALUES($1,$2,'500.01','500.01',$3,'qa-receiver@oksbi','PENDING','VERIFY_WINDOW',$4,$5,$6)",
      [token,orderId,'TXN_'+rand(),created,expires,created+15000]);
    return {orderId,token,vault,created,expires};
  }
  async function authorize(order){
    const hash=crypto.createHash('sha256').update(order.token).digest('hex');
    await pg.query(
      'INSERT INTO disha_vault_authorizations(vault_session_id,order_id,'+
      'checkout_token_hash,authorized_at,expires_at) VALUES($1,$2,$3,$4,$5)',
      [order.vault,order.orderId,hash,Date.now(),Date.now()+300000]);
  }
  const packet=(o,fields={})=>{
    const now=Date.now();
    return {orderId:o.orderId,vaultSessionId:o.vault,token:o.token,eventId:'event_'+rand(),
      evidence:{browserEvent:'APP_RESUME',handoffAt:now-15000,hiddenAt:now-10000,
        returnedAt:now,selectedApp:'phonepe',returnParams:{...fields}}};
  };
  async function send(p,csrf=p.token){
    const r=await fetch(base+'/api/vault/evidence',{
      method:'POST',headers:{'Content-Type':'application/json',
        ...(csrf?{'X-CSRF-Token':csrf}:{})},
      body:JSON.stringify(p),signal:AbortSignal.timeout(8000)});
    return {status:r.status,data:await r.json()};
  }
  try{
    let ready=false;
    for(let i=0;i<70;i++){
      if(server.exitCode!==null)throw Error('Server crashed '+logs.slice(-3000));
      try{const health=await fetch(base+'/health',{signal:AbortSignal.timeout(350)});
        if(health.ok){ready=true;break}}catch(_){}
      await new Promise(r=>setTimeout(r,120));
    }
    assert.ok(ready,'Server did not start: '+logs.slice(-3000));
    const one=await makeOrder();
    const claim=packet(one,{Status:'SUCCESS',txnId:utr(),am:'500.01',pa:'qa-receiver@oksbi'});
    let r=await send(claim);
    assert.equal(r.status,403,'No WebAuthn-authenticated Vault row means no evidence acceptance');
    await authorize(one);
    r=await send(claim,null);
    assert.equal(r.status,403,'POST must carry matching CSRF header');
    r=await send({...claim,token:'a'.repeat(48)},'a'.repeat(48));
    assert.equal(r.status,403);
    r=await send(claim);
    assert.equal(r.status,202,JSON.stringify(r));
    assert.equal(r.data.state,'UTR_CANDIDATE_UNVERIFIED');
    assert.equal(r.data.utrCandidate,claim.evidence.returnParams.txnId);
    assert.equal(r.data.verified,false);
    assert.equal(r.data.settled,false);
    assert.equal(r.data.correlation.temporalGate,'OBSERVATION_WINDOW');
    assert.equal(r.data.correlation.selectedApp,'phonepe');
    assert.equal(r.data.correlation.browserAppReturnMs,15000);
    assert.equal(r.data.correlation.withinCheckoutWindow,true);
    r=await send(claim);
    assert.equal(r.data.replayed,true);
    r=await send({...claim,evidence:{...claim.evidence,returnParams:{Status:'SUCCESS'}}});
    assert.equal(r.status,409,'Same event ID with different evidence must be rejected');

    const other=await makeOrder();
    await authorize(other);
    r=await send(packet(other,{Status:'SUCCESS',txnId:claim.evidence.returnParams.txnId}));
    assert.equal(r.status,202);
    assert.equal(r.data.state,'CONFLICTING_EVIDENCE','Candidate UTR replay must be flagged');
    r=await send(packet(other,{am:'500.02'}));
    assert.equal(r.data.state,'CONFLICTING_EVIDENCE','Amount mismatch must be flagged');
    r=await send(packet(other,{pa:'attacker@upi'}));
    assert.equal(r.data.state,'CONFLICTING_EVIDENCE','Payee mismatch must be flagged');
    r=await send(packet(other,{}));
    assert.equal(r.data.state,'RETURN_OBSERVED_NO_UTR','Browser return cannot invent UTR');
    const noVault=await makeOrder();
    r=await send(packet(noVault));
    assert.equal(r.status,403);
    const cross={...packet(other),orderId:one.orderId};
    r=await send(cross);
    assert.equal(r.status,403,'Vault order mismatch must reject');

    for(const o of [one,other,noVault]){
      const state=(await pg.query('SELECT status,state,utr FROM sessions WHERE order_id=$1',[o.orderId])).rows[0];
      assert.equal(state.status,'PENDING');
      assert.notEqual(state.state,'VERIFIED');
      const tx=(await pg.query('SELECT count(*)::int n FROM transactions WHERE order_id=$1',[o.orderId])).rows[0];
      assert.equal(tx.n,0);
      const journal=(await pg.query('SELECT count(*)::int n FROM disha_core_journals WHERE order_id=$1',[o.orderId])).rows[0];
      assert.equal(journal.n,0);
    }
    const evidenceRows=(await pg.query('SELECT count(*)::int n FROM disha_vault_evidence WHERE order_id=$1',
      [one.orderId])).rows[0];
    assert.equal(evidenceRows.n,1,'Replay must not duplicate evidence record');
    // Native Android UPI activity-result path: signed EBIT fields are stored
    // against the same checkout session and never mutate payment/ledger state.
    const upiOrder=await makeOrder();
    const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const deviceId='device_'+rand();
    const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
    let auth=await fetch(base+'/api/session-evidence/authorize',{
      method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':upiOrder.token},
      body:JSON.stringify({consent:true,orderId:upiOrder.orderId,token:upiOrder.token,
        deviceId,publicKeyPem}),signal:AbortSignal.timeout(8000)});
    const authBody=await auth.json();
    assert.equal(auth.status,200,JSON.stringify(authBody));
    const sessionRow=(await pg.query('SELECT txn_ref FROM sessions WHERE order_id=$1',[upiOrder.orderId])).rows[0];
    const txnId=utr(),approvalRef=utr(),returnedAt=Date.now();
    const ebit={
      protocol:'DISHA-UPI-RESULT-V1',
      eventId:'upi_'+rand(),
      orderId:upiOrder.orderId,
      nonce:authBody.nonce,
      deviceId,
      packageName:'com.google.android.apps.nbu.paisa.user',
      returnedAt,
      txnId,
      approvalRefNo:approvalRef,
      txnRef:String(sessionRow.txn_ref).replace(/[^A-Za-z0-9]/g,'').slice(0,35),
      responseCode:'00',
      amountPaise:'50001',
      payeeVpa:'qa-receiver@oksbi',
      status:'SUCCESS'
    };
    const canonical=JSON.stringify(ebit);
    const signature=crypto.sign('sha256',Buffer.from(canonical),privateKey).toString('base64url');
    const upiBody={evidence:ebit,signature,token:upiOrder.token};
    const sendUpi=async body=>fetch(base+'/api/session-evidence/upi-result',{
      method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':upiOrder.token},
      body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
    let upiResponse=await sendUpi(upiBody);
    let upiResult=await upiResponse.json();
    assert.equal(upiResponse.status,202,JSON.stringify(upiResult));
    assert.equal(upiResult.decisionState,'UPI_RESPONSE_MATCHED');
    assert.equal(upiResult.utrCandidate,txnId);
    assert.equal(upiResult.ebit.approvalRefNo,approvalRef);
    assert.equal(upiResult.paymentStateChanged,false);
    upiResponse=await sendUpi(upiBody);
    assert.equal(upiResponse.status,409,'Native UPI result replay must be rejected');
    const storedUpi=(await pg.query(
      'SELECT upi_txn_id,approval_ref_no,merchant_txn_ref,response_code,signal_status,decision_state '+
      'FROM disha_session_upi_results WHERE order_id=$1',[upiOrder.orderId])).rows[0];
    assert.equal(storedUpi.upi_txn_id,txnId);
    assert.equal(storedUpi.approval_ref_no,approvalRef);
    assert.equal(storedUpi.response_code,'00');
    assert.equal(storedUpi.signal_status,'SUCCESS');
    assert.equal(storedUpi.decision_state,'UPI_RESPONSE_MATCHED');
    const upiSession=(await pg.query('SELECT status,state,utr FROM sessions WHERE order_id=$1',[upiOrder.orderId])).rows[0];
    assert.equal(upiSession.status,'PENDING');
    const upiTx=(await pg.query('SELECT count(*)::int n FROM transactions WHERE order_id=$1',[upiOrder.orderId])).rows[0];
    assert.equal(upiTx.n,0);
    const upiJournal=(await pg.query('SELECT count(*)::int n FROM disha_core_journals WHERE order_id=$1',[upiOrder.orderId])).rows[0];
    assert.equal(upiJournal.n,0);

    console.log('VAULT_AND_UPI_EVIDENCE_HTTP_PASS: session authorization, signed Android EBIT/UTR, replay, and zero financial posting; Vault checks also passed.');
    console.log('VAULT_EVIDENCE_HTTP_PASS: authenticated Vault+token, CSRF, replay, '+
      'cross-order UTR collision, amount, payee, no-UTR and zero financial credit.');
  }finally{
    server.kill('SIGTERM');
    await new Promise(r=>{if(server.exitCode!==null)r();else{server.once('exit',r);setTimeout(r,2500)}});
    await pg.end();
  }
})().catch(e=>{console.error(e);process.exitCode=1});
