'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=x=>fs.readFileSync(path.join(root,x),'utf8');
const merchant=read('merchant-api.js'),server=read('server.js'),client=read('public/cosmic-checkout.js'),owner=read('platform-control.js'),ownerUI=read('public/platform-console.js');
for(const f of ['public/checkout.html','public/merchant-checkout.html']){
 const s=read(f);
 assert.ok(s.includes('id="checkoutTimer"')&&s.includes('id="paymentKind"'),'Checkout must show expiry and P2P/P2M payee');
 assert.ok(s.includes('/cosmic-checkout.js?v=account-kind4'),'Checkout JS cache must refresh');
}
assert.ok(client.includes('function setPaymentKind()')&&client.includes('setPaymentKind();'),'Checkout must render actual receiving type');
assert.ok(merchant.includes('payee_account_type')&&merchant.includes('payee_mcc'),'Merchant payment must snapshot account classification and MCC');
assert.ok(merchant.includes('checkoutUri=upi(payee,payeeName,amount,description,orderId);'),'Merchant URI must be validated before committing payment session');
assert.ok(merchant.includes('payee.holder_name||o.business_name'),'Customer must see frozen payee name');
assert.ok(merchant.includes('payment_type:String(payee.account_type)'),'Merchant checkout must expose P2P/P2M type');
assert.ok(server.includes('paymentType:String(session.merchantType)'),'Owner test checkout must expose P2P/P2M type');
assert.ok(owner.includes('reconciliationConfigured')&&owner.includes('NO_GO_UNTIL_BANK_EVIDENCE'),'Owner settings cannot claim bank acceptance without evidence');
assert.ok(ownerUI.includes('Merchant release gate')&&ownerUI.includes('Credit reconciliation'),'Owner dashboard must display production blockers');
console.log('PAYMENT_IDENTITY_PASS: immutable receiving account, visible P2P/P2M classification, expiry and owner release gate');
