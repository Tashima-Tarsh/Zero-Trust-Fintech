'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {canonicalSmsObservation,verifySmsObservation}=require('../financial/sms-observation');
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const now=Date.now();
const message={protocol:'DISHA-SMS-OBSERVATION-V1',serviceRequestId:'SERVICE_SMS_123',
 challenge:'a'.repeat(64),amountPaise:'100',payeeVpa:'seller@oksbi',
 observedAt:now,source:'ANDROID_SMS_USER_CONSENTED',
 smsDigest:'b'.repeat(64),utrCandidate:'123456789012'};
const bound={serviceRequestId:message.serviceRequestId,challenge:message.challenge,
 amountPaise:message.amountPaise,payeeVpa:message.payeeVpa,
 createdAt:now-1000,expiresAt:now+60000};
const sign=x=>crypto.sign(null,Buffer.from(canonicalSmsObservation(x)),privateKey).toString('base64url');
const sig=sign(message);
const verified=verifySmsObservation(message,sig,publicKey,bound,now);
assert.equal(verified.deviceSignatureVerified,true);
assert.equal(verified.bankSenderAuthenticated,false);
assert.equal(verified.debitVerified,false);
assert.equal(verified.paymentVerified,false);
assert.equal(verified.paymentStateChanged,false);
assert.equal(verified.utrCandidate,'123456789012');
assert.match(verified.observationHash,/^[a-f0-9]{64}$/);
for(const mutation of [{utrCandidate:'999999999999'},{smsDigest:'c'.repeat(64)},
 {amountPaise:'200'},{payeeVpa:'attacker@upi'},{source:'BANK_VERIFIED'}]){
 const changed={...message,...mutation};
 assert.throws(()=>verifySmsObservation(changed,sig,publicKey,bound,now),/SMS_OBSERVATION_/);
}
assert.throws(()=>verifySmsObservation(message,sig,publicKey,{...bound,challenge:'e'.repeat(64)},now),/BINDING_MISMATCH/);
assert.throws(()=>verifySmsObservation(message,sig,publicKey,{...bound,expiresAt:now-1},now),/EXPIRED/);
const {publicKey:alien}=crypto.generateKeyPairSync('ed25519');
assert.throws(()=>verifySmsObservation(message,sig,alien,bound,now),/SIGNATURE_INVALID/);
assert.throws(()=>canonicalSmsObservation({...message,rawSms:'bank data'}),/FIELDS_INVALID/);
assert.throws(()=>canonicalSmsObservation({...message,smsDigest:'not sha256'}),/FIELDS_INVALID/);
const noUtr={...message,utrCandidate:null};
assert.equal(verifySmsObservation(noUtr,sign(noUtr),publicKey,bound,now).utrCandidate,null);
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../financial/sms-observation.js'),'utf8');
assert.doesNotMatch(source,/UPDATE sessions SET|INSERT INTO transactions|INSERT INTO ledger_entries/);
console.log('SMS_OBSERVATION_PASS: device signature, tamper, binding, expiry, sender untrusted, never payment verified');
