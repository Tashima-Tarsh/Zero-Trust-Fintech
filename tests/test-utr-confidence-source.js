'use strict';
/* No bank API; no real money. Test the actual production receipt extractor and
 * confidence engine against wholly fabricated customer-origin data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {scoreEvidence,suggestAction,TIERS}=require('../utils/trust-score');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const begin=source.indexOf('function extractReceiptEvidence(');
const end=source.indexOf("app.post('/api/verify',",begin);
assert.ok(begin>=0&&end>begin);
const extract=new Function('"use strict";\n'+source.slice(begin,end)+'\nreturn extractReceiptEvidence;')();
const now=Date.now();
const session={challengeAmount:499.01,createdAt:now-30000,expiresAt:now+150000,payeeVpa:'qa-receiver@oksbi',payeeName:'DISHA QA Merchant'};
const utr='631902884112';
function score(text) {
 const parsed=extract(text,session);
 return scoreEvidence(session,{...parsed,utr,amount:499.01},
  {utrSeen:false,imageHashSeen:false,priorConfirmed:0,attemptsThisSession:1},
  {now,sameDevice:true});
}
const fabricated='UPI Payment Successful\nDISHA QA Merchant\nTo: qa-receiver@oksbi\nAmount INR 499.01\nUTR: '+utr+'\nDate: Today';
const fake=score(fabricated);
assert.notEqual(fake.tier,'HIGH','Customer-authored successful receipt must never achieve HIGH');
assert.ok(fake.score<TIERS.HIGH,'Fake receipt must not receive HIGH confidence');
assert.equal(fake.verified,false);
assert.equal(fake.gate,'UNVERIFIED_RECEIPT_SOURCE');
assert.equal(suggestAction(fake,499.01),'DO_NOT_RELEASE');
const contradictory=score(fabricated+'\nPayment FAILED');
assert.equal(contradictory.tier,'REJECT');
assert.equal(contradictory.gate,'STATUS_FAILED');
const pending=score(fabricated+'\nStatus pending processing');
assert.equal(pending.tier,'REJECT');
assert.equal(pending.gate,'STATUS_PENDING');
const wrongPayee=score(fabricated.replace('qa-receiver@oksbi','someone@oksbi'));
assert.equal(wrongPayee.gate,'PAYEE_MISMATCH');
const mismatched=scoreEvidence(session,{...extract(fabricated,session),utr,amount:499.02},{},{now});
assert.equal(mismatched.gate,'AMOUNT_MISMATCH');
const reused=scoreEvidence(session,{...extract(fabricated,session),utr,amount:499.01},{utrSeen:true},{now});
assert.equal(reused.gate,'UTR_REUSED');
console.log('UTR_SOURCE_SECURITY_PASS fake receipt score='+fake.score+' tier='+fake.tier+
' (non-settling), failed/pending precedence, wrong payee, wrong amount, replay.');
