'use strict';
const assert=require('node:assert/strict');
const {verify,parse}=require('../scripts/upi-acceptance-harness');
const {buildUpiUri}=require('../utils/upi-intent');
const p2p=buildUpiUri({kind:'P2P',pa:'actual@oksbi',pn:'Actual Payee',am:1,tn:'UPI intent'});
const p2m=buildUpiUri({kind:'P2M',pa:'company@ypbiz',pn:'Company Account',am:499.01,
 mc:'5411',tr:'PAYAABBCCDDEEFF001122334455',tn:'Medical consultation'});
const bankP2m='upi://pay?pa=company@ypbiz&pn=Company%20Account&am=499.01&cu=INR&mc=5411&tn=Service';
assert.equal(verify({kind:'P2P',checkoutUri:p2p}).ok,true,'Personal UPI no fabricated merchant details');
assert.equal(verify({kind:'P2M',checkoutUri:p2m,bankUri:bankP2m}).ok,true,'Merchant QR matches registered recipient and category');
function has(kind,uri,bank,code){
 const o=verify({kind,checkoutUri:uri,bankUri:bank});
 assert.ok(o.problems.includes(code),code+' missing: '+JSON.stringify(o.problems));
}
has('P2M',p2p,null,'P2M_REAL_MCC_REQUIRED');
has('P2M',p2p,null,'P2M_UNIQUE_TRANSACTION_REFERENCE_REQUIRED');
has('P2P',p2m,null,'P2P_MUST_NOT_FABRICATE_MERCHANT_FIELDS');
has('P2M',p2m,bankP2m.replace('company@ypbiz','other@ypbiz'),'RECEIVING_VPA_DIFFERS_FROM_BANK_QR');
has('P2M',p2m,bankP2m.replace('mc=5411','mc=5812'),'MCC_DIFFERS_FROM_BANK_QR');
has('P2M',p2m,bankP2m.replace('Company%20Account','Other%20Account'),'PAYEE_NAME_DIFFERS_FROM_BANK_QR');
for(const fragment of ['&pa=imposter@oksbi','&am=500.00','&mc=5812','&tr=PAYDUPLICATE'])
 assert.throws(()=>parse(p2m+fragment),/DUPLICATE_/,'Duplicated UPI authority field must fail closed');
assert.throws(()=>parse(p2m.replace('tn=Medical%20consultation','tn=Order_1234')),/LEGACY_RECORD_WORD_IN_NOTE/);
assert.throws(()=>parse(p2p.replace('am=1.00','am=1.000')),/INVALID_AMOUNT/);
assert.throws(()=>parse(p2p.replace('pa=actual@oksbi','pa=bad')),/INVALID_RECEIVING_VPA/);
assert.equal(verify({kind:'P2M',checkoutUri:p2m}).bankAcceptanceTested,false);
console.log('UPI_ACCEPTANCE_HARNESS_PASS: P2P/P2M, real-payee bank QR comparison, MCC, exact reference, duplicates, legacy notes');
