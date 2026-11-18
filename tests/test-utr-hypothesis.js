'use strict';

/**
 * DISHA 8.2 / UTR hypothesis adversarial diagnostic.
 * NO bank, aggregator, API, SIM, transaction request or money transfer.
 *
 * Proves which properties can be derived from UTR/receipt information alone
 * and demonstrates a counterexample to "UTR present = credited funds".
 * This is intentionally a vulnerability diagnostic, NOT a certification.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreEvidence } = require('../utils/trust-score');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = server.indexOf('function extractReceiptEvidence(');
const end = server.indexOf("app.post('/api/verify',", start);
assert.ok(start >= 0 && end > start, 'Actual receipt extractor exists in the production server');
// Exercise the REAL receipt-text extractor in isolation (no fake implementation).
const extractReceiptEvidence = new Function(
  '"use strict";\n' + server.slice(start,end) + '\nreturn extractReceiptEvidence;'
)();

const now = Date.now();
const session = {
  challengeAmount:499.01,
  createdAt:now-30_000,
  expiresAt:now+150_000,
  payeeVpa:'qa-receiver@oksbi',
  payeeName:'DISHA QA Merchant'
};
const utr = '631902884112';
const empty = {utrSeen:false,imageHashSeen:false,attemptsThisSession:1,priorConfirmed:0};
const score = (ev,hist=empty,opts={}) =>
  scoreEvidence(session,ev,hist,{now,sameDevice:true,...opts});

let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}

// Valid numeric reference is an identifier; it conveys no independent final state.
test('UTR string alone does not satisfy the existing scoring gates',()=>{
  const ev={utr,amount:499.01,payeeVpa:null,looksLikeScreenshot:false,submittedAt:now};
  assert.equal(score(ev).tier,'REJECT');
});
test('Failed outcome with a UTR is not success',()=>{
  const ev={utr,amount:499.01,payeeVpa:session.payeeVpa,
    statusText:'FAILED',looksLikeScreenshot:true,submittedAt:now};
  assert.equal(score(ev).gate,'STATUS_FAILED');
});
test('Pending outcome with a UTR is not success',()=>{
  const ev={utr,amount:499.01,payeeVpa:session.payeeVpa,
    statusText:'PENDING',looksLikeScreenshot:true,submittedAt:now};
  assert.equal(score(ev).gate,'STATUS_PENDING');
});
test('Different payee with the same UTR is rejected',()=>{
  const ev={utr,amount:499.01,payeeVpa:'someone@oksbi',
    statusText:'SUCCESS',looksLikeScreenshot:true,submittedAt:now};
  assert.equal(score(ev).gate,'PAYEE_MISMATCH');
});
test('Different amount with the same UTR is rejected',()=>{
  const ev={utr,amount:499.02,payeeVpa:session.payeeVpa,
    statusText:'SUCCESS',looksLikeScreenshot:true,submittedAt:now};
  assert.equal(score(ev).gate,'AMOUNT_MISMATCH');
});
test('Reused UTR is rejected after prior binding',()=>{
  const ev={utr,amount:499.01,payeeVpa:session.payeeVpa,
    statusText:'SUCCESS',looksLikeScreenshot:true,submittedAt:now};
  assert.equal(score(ev,{...empty,utrSeen:true}).gate,'UTR_REUSED');
});
test('Malformed UTR is rejected',()=>{
  const ev={utr:'NOT_A_UTR',amount:499.01,payeeVpa:session.payeeVpa,
    statusText:'SUCCESS',looksLikeScreenshot:true,submittedAt:now};
  assert.equal(score(ev).gate,'UTR_FORMAT');
});

// Main counterexample. Text and status are supplied by a requester; no
// authoritative payment credit has been observed. The fixed engine must reject HIGH.
test('P0 regression: fabricated UPI SUCCESS text cannot reach HIGH or release money',()=>{
  const fabricatedText =
    'UPI Payment Successful\n' +
    'DISHA QA Merchant\n' +
    'To: qa-receiver@oksbi\n' +
    'Amount INR 499.01\n' +
    'UTR: '+utr+'\n' +
    'Date: Today';
  const extracted=extractReceiptEvidence(fabricatedText,session);
  const ev={...extracted,amount:499.01,utr};
  assert.equal(extracted.payeeVpa,session.payeeVpa);
  assert.equal(extracted.statusText,'SUCCESS');
  assert.equal(extracted.layoutFieldsFound,4);
  assert.equal(extracted.looksLikeScreenshot,true);
  const result=score(ev);
  assert.notEqual(result.tier,'HIGH');
  assert.equal(result.verified,false);
  assert.equal(result.gate,'UNVERIFIED_RECEIPT_SOURCE');
  console.log('  FIX_VERIFIED: fabricated client receipt score '+result.score+' is non-settling.');
});

// The CFC path must never settle with just a UTR and checkout session.
// This is a static route-structure check, not a production exploit attempt.
test('P0 regression: CFC route records UTR only without ledger posting',()=>{
  const a=server.indexOf("app.post('/api/verify-cfc',");
  const b=server.indexOf("app.post(",a+20);
  const route=server.slice(a,b===-1?undefined:b);
  assert.ok(a>=0 && route.includes('const { utr, orderId, token } = req.body'));
  assert.ok(!route.includes('db.bindUtrToOrder('),
    'Customer claims must never reserve the authoritative UTR binding');
  assert.ok(route.includes("observeClaim(db.pgPool,session.orderId,cleanUtr,'CFC')"),
    'An untrusted reference must go into the non-authoritative claim store');
  assert.ok(!route.includes('db.atomicSettle('));
  assert.ok(!route.includes("await db.updateSessionStatus(session.orderId, 'SUCCESS', cleanUtr)"));
  assert.ok(route.includes("state: 'UTR_OBSERVED'"));
  console.log('  FIX_VERIFIED: untrusted references are observed without authoritative UTR reservation or money posting.');
});

console.log('UTR_HYPOTHESIS_DIAGNOSTIC_PASS '+checks+' checks.');
console.log('RESULT: Strong order correlation; UTR presence alone DOES NOT prove money credited.');
console.log('UTR_P0_REGRESSION_PASS: forged receipts and UTR-only claims are no longer credited.');
