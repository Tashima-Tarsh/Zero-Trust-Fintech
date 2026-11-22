'use strict';
/* Existing DISHA checkout + order-bound WebAuthn + consented WebOTP.
 * Transport test only; must never write payment success or UTR evidence.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const rootPath=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(rootPath,'public/android-checkout-handshake.js'),'utf8');
const checkout=fs.readFileSync(path.join(rootPath,'public/checkout.html'),'utf8');
const merchant=fs.readFileSync(path.join(rootPath,'public/merchant-checkout.html'),'utf8');
const paymentJs=fs.readFileSync(path.join(rootPath,'public/cosmic-checkout.js'),'utf8');
const worker=fs.readFileSync(path.join(rootPath,'public/_worker.js'),'utf8');
for(const html of [checkout,merchant]){
 for(const id of ['dishaHandshakeLab','dishaHandshakeConsent','dishaHandshakeStart','dishaHandshakeStop',
  'dishaHandshakeCopy','dishaHandshakeMessage','dishaHandshakeResult','dishaHandshakeCapability']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/android-checkout-handshake\.js/);
 assert.match(html,/Bank|bank/);
}
// After the Ponytail runtime fix, this experimental transport is delivered
// by Railway's canonical JS allowlist, not an independently deployed Pages asset.
const server=fs.readFileSync(path.join(rootPath,'server.js'),'utf8');
assert.match(server,/'android-checkout-handshake\\.js'/);
assert.doesNotMatch(worker,/checkoutFiles = new Set/);
assert.match(paymentJs,/DISHAAndroidCheckoutHandshake\?\.attach/);
assert.doesNotMatch(script,/(PAYER_DEBIT_VERIFIED|paymentVerified\s*:\s*true|fetch\s*\(|XMLHttpRequest)/);

function harness({enabled=true,webotp=true,vault=true,expire=200000}={}){
 const nodes={},listeners={},timers=[];
 let authCalls=0, authFinish, otpFinish, otpOptions, copied=null;
 const el=id=>nodes[id]||(nodes[id]={id,hidden:true,disabled:true,checked:false,textContent:'',value:'',events:{},
  addEventListener(k,fn){this.events[k]=fn}});
 const window={
  isSecureContext:true,
  OTPCredential:webotp?function OTPCredential(){}:undefined,
  AbortController,
  crypto:{getRandomValues(array){array[0]=42;return array}},
  location:{search:enabled?'?amount=1&androidHandshake=1':'?amount=1',hostname:'disha.example'},
  navigator:{credentials:{get(opts){otpOptions=opts;return new Promise(resolve=>{otpFinish=resolve})}},
   clipboard:{async writeText(content){copied=content}}},
  DISHAOneTouchVault:vault?{authorize(id){authCalls++;assert.equal(id,'ORD_TEST_100');
   return new Promise(resolve=>{authFinish=resolve})}}:null,
  addEventListener(type,fn){listeners[type]=fn},
  setTimeout(fn,ms){timers.push({fn,ms,cleared:false});return timers.length-1},
  clearTimeout(id){if(timers[id])timers[id].cleared=true}
 };
 if(!webotp)delete window.OTPCredential;
 vm.runInNewContext(script,{window,document:{getElementById:el},URLSearchParams,Uint32Array,Promise,Date,Error,Boolean,String});
 const handle=window.DISHAAndroidCheckoutHandshake;
 if(enabled)handle.attach({orderId:'ORD_TEST_100',expiresAt:Date.now()+expire});
 return {el,window,handle,timers,listeners,
  get authCalls(){return authCalls},get authFinish(){return authFinish},
  get otpFinish(){return otpFinish},get otpOptions(){return otpOptions},get copied(){return copied}};
}
async function flush(){for(let i=0;i<24;i++)await Promise.resolve()}
(async()=>{
 const normal=harness({enabled:false});
 assert.equal(normal.el('dishaHandshakeLab').hidden,true,'Not visible during normal checkout');
 assert.equal(normal.handle,undefined,'Feature must not initialize without flag');
 const sample=harness();
 assert.equal(sample.el('dishaHandshakeLab').hidden,false);
 assert.match(sample.el('dishaHandshakeResult').textContent,/READY_FOR_OPTIONAL_TEST/);
 sample.el('dishaHandshakeStart').events.click();await flush();
 assert.equal(sample.authCalls,0,'Consent required before WebAuthn');
 assert.match(sample.el('dishaHandshakeResult').textContent,/EXPLICIT_CONSENT_REQUIRED/);
 sample.el('dishaHandshakeConsent').checked=true;
 sample.el('dishaHandshakeStart').events.click();await flush();
 assert.equal(sample.authCalls,1,'Checkout reuses the real Vault authorization client');
 assert.equal(sample.otpOptions,undefined,'WebOTP must wait for WebAuthn');
 sample.authFinish({sessionId:'vault_session_id'});await flush();
 assert.deepEqual(Array.from(sample.otpOptions.otp.transport),['sms']);
 assert.match(sample.el('dishaHandshakeMessage').value,/@disha\.example #100042/);
 assert.equal(sample.timers[0].ms<=120000,true);
 assert.equal(sample.timers[0].ms>0,true);
 sample.el('dishaHandshakeCopy').events.click();await flush();
 assert.match(sample.copied,/@disha\.example #100042/);
 sample.otpFinish({code:'100042'});await flush();
 assert.match(sample.el('dishaHandshakeResult').textContent,/SMS_WEBOTP_CHANNEL_CONFIRMED — BANK_DEBIT_UNVERIFIED/);
 assert.equal(sample.el('dishaHandshakeMessage').value,'','Do not retain OTP after completion');
 assert.equal(sample.el('dishaHandshakeStart').disabled,false);
 assert.equal(sample.otpOptions.signal.aborted,true);
 const fake=harness();fake.el('dishaHandshakeConsent').checked=true;
 fake.el('dishaHandshakeStart').events.click();fake.authFinish({sessionId:'vault_test'});await flush();
 fake.otpFinish({code:'100043'});await flush();
 assert.match(fake.el('dishaHandshakeResult').textContent,/UNEXPECTED_SMS_CODE_REJECTED/);
 const stale=harness();stale.el('dishaHandshakeConsent').checked=true;
 stale.el('dishaHandshakeStart').events.click();stale.authFinish({sessionId:'vault_test'});await flush();
 stale.timers[0].fn();
 assert.match(stale.el('dishaHandshakeResult').textContent,/EXPIRED_120_SECONDS/);
 assert.equal(stale.otpOptions.signal.aborted,true);
 const revoked=harness();revoked.el('dishaHandshakeConsent').checked=true;
 revoked.el('dishaHandshakeStart').events.click();revoked.el('dishaHandshakeConsent').checked=false;
 revoked.el('dishaHandshakeConsent').events.change();
 revoked.authFinish({sessionId:'vault_test'});await flush();
 assert.equal(revoked.otpOptions,undefined,'Revocation during biometric auth prevents SMS listener');
 assert.match(revoked.el('dishaHandshakeResult').textContent,/CONSENT_REVOKED/);
 const noOtp=harness({webotp:false});noOtp.el('dishaHandshakeConsent').checked=true;
 noOtp.el('dishaHandshakeStart').events.click();await flush();
 assert.equal(noOtp.authCalls,0);assert.match(noOtp.el('dishaHandshakeResult').textContent,/WEBOTP_UNAVAILABLE/);
 const noVault=harness({vault:false});noVault.el('dishaHandshakeConsent').checked=true;
 noVault.el('dishaHandshakeStart').events.click();await flush();
 assert.match(noVault.el('dishaHandshakeResult').textContent,/WEBAUTHN_UNAVAILABLE/);
 const expired=harness({expire:-1});expired.el('dishaHandshakeConsent').checked=true;
 expired.el('dishaHandshakeStart').events.click();await flush();
 assert.equal(expired.authCalls,0);assert.match(expired.el('dishaHandshakeResult').textContent,/CHECKOUT_EXPIRED/);
 const exit=harness();exit.el('dishaHandshakeConsent').checked=true;
 exit.el('dishaHandshakeStart').events.click();exit.authFinish({sessionId:'vault_test'});await flush();
 exit.listeners.pagehide();assert.equal(exit.otpOptions.signal.aborted,true);
 assert.match(exit.el('dishaHandshakeResult').textContent,/PAGE_EXITED/);
 console.log('ANDROID_CHECKOUT_HANDSHAKE_PASS: checkout P2P/P2M, opt-in, WebAuthn-before-WebOTP, 120s, wrong OTP, expiry, revocation, no settlement');
})().catch(e=>{console.error(e);process.exitCode=1});
