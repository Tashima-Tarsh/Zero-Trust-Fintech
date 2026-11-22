'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createCheckoutDiagnostics,validEvent}=require('../financial/checkout-diagnostics');
const token='a'.repeat(48),orderId='ORD_TRACE_TEST_123';
const valid={orderId,token,event:'VAULT_AUTH_PROMPT',code:'OK',app:'phonepe',device:'android'};
assert.ok(validEvent(valid));

for(const [event,code,app] of [
 ['ORDER_READY','OK','none'],['APP_DUPLICATE_BLOCKED','OK','none'],['APP_DISPATCH','APP_GENERIC','generic'],
 ['APP_DISPATCH','APP_TARGETED','gpay'],['APP_DISPATCH','APP_TARGETED','paytm'],
 ['APP_DISPATCH','APP_TARGETED','bhim'],['BROWSER_RETURN','RETURN_FAST','none'],
 ['BROWSER_RETURN','RETURN_NORMAL','none'],['APP_ERROR','APP_NAVIGATION_ERROR','none']
]){
 assert.ok(validEvent({...valid,event,code,app}),
  'Every emitted checkout event must be accepted by diagnostics: '+event+'/'+code+'/'+app);
}

const fs=require('node:fs'),path=require('node:path');
const checkoutScript=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
assert.match(checkoutScript,/trace\('ORDER_READY'\)/);
assert.match(checkoutScript,/trace\('BROWSER_RETURN',early\?'RETURN_FAST':'RETURN_NORMAL'\)/);
assert.match(checkoutScript,/trace\('APP_ERROR','APP_NAVIGATION_ERROR'\)/);

for(const p of ['checkout.html','merchant-checkout.html']){
 const html=fs.readFileSync(path.join(__dirname,'../public',p),'utf8');
 assert.match(html,/id="checkoutDebugPanel"/,'Debug banner must be present on test checkout');
 assert.match(html,/id="checkoutDebugCopy"/,'Debug history must be copyable');
 assert.match(html,/\/api\/runtime-assets\/cosmic-checkout\.js\?v=[A-Za-z0-9._-]+/,'Checkout JS must be cache-versioned');
}
assert.match(checkoutScript,/diag\.hidden=false/,'Diagnostic panel visible only with opt-in');
assert.match(checkoutScript,/if\(!debug\|\|!session\?\.token/,'No default customer telemetry');
assert.match(checkoutScript,/navigator\.clipboard\?\.writeText/,'Safe local report can be copied');
assert.equal(validEvent({...valid,pin:'1234'}),null,'PIN fields may never enter a diagnostic event');
assert.equal(validEvent({...valid,rawError:'private browser response'}),null,'Never accept raw error strings');
assert.equal(validEvent({...valid,event:'BANK_PAYMENT_SUCCESS'}),null,'A trace cannot assert financial success');
assert.equal(validEvent({...valid,code:'Error: Passkey private response'}),null,'Only approved error codes allowed');
assert.equal(validEvent({...valid,device:'Lenovo-A15-IMEI'}),null,'No user device identifiers');
assert.equal(validEvent({...valid,app:'untrusted-package'}),null,'No free-form app data');
const calls=[];
const pgPool={query:async(sql,args=[])=>{
 calls.push({sql,args});
 if(/INSERT INTO disha_checkout_diagnostics/.test(sql))return {rowCount:1,rows:[{id:1}]};
 return {rowCount:1,rows:[]};
}};
const mock={pgPool,findSessionByOrderId:async id=>id===orderId?{sessionId:token,expiresAt:Date.now()+180000}:null};
const diag=createCheckoutDiagnostics({db:mock});
(async()=>{
 await diag.init();
 assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS disha_checkout_diagnostics/);
 assert.match(calls[0].sql,/7 days/,'Trace data must expire');
 const app=express();app.use(express.json());app.use('/api/checkout',diag.router);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const send=async(payload,proof=token)=>{
   const response=await fetch(base+'/api/checkout/trace',{
    method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':proof},
    body:JSON.stringify(payload)});
   return {status:response.status,data:await response.json()};
  };
  let r=await send(valid);
  assert.equal(r.status,202);
  assert.equal(r.data.recorded,true);
  const insert=calls.find(x=>/INSERT INTO disha_checkout_diagnostics/.test(x.sql));
  assert.deepEqual(insert.args,[orderId,valid.event,valid.code,valid.app,valid.device],
   'Tokens, passkey data, UPI URI and raw user-agent must never be stored');
  r=await send(valid,'b'.repeat(48));
  assert.equal(r.status,403,'Cannot spoof another checkout token');
  r=await send({...valid,token:'b'.repeat(48)},'b'.repeat(48));
  assert.equal(r.status,404,'Order-scoped proof must bind to original session');
  r=await send({...valid,pin:'9876'});
  assert.equal(r.status,400,'Sensitive extras rejected before database access');
  r=await send({...valid,event:'BANK_PAYMENT_SUCCESS'});
  assert.equal(r.status,400,'No bank status can be submitted through diagnostic endpoint');
  const unauthorized=await fetch(base+'/api/checkout/trace');
  assert.equal(unauthorized.status,404,'Trace collector is write-only to customers');
  console.log('CHECKOUT_DIAGNOSTICS_PASS: private event allowlist, real order-bound bearer, 7-day retention, no PIN or settlement');
 }finally{await new Promise(resolve=>server.close(resolve))}
})().catch(err=>{console.error(err);process.exitCode=1});
