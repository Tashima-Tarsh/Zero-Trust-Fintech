'use strict';
// Canonical UPI Intent + QR presentation: no gateway, Collect, WebAuthn,
// fake payment status or stale app-picker controls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const script=read('cosmic-checkout.js');
new vm.Script(script);
for(const page of ['checkout.html','merchant-checkout.html']){
 const html=read(page);
 for(const marker of ['id="paymentQr"','id="qrTapToPay"','id="paymentKind"',
  'id="paymentTrackingStatus"','id="shareCheckout"','id="receiptUtr"','id="receiptPaymentRef"'])
  assert.ok(html.includes(marker),'Missing canonical payment control: '+marker);
 assert.match(html,/data-stage="qr"/);
 assert.match(html,/data-stage="receipt"/);
 if(page==='merchant-checkout.html')assert.match(html,/\/vendor\/qrcode\.min\.js/);
 else assert.doesNotMatch(html,/\/vendor\/qrcode\.min\.js/,'Personal copy-only checkout must not preload QR renderer');
 assert.match(html,/\/cosmic-checkout\.js/);
 assert.match(html,/\/cosmic-checkout\.css/);
 assert.match(html,/src="\/assets\/disha-8-2-wordmark-cropped\.png"/);
 assert.doesNotMatch(html,/data-stage="initial"|data-stage="methods"|data-stage="checking"/,
  'No hidden alternate payment wizard allowed');
 assert.match(html,/id="vaultProceed"/,'Quantum Signal opt-in Proceed must be present');
 assert.match(html,/quantum-signal-client\.js/,'Bound browser signal transport must load');
 assert.match(html,/one-touch-vault\.js/,'Vault authorization must be available for opt-in');
 assert.doesNotMatch(html,/id="btnOneTouch"|id="app-gpay"|id="oneTouchFallback"/,
  'Legacy payment wizard must not return');
 assert.doesNotMatch(html,/Collect-Based|Razorpay Checkout|Manual UTR|NPCI Clearing|T\+0 Settlement/i);
 assert.match(html,/cosmic-checkout\.css\?v=[A-Za-z0-9._-]+/,'Production CSS cache version');
}
assert.match(read('cosmic-checkout.css'),/prefers-reduced-motion/);
assert.match(read('checkout-moonlight.css'),/nasa-moon/);
assert.equal(model.isSettled({status:'SUCCESS',utr:'123456789012'}),true);
for(const caseData of [{status:'SUCCESS'},{status:'PENDING',utr:'123456789012'},
 {status:'SUCCESS',utr:'fake'},{status:'FAILED',utr:'123456789012'}])
 assert.equal(model.isSettled(caseData),false,'No receipt without valid recorded credit');
const exact='upi://pay?pa=store@oksbi&pn=Store&am=500.00&cu=INR';
assert.equal(model.qrPayload(exact),exact);
assert.throws(()=>model.qrPayload('https://evil.example/upi'),/UPI/);
assert.match(script,/new window\.QRCode\(container,\{text:session\.upiUri/);
assert.match(script,/model\.qrTapLaunchUri\(session\.upiUri,userAgent,secureCheckoutUrl\(true\)\)/);
assert.match(script,/\/api\/ledger\//);
assert.match(script,/model\.isSettled\(/);
assert.match(script,/quantumEnabled=query\.get\('qs'\)==='1'/);
assert.match(script,/quantumClient\.prepare\(session\)/);
assert.match(script,/get\('vaultProceed'\)\.addEventListener\('click',event=>/);
assert.doesNotMatch(script,/userName=Device user/);
assert.doesNotMatch(script,/finalizePayment\(|\/api\/settlement\/confirm/,
 'Browser may not invent settlement');
console.log('COSMIC_CHECKOUT_PASS: Quantum Fusion copy-only personal route, merchant QR and confirmed-ledger receipt remain isolated');
