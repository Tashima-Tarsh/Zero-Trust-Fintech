'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{canonical,evaluate}=require('./idebit');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),now=Date.now();
const order={orderId:'ORDER123',nonce:'a'.repeat(64),amountPaise:'50000',payeeVpa:'seller@upi',createdAt:now-1000,expiresAt:now+60000};
const evidence={protocol:'DISHA-IDEBIT-RESEARCH-V1',issuerId:'test-source',issuerEventId:'event00000001',orderId:order.orderId,nonce:order.nonce,utr:'123456789012',amountPaise:order.amountPaise,payeeVpa:order.payeeVpa,payerDebit:true,payeeCredit:true,finality:'FINAL',paidAt:now};
const registry={'test-source':{enabled:true,authorityVerified:true,authority:'PAYER_AND_PAYEE_FINALITY',publicKey}},sign=e=>crypto.sign(null,Buffer.from(canonical(e)),privateKey).toString('base64url');
const run=(e=evidence,r=registry,o=order,s=new Set(),sig=sign(e))=>evaluate({evidence:e,signature:sig,order:o,registry:r,seen:s,now});
let passed=0;function check(name,got,expected){assert.equal(got,expected,name);console.log('PASS',name);passed++}
check('synthetic-finality',run().state,'VERIFIED_IN_TEST');
const seen=new Set();run(evidence,registry,order,seen);check('replayed-utr',run(evidence,registry,order,seen).reason,'REPLAY');
for(const [name,change,reason] of [
 ['amount',{amountPaise:'40000'},'ORDER_BINDING_MISMATCH'],
 ['payee',{payeeVpa:'attacker@upi'},'ORDER_BINDING_MISMATCH'],
 ['nonce',{nonce:'b'.repeat(64)},'ORDER_BINDING_MISMATCH'],
 ['old',{paidAt:now-300000},'TIME_WINDOW_INVALID'],
 ['future',{paidAt:now+60000},'TIME_WINDOW_INVALID'],
 ['debit-only',{payeeCredit:false},'FINALITY_NOT_PROVEN'],
 ['pending',{finality:'PENDING'},'FINALITY_NOT_PROVEN'],
 ['reversed',{finality:'REVERSED'},'SOURCE_REPORTED_REVERSAL']
])check(name,run({...evidence,...change}).reason,reason);
check('untrusted-issuer',run(evidence,{'test-source':{...registry['test-source'],authorityVerified:false}}).reason,'ISSUER_AUTHORITY_NOT_ESTABLISHED');
check('forged-signature',run(evidence,registry,order,new Set(),'A'.repeat(86)).reason,'SIGNATURE_INVALID');
check('unknown-issuer',run(evidence,{}).state,'UNVERIFIED');
check('invalid-schema',run({...evidence,extra:'x'},registry,order,new Set(),'A'.repeat(86)).reason,'SCHEMA_INVALID');
check('same-utr-different-event',run({...evidence,issuerEventId:'event00000002'},registry,order,seen).reason,'REPLAY');
console.log(passed+' synthetic tests passed; zero live debits verified.');
