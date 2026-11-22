'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {extractDebitSmsCandidate,matchDebitSmsToCheckout}=require('../financial/sms-debit-candidate');
const {createSmsDebitRelayRouter,canonicalEnvelope}=require('../financial/sms-debit-relay');
const now=1700000000000;
const session={status:'PENDING',merchantType:'PERSONAL',challengeAmount:499.01,
 vpaAddress:'shop@oksbi',expiresAt:now+120000};
const payload={protocol:'DISHA-SMS-DEBIT-RELAY-V1',orderId:'ORDER_SMS_TEST_2026',
 sourceId:'android_test_source',nonce:'abcdefghijklmnopqrstuvwxyz123456',
 sender:'AB-BANKXX-P',text:'INR 499.01 debited from A/c XX1234 to shop@oksbi. UPI Ref: 123456789012',
 receivedAt:now};
test('positive bank debit candidate includes amount, UTR and payee but never bank authenticity',()=>{
 const c=extractDebitSmsCandidate(payload);
 assert.equal(c.amountPaise,'49901');assert.equal(c.utrCandidate,'123456789012');
 assert.equal(c.payeeVpaCandidate,'shop@oksbi');assert.equal(c.authenticatedDebit,false);
 assert.equal(matchDebitSmsToCheckout(c,session,{now}).matched,true);
 assert.equal(matchDebitSmsToCheckout(c,session,{now}).debitVerified,false);
});
test('credit, reversal, failed, pending, arbitrary SMS, no amount are rejected',()=>{
 for(const body of ['INR 499.01 credited in account as refund','INR 499.01 debit reversed from account',
  'INR 499.01 debit failed for transaction','INR 499.01 debit pending at merchant',
  'Your OTP is 123456 from your bank', 'Your account was debited yesterday']){
  assert.equal(extractDebitSmsCandidate({...payload,text:body}),null,body);
 }
});
test('wrong amount, payee, time window and expiry block matching',()=>{
 const candidate=extractDebitSmsCandidate(payload);
 assert.equal(matchDebitSmsToCheckout(candidate,{...session,challengeAmount:5},{now}).matched,false);
 assert.equal(matchDebitSmsToCheckout(candidate,{...session,vpaAddress:'evil@oksbi'},{now}).matched,false);
 assert.equal(matchDebitSmsToCheckout(candidate,session,{now:now+400000}).matched,false);
});
test('signed source relay validates signature, prevents replay, and keeps bank debit unverified',async()=>{
 const keys=crypto.generateKeyPairSync('ed25519');
 const trusted=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const seen=new Set(),saved=[];
 const pool={async query(sql,values){
  assert.match(sql,/ON CONFLICT\(event_hash\) DO NOTHING/);
  if(seen.has(values[0]))return {rowCount:0,rows:[]};
  seen.add(values[0]);saved.push(values);return {rowCount:1,rows:[{event_hash:values[0]}]};
 }};
 const app=express();app.use(express.json());
 app.use('/relay',createSmsDebitRelayRouter({getPool:()=>pool,getSession:async()=>session,
  getTrustedKeys:()=>({android_test_source:trusted}),clock:()=>now}));
 const listener=app.listen(0,'127.0.0.1');await new Promise(resolve=>listener.listening?resolve():listener.once('listening',resolve));
 const send=async(envelope,signature)=>{const r=await fetch('http://127.0.0.1:'+listener.address().port+'/relay/ingest',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({envelope,signature})});
  return {code:r.status,data:await r.json()}};
 try{
  const sig=crypto.sign(null,Buffer.from(canonicalEnvelope(payload)),keys.privateKey).toString('base64url');
  const bad=await send(payload,'x');assert.equal(bad.code,401);
  const good=await send(payload,sig);assert.equal(good.code,202);
  assert.equal(good.data.sourceAuthenticated,true);
  assert.equal(good.data.bankOriginAuthenticated,false);assert.equal(good.data.debitVerified,false);
  assert.equal((await send(payload,sig)).code,409);
  assert.equal(saved.length,1);
  assert.ok(!JSON.stringify(saved).includes(payload.text),'never persist raw SMS');
  assert.equal((await send({...payload,text:'INR 1.00 debit test'},sig)).code,401);
 }finally{await new Promise(resolve=>listener.close(resolve))}
});
