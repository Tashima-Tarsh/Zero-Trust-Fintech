'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../public/sms-sensor-evidence-probe');
const root=path.resolve(__dirname,'..');
const session={orderId:'SMS_SENSOR_1',paymentType:'P2P',amount:1,
 payeeVpa:'receiver@oksbi',expiresAt:Date.now()+120000};
const sms='Your account was debited Rs. 1.00 for transfer to receiver@oksbi UPI Ref 123456789012';
test('extracts user supplied SMS fields without asserting SMS origin',()=>{
 const p=api.parseSms(sms);
 assert.equal(p.state,'DEBIT_WORDS_OBSERVED');
 assert.equal(p.amountPaise,100);
 assert.equal(p.vpa,'receiver@oksbi');
 assert.equal(p.reference,'123456789012');
});
test('matched SMS and sensor remains unverified',()=>{
 const r=api.assess(session,sms,{samples:40});
 assert.equal(r.state,'USER_SUPPLIED_SMS_FIELDS_MATCH');
 assert.equal(r.sensorContextObserved,true);
 assert.equal(r.smsOriginVerified,false);
 assert.equal(r.debitVerified,false);
 assert.equal(r.paymentVerified,false);
});
test('rejects reversal, mismatches, timeout and invalid money',()=>{
 assert.equal(api.assess(session,sms.replace('debited','credited'),{}).state,'INSUFFICIENT_SMS_CORRELATION');
 assert.equal(api.assess(session,sms.replace('1.00','2.00'),{}).amountMatch,false);
 assert.equal(api.assess(session,sms.replace('receiver@oksbi','wrong@oksbi'),{}).payeeMatch,false);
 assert.equal(api.assess({...session,expiresAt:Date.now()-1},sms,{}).state,'SESSION_EXPIRED');
 assert.equal(api.money('1e3'),null);
 assert.equal(api.money('1.001'),null);
 assert.equal(api.parseSms('x'.repeat(2001)).state,'INVALID_SMS');
});
test('UI and runtime are gated and have no backend evidence promotion',()=>{
 const script=fs.readFileSync(path.join(root,'public/sms-sensor-evidence-probe.js'),'utf8');
 assert.doesNotMatch(script,/fetch\s*\(|sendBeacon\s*\(|XMLHttpRequest|paymentVerified\s*:\s*true|debitVerified\s*:\s*true/);
 for(const p of ['public/checkout.html','dist/checkout.html','disha-cinematic/public/checkout.html','disha-cinematic/dist/checkout.html']){
  assert.match(fs.readFileSync(path.join(root,p),'utf8'),/sms-sensor-evidence-probe\.js/);
 }
 for(const p of ['public/cosmic-checkout.js','dist/cosmic-checkout.js','disha-cinematic/public/cosmic-checkout.js','disha-cinematic/dist/cosmic-checkout.js']){
  assert.match(fs.readFileSync(path.join(root,p),'utf8'),/DISHASmsSensorProbe\?\.attach/);
 }
 assert.match(fs.readFileSync(path.join(root,'server.js'),'utf8'),/'sms-sensor-evidence-probe\.js'/);
});
