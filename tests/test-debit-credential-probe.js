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
assert.doesNotMatch(checkout,/query\.get\('debitprobe'\)/,'Android P2P checkout must not require a hidden query parameter');
assert.match(checkout,/model\.isPersonalPayment\(session\.upiUri\)/);
assert.match(server,/await initDebitCredentialSchema\(db\.pgPool\);/);
const moduleSource=read('financial/debit-credential.js');
assert.match(moduleSource,/A read-only challenge is always available/);
assert.match(moduleSource,/if\(!enabled\(\)\)return err\(res,fail\(503,'DEBIT_CREDENTIAL_DISABLED'\)\);/,'Submission stays feature-gated');
assert.match(checkout,/\/api\/debit-credential\/present/);
assert.doesNotMatch(read('financial/debit-credential.js'),/UPDATE sessions SET|INSERT INTO transactions|INSERT INTO ledger_entries/);
const capabilityPage=read('public/debit-credential-test.html');
assert.match(capabilityPage,/Check Android Browser Support/);
assert.match(capabilityPage,/DigitalCredential/);
assert.match(capabilityPage,/Request Android Credential \(No Payment\)/);
assert.match(capabilityPage,/navigator\.credentials\.get\(\{signal:AbortSignal\.timeout\(30000\),digital:/,
 'The browser request must time out if Android never responds');
assert.doesNotMatch(capabilityPage,/\bclient_id\s*:/,
 'Unsigned OpenID4VP requests must omit client_id');
assert.doesNotMatch(capabilityPage,/fetch\s*\(|\/api\/debit-credential\/present/,'No-payment Android probe never uploads credential claims');
assert.doesNotMatch(moduleSource,/client_id\s*:/,
 'Production unsigned OpenID4VP request must not forge browser client_id');
assert.match(moduleSource,/protocol:'openid4vp-v1-unsigned'/);
assert.match(moduleSource,/router\.post\('\/provider-claim'/);
assert.match(moduleSource,/router\.get\('\/status\/:serviceRequestId'/);
assert.match(moduleSource,/verifyReceipt\(receipt,signature,publicKey/);
assert.match(moduleSource,/DEBIT_REFERENCE_REPLAY/);
assert.match(moduleSource,/DEBIT_PROVIDER_NOT_TRUSTED/);
assert.match(moduleSource,/paymentVerified:false,debitVerified:false,paymentStateChanged:false/);
assert.match(checkout,/\/api\/debit-credential\/status\//);
console.log('DEBIT_CREDENTIAL_PROBE_PASS: signed claims, binding, tamper, expiry, replay schema, no ledger mutation');
