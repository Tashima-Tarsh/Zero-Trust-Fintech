'use strict';
// Platform intent contract: protect the gateway-free QR, native-gesture,
// WebView dispatch and cross-device status design. Never add Collect.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const {buildUpiUri}=require('../utils/upi-intent.js');
const client=read('public/cosmic-checkout.js');
const java=read('tests/android/upi-receiver/app/src/main/java/ai/disha/testupi/TestBrowserActivity.java');
const pkg=JSON.parse(read('package.json'));
for(const page of ['public/checkout.html','public/merchant-checkout.html']){
 const html=read(page);
 assert.match(html,/<a id="qrTapToPay"[^>]*class="qr-tap-link"/);
 assert.match(html,/id="paymentQr"/);
 assert.match(html,/id="shareCheckout"/);
 for(const app of ['gpay','phonepe','paytm','bhim'])
  assert.match(html,new RegExp('data-upi-app="'+app+'"'),'Missing explicit UPI app choice');

 assert.doesNotMatch(html,/checkout\.razorpay\.com|razorpay\.js|collect-based|UPI Collect/i,
  'Checkout must stay native UPI Intent+QR, without gateway/collect integration');
}
assert.ok(!Object.keys(pkg.dependencies||{}).some(x=>/razorpay/i.test(x)),'No Razorpay SDK dependency');
assert.equal(model.supportsNativeUPI('Mozilla/5.0 (Linux; Android 15) Chrome'),true);
assert.equal(model.supportsNativeUPI('Mozilla/5.0 (Windows NT 10.0)'),false);
const original='upi://pay?pa=person@oksbi&pn=Person&am=1.00&cu=INR';
const chromeUa='Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/157.0 Mobile Safari/537.36';
const webViewUa='Mozilla/5.0 (Linux; Android 15; wv) Version/4.0 Chrome/157.0 Mobile Safari/537.36';
const fallback='https://checkout.example/checkout?paymentRef=PAY_123456&token='+('b'.repeat(48));
const chromeIntent=model.qrTapLaunchUri(original,chromeUa,fallback);
assert.match(chromeIntent,/^intent:\/\/pay\?pa=person@oksbi/);
assert.match(chromeIntent,/#Intent;scheme=upi;action=android.intent.action.VIEW;/);
const fallbackCode=chromeIntent.match(/S\.browser_fallback_url=([^;]+)/)?.[1];
assert.ok(fallbackCode,'Missing same-payment browser fallback');
assert.equal(new URL(decodeURIComponent(fallbackCode)).searchParams.get('paymentRef'),'PAY_123456');
assert.equal(new URL(decodeURIComponent(fallbackCode)).searchParams.get('upi_intent_fallback'),'1');
assert.equal(model.qrTapLaunchUri(original,webViewUa,fallback),original,'WebView must keep upi://pay');
assert.equal(model.qrTapLaunchUri(original,'Mozilla/5.0 (Windows NT 10.0)',fallback),original);
assert.equal(model.qrTapLaunchUri(original,'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',fallback),original);
assert.ok(!original.includes('token'),'Scannable QR carries no browser token');

assert.equal(model.supportsTargetedAppLaunch(chromeUa),true);
assert.equal(model.supportsTargetedAppLaunch(webViewUa),false,'Embedded WebView needs raw upi://pay');
assert.equal(model.supportsTargetedAppLaunch('Mozilla/5.0 (Linux; Android 15) SamsungBrowser/26 Chrome/129'),false);
const appPackages={gpay:'com.google.android.apps.nbu.paisa.user',phonepe:'com.phonepe.app',
 paytm:'net.one97.paytm',bhim:'in.org.npci.upiapp'};
for(const [app,pkg] of Object.entries(appPackages)){
 for(const type of [original,'upi://pay?pa=clinic@ypbiz&pn=Clinic&am=1.00&cu=INR&tr=PAY123456&mc=5411']){
  const targeted=model.appTapLaunchUri(type,chromeUa,fallback,app);
  assert.match(targeted,new RegExp('package='+pkg.replace(/\\./g,'\\\\.')+';'));
  assert.equal(targeted.split('#Intent')[0],chromeIntent.split('#Intent')[0].replace(
   original.slice(original.indexOf('?')+1),type.slice(type.indexOf('?')+1)),
   'App selection cannot alter the P2P or P2M payment fields');
  const fb=targeted.split('S.browser_fallback_url=')[1]?.split(';')[0];
  assert.equal(new URL(decodeURIComponent(fb)).searchParams.get('paymentRef'),'PAY_123456',
   'App missing fallback must recover the original order');
 }
 assert.equal(model.appTapLaunchUri(original,webViewUa,fallback,app),original);
 assert.equal(model.appTapLaunchUri(original,'Mozilla/5.0 (Windows NT 10.0)',fallback,app),original);
}
assert.throws(()=>model.appTapLaunchUri(original,chromeUa,fallback,'arbitrary_package'),/Unsupported UPI app/);

const click=client.slice(client.indexOf("get('qrTapToPay').addEventListener('click'"),client.indexOf("get('shareCheckout').addEventListener"));
assert.match(click,/trace\('APP_DISPATCH'/);
assert.match(click,/qrTapStartedAt=Date\.now\(\)/);
assert.doesNotMatch(click,/\bawait\b|fetch\(|authorize\(/,
 'Native QR link must preserve synchronous user gesture');
assert.match(client,/qrAppBackgrounded/);
assert.match(client,/qrTapLaunchUri\(session\.upiUri,userAgent,secureCheckoutUrl\(true\)\)/);
assert.match(client,/UPI app returned quickly/);
assert.match(java,/shouldOverrideUrlLoading\(WebView view, WebResourceRequest request\)/);
assert.match(java,/"upi"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
assert.match(java,/"pay"\.equalsIgnoreCase\(uri\.getHost\(\)\)/);
assert.match(java,/new Intent\(Intent\.ACTION_VIEW, uri\)/);
assert.match(java,/return false;/,'HTTP(S) navigation must not be hijacked as UPI intents');
const personal=new URL(buildUpiUri({kind:'P2P',pa:'person@oksbi',pn:'Person',am:1,tn:'Medical'}));
assert.equal(personal.searchParams.get('mc'),null);
assert.equal(personal.searchParams.get('tr'),null);
const merchant=new URL(buildUpiUri({kind:'P2M',pa:'clinic@ypbiz',pn:'Clinic',am:1,mc:'8099',
 tr:'PAY1234567890ABCDEF',tn:'Medical consultation'}));
assert.equal(merchant.searchParams.get('mc'),'8099');
assert.equal(merchant.searchParams.get('tr'),'PAY1234567890ABCDEF');
assert.equal(merchant.searchParams.get('tn'),'Medical consultation');
assert.equal(merchant.searchParams.get('cu'),'INR');
assert.equal(merchant.searchParams.get('am'),'1.00');
assert.equal(merchant.searchParams.get('pa'),'clinic@ypbiz');
const fixture=read('tests/android/fixture-server.js');
assert.ok(fixture.includes("'/__test/kind'"),'P2P/P2M Android fixture required');
assert.ok(fixture.includes('merchantUri'),'Merchant QR bank field fixture required');
console.log('UPI_INTENT_PLATFORM_PASS: direct QR tap, Android WebView bridge, no Collect/SDK, P2P/P2M, server status');
