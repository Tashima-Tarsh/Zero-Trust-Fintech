'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lib=require('../public/p2p-paymentrequest-probe');
const root=path.resolve(__dirname,'..');
const upi='upi://pay?pa=receiver@oksbi&pn=Receiver&am=1.00&cu=INR&tn=Payment';
const session={orderId:'PAY_P2P_1',paymentType:'P2P',upiUri:upi,amount:1,payeeVpa:'receiver@oksbi',expiresAt:Date.now()+90000};
test('P2P request uses personal UPI, without invented merchant category or reference',()=>{
 const data=lib.build(session,'https://disha8-2.thenitishkr.in');
 assert.ok(data);
 assert.equal(data.methods[0].supportedMethods,'https://tez.google.com/pay');
 assert.equal(data.methods[0].data.pa,'receiver@oksbi');
 assert.equal(data.methods[0].data.mc,undefined);
 assert.equal(data.methods[0].data.tr,undefined);
 assert.equal(data.details.total.amount.value,'1.00');
});
test('merchant and malformed personal payment input rejected',()=>{
 assert.equal(lib.build({...session,paymentType:'P2M'},'https://example.com'),null);
 assert.equal(lib.build({...session,upiUri:upi+'&mc=5411'},'https://example.com'),null);
 assert.equal(lib.build({...session,payeeVpa:'intruder@oksbi'},'https://example.com'),null);
 assert.equal(lib.build(session,'http://example.com'),null);
});
test('provider return is metadata only, never bank debit confirmation',()=>{
 const response={methodName:lib.METHOD,details:{tezResponse:JSON.stringify({Status:'SUCCESS',txnId:'123456789012',amount:'1.00',toVpa:'receiver@oksbi'}),signature:'signed-looking-string'}};
 const result=lib.inspect(response,{pa:'receiver@oksbi',amount:'1.00'});
 assert.equal(result.state,'ANDROID_PAYMENT_RESPONSE_OBSERVED');
 assert.equal(result.payeeMatched,true);
 assert.equal(result.amountMatched,true);
 assert.equal(result.signatureVerified,false);
 assert.equal(result.debitVerified,false);
 assert.equal(result.paymentVerified,false);
});
test('optional experiment is only shown on P2P and never writes to ledger',()=>{
 const html=fs.readFileSync(path.join(root,'public/checkout.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'public/cosmic-checkout.js'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(html,/id="p2pPaymentRequestProbe"[^>]*hidden/);
 assert.match(html,/id="p2pPaymentRequestCheck"/);
 assert.match(js,/mode==='generic'&&query\.get\('paymentrequest'\)==='1'/);
 assert.match(server,/'p2p-paymentrequest-probe\.js'/);
 const probe=fs.readFileSync(path.join(root,'public/p2p-paymentrequest-probe.js'),'utf8');
 assert.doesNotMatch(probe,/fetch\(|sendBeacon\(|XMLHttpRequest|ledger\//);
});
