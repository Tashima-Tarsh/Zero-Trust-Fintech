'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createCheckoutDiagnostics,validEvent}=require('../financial/checkout-diagnostics');
const token='a'.repeat(48),orderId='ORD_TRACE_TEST_123';
const valid={orderId,token,event:'VAULT_AUTH_PROMPT',code:'OK',app:'phonepe',device:'android'};
assert.ok(validEvent(valid));
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
