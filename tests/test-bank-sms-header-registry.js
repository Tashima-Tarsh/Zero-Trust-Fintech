'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseSender,lookupBankSender,coverage}=require('../financial/bank-sms-header-registry');

test('matches official bank-published core header without implying debit',()=>{
 const r=lookupBankSender('AD-SBIUPI-S');
 assert.equal(r.matched,true);
 assert.equal(r.matches[0].bankName,'State Bank of India');
 assert.equal(r.debitVerified,false);
 assert.equal(r.paymentVerified,false);
 assert.equal(r.proofOfOrigin,false);
});
test('rejects numeric phone numbers and invalid sender strings',()=>{
 for(const value of ['9876543210','+919876543210','123456','AX-SBIUPI-S<script>']){
   assert.equal(lookupBankSender(value).matched,false);
 }
});
test('unknown bank identity fails closed',()=>{
 const r=lookupBankSender('AX-FAKEBK-T');
 assert.equal(r.matched,false);
 assert.equal(r.paymentVerified,false);
});
test('all registry entries remain research-only',()=>{
 const c=coverage();
 assert.equal(c.bankCount,121);
 assert.equal(c.banksWithPublishedHeaders,3);
 assert.equal(c.headerEntries,8);
 assert.equal(c.currentTraiVerified,0);
 assert.equal(c.paymentVerificationSupported,false);
});
test('parses purpose suffix without treating it as authenticity',()=>{
 const p=parseSender('AX-SBIBNK-T');
 assert.equal(p.kind,'T');
 const r=lookupBankSender('AX-SBIBNK-T');
 assert.equal(r.matched,true);
 assert.equal(r.debitVerified,false);
});
