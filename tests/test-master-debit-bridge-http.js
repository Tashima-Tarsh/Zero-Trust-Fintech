'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {createDebitCredentialRouter,canonicalReceipt}=require('../financial/debit-credential');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const key=publicKey.export({format:'der',type:'spki'}).toString('base64');
const saved={
 flag:process.env.DISHA_DEBIT_CREDENTIAL_EXPERIMENT,
 id:process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_ID,
 key:process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_PUBLIC_KEY_BASE64
};
process.env.DISHA_DEBIT_CREDENTIAL_EXPERIMENT='1';
process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_ID='test-bank-issuer';
process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_PUBLIC_KEY_BASE64=key;
const now=Date.now();
const orderId='SERVICE_MASTER_TEST_123';
const token='a'.repeat(48);
const record={service_request_id:orderId,token_hash:crypto.createHash('sha256').update(token).digest('hex'),
 challenge:'c'.repeat(64),amount_paise:'100',payee_vpa:'seller@oksbi',
 created_at:now-1000,expires_at:now+90000};
const session={sessionId:token,merchantType:'P2P',status:'PENDING',
 expiresAt:now+120000,challengeAmount:'1.00',vpaAddress:'seller@oksbi'};
const claims=new Map(),utrs=new Set();
function query(sql,params=[]){
 if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return Promise.resolve({rows:[]});
 if(sql.includes('FROM disha_debit_credential_challenges'))
  return Promise.resolve({rows:[record]});
 if(sql.includes('FROM disha_debit_credential_claims'))
  return Promise.resolve({rows:claims.has(params[0])?[claims.get(params[0])]:[]});
 if(sql.startsWith('INSERT INTO disha_debit_credential_claims')){
  const [serviceId,utr,issuerId,receiptHash,receivedAt]=params;
  if(claims.has(serviceId)||utrs.has(utr))return Promise.reject({code:'23505'});
  claims.set(serviceId,{utr,issuer_id:issuerId,receipt_hash:receiptHash,received_at:receivedAt});
  utrs.add(utr);return Promise.resolve({rows:[]});
 }
 throw Error('Unexpected SQL: '+sql);
}
const pool={connect:async()=>({query,release(){}}),query};
const app=express();app.use(express.json());
app.use('/api/debit-credential',createDebitCredentialRouter({
 getPool:()=>pool,getSession:async id=>id===orderId?session:null
}));
const server=app.listen(0,'127.0.0.1');
const base=()=>('http://127.0.0.1:'+server.address().port);
const receipt={protocol:'DISHA-DEBIT-CREDENTIAL-V1',issuerId:'test-bank-issuer',
 serviceRequestId:orderId,challenge:record.challenge,utr:'123456789012',
 debitConfirmed:true,amountPaise:'100',payeeVpa:'seller@oksbi',paidAt:now};
const sign=r=>crypto.sign(null,Buffer.from(canonicalReceipt(r)),privateKey).toString('base64url');
const post=async payload=>{
 const r=await fetch(base()+'/api/debit-credential/provider-claim',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 return {status:r.status,body:await r.json()};
};
(async()=>{
 try{
  const invalid=await post({receipt:{...receipt,amountPaise:'999'},signature:sign(receipt)});
  assert.equal(invalid.status,409,'Amount mismatch is rejected');
  assert.equal(invalid.body.error,'DEBIT_CREDENTIAL_BINDING_MISMATCH');
  const spoof=await post({receipt:{...receipt,issuerId:'attacker'},signature:sign(receipt)});
  assert.equal(spoof.status,401,'Unknown issuer cannot publish a claim');
  const ok=await post({receipt,signature:sign(receipt)});
  assert.equal(ok.status,202,'Trusted issuer proof accepted as an unverified claim');
  assert.equal(ok.body.paymentVerified,false);
  const duplicate=await post({receipt,signature:sign(receipt)});
  assert.equal(duplicate.status,409,'Duplicate UTR rejected');
  const anonymous=await fetch(base()+'/api/debit-credential/status/'+orderId);
  assert.equal(anonymous.status,401,'Session status is private');
  const own=await fetch(base()+'/api/debit-credential/status/'+orderId+'?token='+token);
  assert.equal(own.status,200);
  const ownBody=await own.json();
  assert.equal(ownBody.utrCandidate,receipt.utr);
  assert.equal(ownBody.paymentVerified,false);
  assert.equal(ownBody.evidenceState,'ISSUER_SIGNED_DEBIT_CLAIM_UNVERIFIED');
  console.log('MASTER_BRIDGE_HTTP_PASS: issuer authentication, amount integrity, replay and token isolation');
 }finally{
  server.close();
  for(const [k,v] of Object.entries({
   DISHA_DEBIT_CREDENTIAL_EXPERIMENT:saved.flag,
   DISHA_DEBIT_CREDENTIAL_ISSUER_ID:saved.id,
   DISHA_DEBIT_CREDENTIAL_ISSUER_PUBLIC_KEY_BASE64:saved.key
  })){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
