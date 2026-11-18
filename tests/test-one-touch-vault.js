'use strict';
// No bank API, no real biometric or real money. Pure browser contract tests
// against the exact one-touch script that is shipped to customers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(dir,'public','one-touch-vault.js'),'utf8');
const page=fs.readFileSync(path.join(dir,'public','checkout.html'),'utf8');
const merchant=fs.readFileSync(path.join(dir,'public','merchant-checkout.html'),'utf8');
const cosmic=fs.readFileSync(path.join(dir,'public','cosmic-checkout.js'),'utf8');
const server=fs.readFileSync(path.join(dir,'server.js'),'utf8');
const edge=fs.readFileSync(path.join(dir,'public','_worker.js'),'utf8');
const routes=fs.readFileSync(path.join(dir,'public','_routes.json'),'utf8');

assert.match(page,/id="btnOneTouch"/);
assert.match(cosmic,/vault\.authorize\(orderId\(\),\(event,code\)=>trace\(event,code\)\)/);
assert.match(page,/id="oneTouchFallback"/);
assert.doesNotMatch(cosmic,/await checkPasskeyStatus\(userId, userName\)/,
  'Page must not ask a biometric before the user presses Touch to Pay');
assert.doesNotMatch(page,/window\.addEventListener\('pagehide', async/,
  'Switching to the UPI app must not trigger a fake cancellation');
assert.match(merchant,/id="oneTouchFallback"/);
assert.match(cosmic,/vault\.authorize\(orderId\(\),\(event,code\)=>trace\(event,code\)\)/);
assert.match(edge,/\/vendor\/simplewebauthn\.umd\.js/);
assert.match(routes,/\/vendor\/simplewebauthn\.umd\.js/);
assert.match(server,/status:'VAULT_VERIFIED_AWAITING_UPI'/);
assert.match(server,/Math\.min\(Date\.now\(\)\+180000,order\.expiresAt\)/);

(async()=>{
  let registrationPrompts=0,authenticationPrompts=0,registered=false,opened=null;
  const storage=new Map();
  const window={
    crypto:{randomUUID:()=> 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      getRandomValues:bytes=>{bytes.fill(9);return bytes}},
    location:{assign: uri=>{opened=uri}},
    SimpleWebAuthnBrowser:{
      startRegistration:async()=>{registrationPrompts++;return {id:'CI_NEW_PASSKEY'}},
      startAuthentication:async()=>{authenticationPrompts++;return {id:'CI_SAVED_PASSKEY'}}
    }
  };
  const response=(code,data)=>({ok:code<400,status:code,json:async()=>data});
  const fetch=async(url,opts)=>{
    assert.equal(opts.method,'POST');
    const request=JSON.parse(opts.body);
    if(url.endsWith('/authenticate/start')){
      if(!registered)return response(400,{needsRegistration:true,error:'REGISTER_FIRST'});
      return response(200,{success:true,sessionId:'CI_EXISTING',publicKey:{}});
    }
    if(url.endsWith('/register/start'))
      return response(200,{success:true,sessionId:'CI_REGISTRATION',publicKey:{}});
    if(url.endsWith('/register/finish')){
      registered=true;
      return response(200,{success:true,sessionId:'CI_REGISTRATION',orderId:'ORD_TEST_1234'});
    }
    if(url.endsWith('/authenticate/finish'))
      return response(200,{success:true,sessionId:'CI_EXISTING',orderId:'ORD_TEST_1234'});
    throw Error('Unexpected endpoint '+url);
  };
  const localStorage={
    getItem:k=>storage.get(k)||null,
    setItem:(k,v)=>storage.set(k,v)
  };
  vm.runInNewContext(script,{window,localStorage,fetch,Uint8Array,console});
  const api=window.DISHAOneTouchVault;
  const identity=api.getDeviceUserId();
  assert.equal(identity,'vault_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(api.getDeviceUserId(),identity,'Stable same-device user ID');
  const first=await api.authorize('ORD_TEST_1234');
  assert.equal(first.sessionId,'CI_REGISTRATION');
  assert.equal(first.registered,true);
  assert.equal(registrationPrompts,1);
  assert.equal(authenticationPrompts,0,'First-time registration must NOT force another prompt');
  const returning=await api.authorize('ORD_TEST_1234');
  assert.equal(returning.sessionId,'CI_EXISTING');
  assert.equal(returning.registered,false);
  assert.equal(authenticationPrompts,1,'Returning device only prompts once');
  assert.equal(registrationPrompts,1);
  const uri='upi://pay?pa=qa-receiver%40oksbi&am=499.01&cu=INR';
  api.launchUPI(uri);
  assert.equal(opened,uri,'Launch requested after vault authorization');
  assert.throws(()=>api.launchUPI('https://evil.example/pay'),/valid UPI destination/);
  console.log('ONE_TOUCH_VAULT_PASS: first-time 1 registration prompt, return 1 auth prompt, stable identity, UPI handoff, no app-switch cooldown.');
})().catch(e=>{console.error(e);process.exitCode=1});
