'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lib=require('../public/p2p-paymentrequest-probe');
const root=path.resolve(__dirname,'..');
const upi='upi://pay?pa=receiver@oksbi&pn=Receiver&am=1.00&cu=INR&tn=Payment';
const session={orderId:'PAY_P2P_1',paymentType:'P2P',upiUri:upi,amount:1,payeeVpa:'receiver@oksbi',expiresAt:Date.now()+90000};
test('P2P request uses personal UPI, without invented merchant category or reference',()=>{
 const data=lib.build(session,'https://disha8-2.thenitishkr.in');
 assert.ok(data);
 assert.equal(data.methods[0].supportedMethods,'https://tez.google.com/pay');
 assert.equal(data.methods[0].data.pa,'receiver@oksbi');
 assert.equal(data.methods[0].data.mc,undefined);
 assert.equal(data.methods[0].data.tr,undefined);
 assert.equal(data.details.total.amount.value,'1.00');
});
test('merchant and malformed personal payment input rejected',()=>{
 assert.equal(lib.build({...session,paymentType:'P2M'},'https://example.com'),null);
 assert.equal(lib.build({...session,upiUri:upi+'&mc=5411'},'https://example.com'),null);
 assert.equal(lib.build({...session,payeeVpa:'intruder@oksbi'},'https://example.com'),null);
 assert.equal(lib.build(session,'http://example.com'),null);
});
test('provider return is metadata only, never bank debit confirmation',()=>{
 const response={methodName:lib.METHOD,details:{tezResponse:JSON.stringify({Status:'SUCCESS',txnId:'123456789012',amount:'1.00',toVpa:'receiver@oksbi'}),signature:'signed-looking-string'}};
 const result=lib.inspect(response,{pa:'receiver@oksbi',amount:'1.00'});
 assert.equal(result.state,'ANDROID_PAYMENT_RESPONSE_OBSERVED');
 assert.equal(result.payeeMatched,true);
 assert.equal(result.amountMatched,true);
 assert.equal(result.signatureVerified,false);
 assert.equal(result.debitVerified,false);
 assert.equal(result.paymentVerified,false);
});
test('optional experiment is only shown on P2P and never writes to ledger',()=>{
 const html=fs.readFileSync(path.join(root,'public/checkout.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'public/cosmic-checkout.js'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(html,/id="p2pPaymentRequestProbe"[^>]*hidden/);
 assert.match(html,/id="p2pPaymentRequestCheck"/);
 assert.match(js,/mode==='generic'&&query\.get\('paymentrequest'\)==='1'/);
 assert.match(server,/'p2p-paymentrequest-probe\.js'/);
 const probe=fs.readFileSync(path.join(root,'public/p2p-paymentrequest-probe.js'),'utf8');
 assert.doesNotMatch(probe,/fetch\(|sendBeacon\(|XMLHttpRequest|ledger\//);
});

test('automatic Android lifecycle and motion signals are bounded and never prove debit',()=>{
 let now=1000;
 const timeline=lib.createTimeline({orderId:'PAY_P2P_1',expiresAt:91000},()=>now);
 assert.equal(timeline.record('PAYMENT_LAUNCHED'),true);
 now=1100;timeline.record('DOCUMENT_HIDDEN');timeline.record('WINDOW_BLUR');
 for(let i=0;i<400;i++)timeline.motion();
 now=2200;timeline.record('DOCUMENT_VISIBLE');timeline.record('WINDOW_FOCUS');
 const observation={state:'ANDROID_PAYMENT_RESPONSE_OBSERVED',amountMatched:true,payeeMatched:true};
 const snapshot=timeline.snapshot(observation);
 assert.equal(snapshot.motionSamples,300);
 assert.equal(snapshot.events.length,5);
 assert.equal(snapshot.responseObserved,true);
 assert.equal(snapshot.responseFieldsMatched,true);
 assert.equal(snapshot.debitVerified,false);
 assert.equal(snapshot.signatureVerified,false);
 timeline.close();
 assert.equal(timeline.record('PAYMENT_RESPONSE'),false);
 now=92000;timeline.motion();
 assert.equal(timeline.snapshot(null).motionSamples,300);
});
test('expired timelines discard motion and lifecycle signals',()=>{
 let now=1000;
 const timeline=lib.createTimeline({orderId:'EXP',expiresAt:1100},()=>now);
 now=1200;timeline.record('DOCUMENT_HIDDEN');timeline.motion();
 assert.equal(timeline.snapshot(null).events.length,0);
 assert.equal(timeline.snapshot(null).motionSamples,0);
});

test('direct Android payment launch does not require a separate capability button',()=>{
 const script=fs.readFileSync(path.join(root,'public/p2p-paymentrequest-probe.js'),'utf8');
 assert.match(script,/READY_FOR_USER_INITIATED_PAYMENT/);
 assert.match(script,/launch\.disabled=!\(inWindow\(\)&&win\.isSecureContext/);
 assert.match(script,/if\(!request\)\{/);
 assert.match(script,/new win\.PaymentRequest\(config\.methods,config\.details\)/);
 assert.match(script,/response=await request\.show\(\)/);
});

test('single user payment gesture launches and automatically invokes response callback',async()=>{
 const nodes={};
 function node(id){return nodes[id]||(nodes[id]={id,hidden:true,disabled:true,textContent:'',
  events:{},addEventListener(name,fn){this.events[name]=fn},
  removeEventListener(){}})}
 let showCalls=0,capabilityCalls=0,callbackCalls=0,completeCalls=0;
 class MockPaymentRequest{
  async canMakePayment(){capabilityCalls++;return true}
  async show(){showCalls++;return {methodName:lib.METHOD,details:{
   tezResponse:JSON.stringify({Status:'SUCCESS',amount:'1.00',toVpa:'receiver@oksbi'}),
   signature:'unverified'
  },async complete(){completeCalls++}}}
 }
 const window={
  isSecureContext:true,location:{search:'?amount=1&paymentrequest=1',
   origin:'https://disha8-2.thenitishkr.in'},PaymentRequest:MockPaymentRequest,
  addEventListener(){},removeEventListener(){}
 };
 const document={getElementById:node,visibilityState:'visible',
  addEventListener(){},removeEventListener(){}};
 assert.equal(lib.attach(session,{window,document,onPaymentResponse:async()=>{
  callbackCalls++;
 }}),true);
 assert.equal(node('p2pPaymentRequestLaunch').disabled,false);
 await node('p2pPaymentRequestLaunch').events.click();
 assert.equal(showCalls,1);
 assert.equal(capabilityCalls,0,'No handler pre-check required');
 assert.equal(callbackCalls,1);
 assert.equal(completeCalls,1);
});
