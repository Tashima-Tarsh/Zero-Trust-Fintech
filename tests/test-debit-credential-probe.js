'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {canonicalReceipt,verifyReceipt}=require('../financial/debit-credential');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const now=Date.now(),challenge='a'.repeat(64);
const receipt={protocol:'DISHA-DEBIT-CREDENTIAL-V1',issuerId:'trusted-provider',
 serviceRequestId:'SERVICE_TEST_123',challenge,utr:'123456789012',
 debitConfirmed:true,amountPaise:'100',payeeVpa:'seller@oksbi',paidAt:now};
const signature=crypto.sign(null,Buffer.from(canonicalReceipt(receipt)),privateKey).toString('base64url');
const bound={serviceRequestId:receipt.serviceRequestId,issuerId:receipt.issuerId,
 challenge,amountPaise:'100',payeeVpa:'seller@oksbi',createdAt:now-1000,expiresAt:now+60000};
assert.match(verifyReceipt(receipt,signature,publicKey,bound,now),/^[a-f0-9]{64}$/);
for(const change of [{utr:'999999999999'},{amountPaise:'101'},{payeeVpa:'attacker@upi'},
 {debitConfirmed:false},{serviceRequestId:'SERVICE_BAD_123'}]){
 assert.throws(()=>verifyReceipt({...receipt,...change},signature,publicKey,bound,now),
 /DEBIT_CREDENTIAL/);
}
assert.throws(()=>verifyReceipt(receipt,signature,publicKey,{...bound,challenge:'b'.repeat(64)},now),
 /DEBIT_CREDENTIAL_BINDING_MISMATCH/);
assert.throws(()=>verifyReceipt(receipt,signature,publicKey,{...bound,expiresAt:now-1},now),
 /DEBIT_CREDENTIAL_EXPIRED/);
const {publicKey:otherKey}=crypto.generateKeyPairSync('ed25519');
assert.throws(()=>verifyReceipt(receipt,signature,otherKey,bound,now),/DEBIT_CREDENTIAL_SIGNATURE_INVALID/);
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const server=read('server.js'),checkout=read('public/cosmic-checkout.js');
assert.match(server,/createDebitCredentialRouter/);
assert.match(server,/initDebitCredentialSchema/);
assert.match(checkout,/navigator\.credentials\.get/);
assert.match(checkout,/debitprobe/);
assert.match(checkout,/\/api\/debit-credential\/present/);
assert.doesNotMatch(read('financial/debit-credential.js'),/UPDATE sessions SET|INSERT INTO transactions|INSERT INTO ledger_entries/);
console.log('DEBIT_CREDENTIAL_PROBE_PASS: signed claims, binding, tamper, expiry, replay schema, no ledger mutation');
