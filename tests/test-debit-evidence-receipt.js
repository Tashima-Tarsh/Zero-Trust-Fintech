'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {canonicalAcknowledgement,createEvidenceAcknowledgement,
 verifyEvidenceAcknowledgement}=require('../financial/debit-evidence-receipt');
const {createDebitCredentialRouter}=require('../financial/debit-credential');
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const privateDer=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const publicDer=publicKey.export({format:'der',type:'spki'}).toString('base64');
const orderId='SERVICE_ACK_TEST_123',token='a'.repeat(48);
const row={utr:'123456789012',issuer_id:'trusted-test-issuer',
 receipt_hash:'c'.repeat(64),received_at:Date.now()};
const signed=createEvidenceAcknowledgement(orderId,row,privateDer);
assert.equal(signed.acknowledgement.paymentVerified,false);
assert.equal(signed.acknowledgement.debitVerified,false);
assert.equal(verifyEvidenceAcknowledgement(signed,publicDer),true);
assert.equal(verifyEvidenceAcknowledgement({...signed,acknowledgement:{
 ...signed.acknowledgement,utrCandidate:'999999999999'}},publicDer),false);
assert.equal(verifyEvidenceAcknowledgement({...signed,acknowledgement:{
 ...signed.acknowledgement,sourceReceiptSha256:'d'.repeat(64)}},publicDer),false);
assert.equal(verifyEvidenceAcknowledgement({...signed,acknowledgement:{
 ...signed.acknowledgement,paymentVerified:true}},publicDer),false);
assert.equal(verifyEvidenceAcknowledgement({...signed,acknowledgement:{
 ...signed.acknowledgement,serviceRequestId:'SERVICE_OTHER_123'}},publicDer),false);
assert.throws(()=>canonicalAcknowledgement({...signed.acknowledgement,bankSettled:true}),
 /DEBIT_EVIDENCE_ACK_FIELDS_INVALID/);

const prior=process.env.DISHA_EVIDENCE_RECEIPT_PRIVATE_KEY_BASE64;
process.env.DISHA_EVIDENCE_RECEIPT_PRIVATE_KEY_BASE64=privateDer;
const query=async(sql,params=[])=>{
 assert.match(sql,/FROM disha_debit_credential_claims/);
 assert.equal(params[0],orderId);
 return {rows:[row]};
};
const pool={query};
const app=express();
app.use('/api/debit-credential',createDebitCredentialRouter({
 getPool:()=>pool,
 getSession:async id=>id===orderId?
  {sessionId:token,merchantType:'P2P',status:'PENDING',expiresAt:Date.now()+60000}:null
}));
const server=app.listen(0,'127.0.0.1');
(async()=>{
 try{
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  const path='/api/debit-credential/evidence-receipt/'+orderId;
  const url='http://127.0.0.1:'+server.address().port;
  const noAuth=await fetch(url+path);
  assert.equal(noAuth.status,401,'no anonymous evidence access');
  const wrong=await fetch(url+path+'?token='+'b'.repeat(48));
  assert.equal(wrong.status,401,'wrong session rejected');
  const own=await fetch(url+path+'?token='+token);
  assert.equal(own.status,200);
  const body=await own.json();
  assert.equal(body.debitVerified,false);
  assert.equal(body.paymentVerified,false);
  assert.equal(body.paymentStateChanged,false);
  assert.equal(verifyEvidenceAcknowledgement(body.evidenceReceipt,publicDer),true);
  assert.equal(body.evidenceReceipt.acknowledgement.sourceReceiptSha256,row.receipt_hash);
  console.log('DEBIT_EVIDENCE_RECEIPT_PASS: signature, tamper, session isolation, no false debit proof');
 }finally{
  server.close();
  if(prior===undefined)delete process.env.DISHA_EVIDENCE_RECEIPT_PRIVATE_KEY_BASE64;
  else process.env.DISHA_EVIDENCE_RECEIPT_PRIVATE_KEY_BASE64=prior;
 }
})().catch(e=>{console.error(e);process.exitCode=1});
