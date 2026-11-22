'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),express=require('express');
const {createUpiAppEvidenceRouter}=require('../financial/upi-app-evidence-router');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const keys={testkey:publicKey.export({type:'spki',format:'pem'})};
const expiry=Date.now()+120000;
const session={sessionId:'a'.repeat(48),orderId:'P2P_VERIFY_01',merchantType:'P2P',
 status:'PENDING',expiresAt:expiry,txnRef:'REF123',vpaAddress:'receiver@upi',challengeAmount:1};
function signed(overrides={}){
 const tezResponse=JSON.stringify({Status:'SUCCESS',txnRef:'REF123',toVpa:'receiver@upi',
  amount:'1.00',txnId:'TXN123456',...overrides});
 const hex=crypto.createHash('sha256').update(tezResponse).digest('hex');
 return {methodName:'https://tez.google.com/pay',details:{
  tezResponse,signatureKeyId:'testkey',signature:crypto.sign('sha256',Buffer.from(hex),privateKey).toString('hex')}};
}
test('server verifies signed app response against OWN session fields; no financial mutation',async()=>{
 const app=express();app.use(express.json());app.use('/api/upi-app-evidence',
 createUpiAppEvidenceRouter({getSession:async()=>session,getTrustedKeys:()=>keys,
 consumeReplay:async()=>true}));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/api/upi-app-evidence/verify';
 async function send(body){
  const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {code:response.status,value:await response.json()};
 }
 const basic={orderId:session.orderId,token:session.sessionId,...signed()};
 try{
  const valid=await send(basic);
  assert.equal(valid.code,200);
  assert.equal(valid.value.signatureVerified,true);
  assert.equal(valid.value.replayProtected,true);
  assert.equal(valid.value.providerReportedSuccess,true);
  assert.equal(valid.value.debitVerified,false);
  assert.equal(valid.value.paymentVerified,false);
  assert.equal(valid.value.paymentStateChanged,false);
  assert.equal(valid.value.txnId,undefined);
  const wrongToken=await send({...basic,token:'b'.repeat(48)});
  assert.equal(wrongToken.code,401);
  const wrongAmount=await send({...basic,...signed({amount:'2.00'})});
  assert.equal(wrongAmount.value.signatureVerified,true);
  assert.equal(wrongAmount.value.responseReason,'SIGNED_TRANSACTION_MISMATCH');
  const wrongRef=await send({...basic,...signed({txnRef:'REF999'})});
  assert.equal(wrongRef.value.responseReason,'SIGNED_TRANSACTION_MISMATCH');
  const expired=await send({...basic,orderId:session.orderId});
  assert.equal(expired.code,200);
 }finally{server.close();}
});
test('browser is connected to authenticated verification endpoint with no manual evidence submission',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(server,/createUpiAppEvidenceRouter/);
 for(const p of ['public/cosmic-checkout.js','dist/cosmic-checkout.js',
  'disha-cinematic/public/cosmic-checkout.js','disha-cinematic/dist/cosmic-checkout.js']){
  const script=fs.readFileSync(path.join(root,p),'utf8');
  assert.match(script,/\/api\/upi-app-evidence\/verify/);
  assert.match(script,/onPaymentResponse:async/);
 }
 const probe=fs.readFileSync(path.join(root,'public/p2p-paymentrequest-probe.js'),'utf8');
 assert.match(probe,/env\.onPaymentResponse/);
 assert.doesNotMatch(probe,/fetch\s*\(|XMLHttpRequest|sendBeacon\s*\(/);
 const router=fs.readFileSync(path.join(root,'financial/upi-app-evidence-router.js'),'utf8');
 assert.doesNotMatch(router,/UPDATE sessions|INSERT INTO ledger|reconcileCredit/);
});
