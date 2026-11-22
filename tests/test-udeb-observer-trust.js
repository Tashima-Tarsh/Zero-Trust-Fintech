'use strict';
/* The user-enrolled software key is not Android system provenance. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {readDebitEvidenceReceipt}=require('../financial/session-evidence');
const {publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const actualPin=crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const now=Date.now();
const session={status:'PENDING',expiresAt:now+180000,challengeAmount:500,vpaAddress:'receiver@upi'};
const row={event_hash:'a'.repeat(64),package_name:'com.phonepe.app',transaction_ref:'123456789012',
 reference_kind:'UTR',amount_paise:'50000',payee_vpa:'receiver@upi',
 posted_at:now,decision_state:'SIGNAL_MATCHED',
 public_key_pem:publicKey.export({type:'spki',format:'pem'})};
const pool={query:async()=>({rows:[row]})};
async function main(){
 const prior=process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
 try{
  delete process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
  assert.equal((await readDebitEvidenceReceipt(pool,'order12345',session,now)).receiptError,
   'TRUSTED_DEVICE_NOT_CONFIGURED');
  console.log('PASS: no OEM/admin pin -> no trusted receipt');
  process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256='b'.repeat(64);
  assert.equal((await readDebitEvidenceReceipt(pool,'order12345',session,now)).receiptError,
   'DEVICE_PROVENANCE_UNTRUSTED');
  console.log('PASS: attacker software key is not trusted');
  process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256=actualPin;
  const receipt=await readDebitEvidenceReceipt(pool,'order12345',session,now);
  assert.equal(receipt.debitEvidenceReceipt.state,'DEBIT_EVIDENCE_OBSERVED');
  assert.equal(receipt.debitEvidenceReceipt.reference,'123456789012');
  console.log('PASS: independently pinned key permits source-observation receipt');
  const expired=await readDebitEvidenceReceipt(pool,'order12345',{...session,expiresAt:now},now);
  assert.deepEqual(expired,{});
  console.log('PASS: expired session cannot display a receipt');
 }finally{
  if(prior===undefined)delete process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
  else process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256=prior;
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
