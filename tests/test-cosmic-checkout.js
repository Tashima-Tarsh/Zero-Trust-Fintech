'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..','public');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const pages=['checkout.html','merchant-checkout.html'].map(read);
const script=read('cosmic-checkout.js');
const model=require('../public/cosmic-checkout-model.js');
new vm.Script(script);
for(const html of pages){
 assert.match(html,/\/cosmic-checkout\.css/);
 assert.match(html,/\/cosmic-checkout\.js/);
 assert.match(html,/\/one-touch-vault\.js/);
 assert.match(html,/\/vendor\/qrcode\.min\.js/);
 assert.match(html,/src="\/assets\/disha-8-2-wordmark-cropped\.png"/);
 assert.match(html,/id="btnOneTouch"/);
 assert.match(html,/data-stage="initial"/);
 assert.match(html,/data-stage="methods"/);
 assert.match(html,/data-stage="qr"/);
 assert.match(html,/data-stage="checking"/);
 assert.match(html,/data-stage="receipt"/);
 assert.match(html,/id="app-gpay"/);
 assert.match(html,/id="app-phonepe"/);
 assert.match(html,/id="app-paytm"/);
 assert.match(html,/id="paymentQr"/);
 assert.match(html,/id="receiptAmount"/);
 const beforeMethods=html.split('data-stage="methods"')[0];
 assert.doesNotMatch(beforeMethods,/id="paymentQr"|id="app-gpay"/,
  'QR and native app launch must never be exposed before Touch to Pay');
 assert.doesNotMatch(html,/WhatsApp|T\+0 Settlement|WebAuthn \+ UPI Rail|Direct NPCI Clearing|7-Layer/);
}
assert.match(read('cosmic-checkout.css'),/prefers-reduced-motion/);
assert.match(read('cosmic-checkout.css'),/perspective/);
assert.match(read('cosmic-checkout.css'),/max-width:\s*420px/);
assert.equal(model.stageAfterAuthorization(null),'methods');
assert.equal(model.stageAfterAuthorization('phonepe'),'methods','Preferred app gets a method fallback if launch is blocked');
assert.equal(model.isSettled({status:'SUCCESS',utr:'123456789012'}),true);
assert.equal(model.isSettled({status:'SUCCESS',utr:''}),false);
assert.equal(model.isSettled({status:'PENDING',utr:'123456789012'}),false);
assert.equal(model.isSettled({status:'SUCCESS'}),false);
const originalBrowserError=Object.assign(new Error(
 'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.'
),{name:'NotAllowedError'});
for(const problem of [originalBrowserError,Object.assign(new Error('Private browser message'),{name:'SecurityError'}),new Error('secret server response')]){
 const displayed=model.userFacingError(problem,'device');
 assert.match(displayed,/^Error\b/);
 assert.doesNotMatch(displayed,/w3\.org|webauthn|timed out|not allowed|Private browser|secret server/i,
  'Private browser, policy and server diagnostics must not appear in checkout UI');
}
assert.match(model.userFacingError(new TypeError('fetch failed'),'device'),/^Error/);
assert.match(model.userFacingError(new Error('HTTP 500'),'load'),/^Error/);
assert.match(script,/message\(model\.userFacingError\(err,'device'\),'error'\)/);
assert.match(script,/locked\(model\.userFacingError\(err,'load'\)\)/);
assert.doesNotMatch(script,/message\(err\?\.message|locked\(err\?\.message/);
const backdrop=read('assets/disha-universe-background.svg');
assert.match(backdrop,/data:image\/jpeg;base64,/,'Bundled photographic asset must be self-contained');
const assetData=backdrop.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)?.[1];
assert.ok(assetData && Buffer.from(assetData,'base64').length>20000,'Magnific universe asset must contain raster image bytes');
assert.match(read('cosmic-checkout.css'),/\/assets\/disha-universe-background\.svg/);
assert.equal(model.safeApp('googlepay'),'gpay');
assert.equal(model.safeApp('invalid'),'generic');
const qr=model.qrPayload('upi://pay?pa=store%40oksbi&am=500.00&cu=INR');
assert.match(qr,/^upi:\/\/pay\?/);
assert.throws(()=>model.qrPayload('https://example.com/bogus'),/UPI/i);
assert.match(script,/vault\.authorize\(orderId\(\)\)/);
assert.match(script,/vault\.beginHandoff\(orderId\(\),vaultSessionId,session\.token\)/);
assert.match(script,/requestEvidence\(orderId\(\)\)/);
assert.match(script,/fetch\('\/api\/vault\/evidence'/);
assert.match(script,/acknowledgeEvidence\(orderId\(\),packet\.eventId,result\)/);
assert.match(script,/\/api\/ledger\//,'Receipt must be established from backend ledger');
assert.match(script,/model\.isSettled\(/);
assert.match(script,/QRCode/);
assert.match(script,/history|localStorage/);
console.log('COSMIC_CHECKOUT_PASS: touch-first, native apps/QR gated, real evidence and ledger-only receipt');
