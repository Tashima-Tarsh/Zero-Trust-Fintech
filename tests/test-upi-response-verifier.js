'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifyUPIResponse,verifyGooglePay,amountPaise,UNSUPPORTED}=require('../lib/upi-response-verifier');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const keys={'test-key':publicKey.export({type:'spki',format:'pem'})};
const expected={pa:'receiver@upi',amount:'1.00',txnRef:'disha-order-42'};
function signed(overrides={}){
 const tezResponse=JSON.stringify({Status:'SUCCESS',amount:'1.00',txnRef:'disha-order-42',toVpa:'receiver@upi',txnId:'ABC123',...overrides});
 const hash=crypto.createHash('sha256').update(tezResponse,'utf8').digest('hex');
 const signature=crypto.sign('sha256',Buffer.from(hash,'utf8'),privateKey).toString('hex');
 return {methodName:'https://tez.google.com/pay',details:{tezResponse,signature,signatureKeyId:'test-key'}};
}
assert.equal(amountPaise('1.00'),100);
assert.equal(amountPaise('1.001'),null);
assert.equal(amountPaise('1e3'),null);
const ok=verifyGooglePay(signed(),expected,keys);
assert.equal(ok.signatureVerified,true);
assert.equal(ok.providerReportedSuccess,true);
assert.equal(ok.paymentVerified,false);
assert.equal(ok.debitVerified,false);
assert.equal(ok.settlementVerified,false);
const bad=signed(); bad.details.signature='ff'.repeat(72);
const cases=[
 ['tampered signature',verifyGooglePay(bad,expected,keys),'INVALID_SIGNATURE'],
 ['unsigned',verifyGooglePay({methodName:bad.methodName,details:{tezResponse:bad.details.tezResponse}},expected,keys),'INVALID_SIGNATURE_FORMAT'],
 ['unknown key',verifyGooglePay(signed(),expected,{}),'UNKNOWN_SIGNING_KEY'],
 ['wrong payee',verifyGooglePay(signed({toVpa:'attacker@upi'}),expected,keys),'SIGNED_TRANSACTION_MISMATCH'],
 ['wrong amount',verifyGooglePay(signed({amount:'2.00'}),expected,keys),'SIGNED_TRANSACTION_MISMATCH'],
 ['wrong reference',verifyGooglePay(signed({txnRef:'other'}),expected,keys),'SIGNED_TRANSACTION_MISMATCH'],
 ['replay',verifyGooglePay(signed(),expected,keys,{isReplay:()=>true}),'REPLAY_DETECTED']
];
for(const [label,result,reason] of cases){
 assert.equal(result.reason,reason,label);
 assert.equal(result.paymentVerified,false,label);
 assert.equal(result.debitVerified,false,label);
}
const failure=verifyGooglePay(signed({Status:'FAILURE'}),expected,keys);
assert.equal(failure.signatureVerified,true);
assert.equal(failure.providerReportedSuccess,false);
assert.equal(failure.debitVerified,false);
for(const provider of UNSUPPORTED){
 const r=verifyUPIResponse({provider,response:signed(),expected,trustedKeys:keys});
 assert.equal(r.reason,'PROVIDER_SIGNATURE_SCHEME_UNAVAILABLE',provider);
 assert.equal(r.signatureVerified,false,provider);
 assert.equal(r.debitVerified,false,provider);
}
console.log('UPI signature verifier: PASS');
