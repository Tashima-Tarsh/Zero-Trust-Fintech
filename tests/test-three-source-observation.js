'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {readDebitEvidenceReceipt} = require('../financial/session-evidence');

const {publicKey} = crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const pem = publicKey.export({type:'spki',format:'pem'});
const digest = crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const original = process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
const now = Date.now();
const order = {status:'PENDING',expiresAt:now+60000,challengeAmount:'10',vpaAddress:'fixture@invalid'};
const base = {event_hash:'a'.repeat(64),package_name:'com.phonepe.app',transaction_ref:'123456789012',
  reference_kind:'UTR',amount_paise:'1000',payee_vpa:'fixture@invalid',posted_at:now,
  decision_state:'SIGNAL_MATCHED',public_key_pem:pem};
const sms = {...base,event_hash:'b'.repeat(64),package_name:'com.google.android.apps.messaging'};
const pool = events => ({query:async () => ({rows:events})});
(async () => {
  try {
    process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256=digest;
    const result=await readDebitEvidenceReceipt(pool([base,sms]),'order123',order,now);
    assert.equal(result.debitEvidenceReceipt.reference,'123456789012');
    assert.deepEqual(result.debitEvidenceReceipt.sources,[base.package_name,sms.package_name]); 
    assert.equal(result.debitEvidenceReceipt.observedSources.length,2);
    assert.equal((await readDebitEvidenceReceipt(pool([base,{...sms,transaction_ref:'999999999999'}]),'order123',order,now)).receiptError,
      'CONFLICTING_OR_INVALID_EVIDENCE');
    assert.equal((await readDebitEvidenceReceipt(pool([base,{...sms,amount_paise:'2000'}]),'order123',order,now)).receiptError,
      'CONFLICTING_OR_INVALID_EVIDENCE');
    process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256='c'.repeat(64);
    assert.equal((await readDebitEvidenceReceipt(pool([base,sms]),'order123',order,now)).receiptError,
      'DEVICE_PROVENANCE_UNTRUSTED');
    console.log('PASS: same-checkout multi-source RRN accepted; conflict and untrusted key rejected');
  } finally {
    if(original===undefined)delete process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
    else process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256=original;
  }
})().catch(e=>{console.error(e);process.exitCode=1});
