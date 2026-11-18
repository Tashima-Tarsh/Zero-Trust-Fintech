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
  assert.match(html,/Open UPI app/);
  const qr=await fetch(origin+'/vendor/qrcode.min.js');
  assert.equal(qr.status,200);
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
