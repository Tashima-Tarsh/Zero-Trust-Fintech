'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePrepaymentTrust}=require('../financial/p2p-prepayment-trust-policy');
const now=10_000,orderId='ORD_PREPAY_1',base={orderId,sessionExpiresAt:now+10000};
const auth={orderId,userVerified:true,verifiedAt:now-100};
const device={orderId,trustSource:'SERVER_VERIFIED_ATTESTATION',
 integrityVerdict:'MEETS_DEVICE_INTEGRITY',debuggerRiskVerdict:'NO_DEBUGGER_DETECTED',verifiedAt:now-100};
const evalPolicy=x=>evaluatePrepaymentTrust(x,()=>now);
test('no device attestation: even biometric verified must never authorize payment',()=>{
 const v=evalPolicy({...base,auth});
 assert.equal(v.decision,'BLOCK');
 assert.equal(v.payerAuthenticated,true);
 assert.equal(v.deviceIntegrityVerified,false);
 assert.equal(v.debuggerRiskVerified,false);
 assert.equal(v.debitVerified,false);
});
test('device trust but no verified payer: block',()=>{
 const v=evalPolicy({...base,device});
 assert.equal(v.decision,'BLOCK');
 assert.deepEqual(v.reasons,['PAYER_USER_VERIFICATION_REQUIRED']);
});
test('root/integrity failure or debugger risk blocks',()=>{
 for(const d of [{...device,integrityVerdict:'FAILED'},
  {...device,debuggerRiskVerdict:'DEBUGGER_DETECTED'},
  {...device,debuggerRiskVerdict:'UNKNOWN'},
  {...device,trustSource:'BROWSER_JS'},
  {...device,verifiedAt:now-200000},
  {...device,orderId:'OTHER_ORDER'}]){
  assert.equal(evalPolicy({...base,auth,device:d}).decision,'BLOCK');
 }
});
test('expired sessions, stale passkeys, wrong order, clocks and unknowns block',()=>{
 for(const b of [{...base,sessionExpiresAt:now},
  {...base,auth:{...auth,orderId:'OTHER_ORDER'}},
  {...base,auth:{...auth,verifiedAt:now+100}},
  {...base,auth:{...auth,verifiedAt:now-200000}},
  {...base,orderId:'bad'}]){
  assert.equal(evalPolicy({...b,auth:b.auth||auth,device}).decision,'BLOCK');
 }
});
test('only trusted fresh and order-bound payer and integrity attestations allow',()=>{
 const v=evalPolicy({...base,auth,device});
 assert.equal(v.decision,'ALLOW');
 assert.equal(v.payerAuthenticated,true);
 assert.equal(v.deviceIntegrityVerified,true);
 assert.equal(v.debuggerRiskVerified,true);
 assert.deepEqual(v.reasons,[]);
 assert.equal(v.debitVerified,false,'prepayment trust is never debit evidence');
});
