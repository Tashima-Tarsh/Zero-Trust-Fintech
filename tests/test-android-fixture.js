'use strict';
// CI-only test of the same exact checkout response used by Android emulators.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const child=spawn(process.execPath,[path.join(__dirname,'android','fixture-server.js')],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,DISHA_ANDROID_FIXTURE_ONLY:'1',NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe']
 });
 const origin='http://127.0.0.1:8765';
 let logs='';
 child.stdout.on('data',b=>logs+=b.toString());
 child.stderr.on('data',b=>logs+=b.toString());
 try{
  let ready=false;
  for(let n=0;n<40;n++){
   try{if((await fetch(origin+'/health')).ok){ready=true;break}}catch(_){}
   await new Promise(resolve=>setTimeout(resolve,120));
  }
  assert.ok(ready,'test fixture startup failed '+logs);
  const order='ORD_ANDROID_CI_1001';
  const url=origin+'/api/merchant/public/order/'+order+'?token='+('b'.repeat(48));
  const noToken=await fetch(origin+'/api/merchant/public/order/'+order);
  assert.equal(noToken.status,404);
  const data=await(await fetch(url)).json();
  assert.equal(data.success,true);
  assert.equal(data.order.amount,499.01);
  const uri=new URL(data.order.upi_uri);
  assert.equal(uri.protocol,'upi:');
  assert.equal(uri.hostname,'pay');
  assert.equal(uri.searchParams.get('pa'),'qa-receiver@oksbi');
  assert.equal(uri.searchParams.get('am'),'499.01');
  assert.equal(uri.searchParams.get('cu'),'INR');
  assert.equal(uri.searchParams.has('mc'),false,'P2P QR/URI must not include an MCC');
  assert.equal(data.order.status,'PENDING','opening link never settles payment');
  const html=await(await fetch(origin+'/merchant-checkout.html')).text();
  assert.match(html,/<button id="btnOneTouch"[\s\S]*?<span>Pay<\/span>/,'Checkout must show compact Pay CTA while retaining Vault handler');
  assert.doesNotMatch(html,/Touch to Pay/);
  assert.match(html,/cosmic-checkout\.js/);
  // Regression: the real checkout HTML must load its exact JS/CSS URLs from
  // this fixture, not just legacy root assets that the page no longer uses.
  const required=[
   '/api/runtime-assets/cosmic-checkout.css',
   '/api/runtime-assets/checkout-moonlight.css',
   '/api/runtime-assets/one-touch-vault.js',
   '/api/runtime-assets/cosmic-checkout-model.js',
   '/api/runtime-assets/cosmic-checkout.js'
  ];
  const linked=[...html.matchAll(/(?:src|href)="(\\/(?:api\\/runtime-assets\\/|vendor\\/)[^"?]+)(?:\\?[^"]*)?"/g)]
   .map(match=>match[1]);
  for(const asset of required)assert.ok(linked.includes(asset),'Checkout must load '+asset);
  for(const asset of linked){
   const response=await fetch(origin+asset);
   assert.equal(response.status,200,'Android fixture must serve checkout asset '+asset);
   assert.ok((await response.text()).length>0,'Checkout asset must not be empty: '+asset);
  }
  const passkey=await fetch(origin+'/vendor/simplewebauthn.umd.js');
  assert.equal(passkey.status,200);
  const oneTouch=await fetch(origin+'/one-touch-vault.js');
  assert.equal(oneTouch.status,200);
  const qr=await fetch(origin+'/vendor/qrcode.min.js');
  assert.equal(qr.status,200);
  const make=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const vaultUser='vault_android_ci';
  const authFirst=await fetch(origin+'/api/webauthn/authenticate/start',make({
    userId:vaultUser,orderId:order}));
  assert.equal(authFirst.status,400);
  assert.equal((await authFirst.json()).needsRegistration,true);
  const regStart=await(await fetch(origin+'/api/webauthn/register/start',
    make({userId:vaultUser,orderId:order,userName:'CI Vault'}))).json();
  assert.match(regStart.sessionId,/^[0-9a-f]{32}$/i,'Test fixture must use production-compatible Vault IDs');
  const regDone=await(await fetch(origin+'/api/webauthn/register/finish',
    make({sessionId:regStart.sessionId,credential:{id:'CI_PASSKEY'}}))).json();
  assert.equal(regDone.sessionId,regStart.sessionId);
  const authNext=await(await fetch(origin+'/api/webauthn/authenticate/start',
    make({userId:vaultUser,orderId:order}))).json();
  assert.match(authNext.sessionId,/^[0-9a-f]{32}$/i);
  const authDone=await(await fetch(origin+'/api/webauthn/authenticate/finish',
    make({sessionId:authNext.sessionId,credential:{id:'CI_PASSKEY'}}))).json();
  assert.equal(authDone.sessionId,authNext.sessionId);
  async function change(value){
   const r=await fetch(origin+'/__test/state?value='+value,{method:'POST',
    headers:{'X-CI-Fixture-Key':'CI_ANDROID_ONLY'}});
   assert.equal(r.status,200);
   assert.equal((await(await fetch(url)).json()).order.status,value);
  }
  await change('COMPLETED');
  await change('EXPIRED');
  await change('FAILED');
  console.log('ANDROID FIXTURE: exact P2P URI, missing MCC, QR asset, token, pending, completed, expired, failed PASS');
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,1000)}});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
