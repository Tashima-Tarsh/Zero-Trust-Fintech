'use strict';
/* Checkout recovery contract: browser auth cache must never resurrect an
 * expired unpaid intent. Confirmed receipts remain accessible after TTL. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const start=src.indexOf('async function recoverSessionState(requestedAmount){');
const end=src.indexOf(' async function getSession(){',start);
assert.ok(start>0&&end>start,'Canonical checkout recovery code is required');
const functionSource=src.slice(start,end);
const original={
 requestedAmount:'1',savedAt:Date.now()-5000,
 orderId:'Order_TEST12345',token:'a'.repeat(48),
 upiUri:'upi://pay?pa=test%40oksbi&pn=Testing&am=1.00&cu=INR',
 amount:1,expiresAt:Date.now()-1000
};
async function recover(old,status){
 const context={
  sessionStorage:{getItem:()=>JSON.stringify(old)},
  resumeKey:'disha82:upi-payment-resume:v2',
  model,
  fetch:async()=>({ok:true,json:async()=>status}),
  Date,Number,JSON,encodeURIComponent
 };
 vm.runInNewContext(functionSource+'\nthis.recover=recoverSessionState;',context);
 return context.recover('1');
}
(async()=>{
 const pending={success:true,status:'PENDING',utr:null};
 const settled={success:true,status:'SUCCESS',utr:'123456789012'};
 assert.equal(await recover(original,pending),null,'Expired pending intent must never resume for a second payment');
 const oldPaid=await recover(original,settled);
 assert.equal(oldPaid.orderId,original.orderId,'Already confirmed receipt must survive TTL');
 const valid=await recover({...original,expiresAt:Date.now()+60000},pending);
 assert.equal(valid.orderId,original.orderId,'Active session may be resumed');
 console.log('SESSION_RECOVERY_PASS: expired unpaid checkout renewed, confirmed receipt retained, active session reused');
})().catch(e=>{console.error(e);process.exitCode=1});
