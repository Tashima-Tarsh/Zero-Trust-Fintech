'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const bridge=require('../public/labs/disha-debit-bridge');
const payment=require('../public/labs/disha-paymentrequest-transport');
const now=1730000000000;
const params=()=>({orderId:'DISHA_ORDER_123',payeeVpa:'receiver@oksbi',
  amountPaise:'105',nonce:'a'.repeat(32),expiresAt:now+90000,
  consent:true,userGestureConfirmed:true});
function synthetic(){
 return bridge.create({transport:bridge.syntheticTransport({clock:()=>now}),clock:()=>now});
}
test('Ponytail bridge: valid consented lab event has no financial authority',async()=>{
 const value=await synthetic().requestDebitEvidence(params());
 assert.equal(value.state,'LAB_EVENT_OBSERVED_UNVERIFIED');
 assert.equal(value.orderId,'DISHA_ORDER_123');
 assert.equal(value.debitVerified,false);
 assert.equal(value.paymentVerified,false);
 assert.equal(value.settlementVerified,false);
 assert.equal(value.provenance,'LAB_SYNTHETIC_ANDROID');
 assert.equal(value.nonce,undefined,'nonce not exposed');
});
test('explicit consent and gesture are required',async()=>{
 for(const updates of [{consent:false},{userGestureConfirmed:false}]){
  await assert.rejects(()=>synthetic().requestDebitEvidence({...params(),...updates}));
 }
});
test('reject missing nonce, invalid VPA, expired session, oversize amount',async()=>{
 for(const updates of [{nonce:'bad'},{payeeVpa:'notvpa'},{expiresAt:now},
  {amountPaise:'0'},{amountPaise:'9999999999'},{expiresAt:now+120001}]){
  await assert.rejects(()=>synthetic().requestDebitEvidence({...params(),...updates}));
 }
});
test('malicious forged return mismatching nonce/order/amount/expiry rejected',async()=>{
 const p=params(),expected=bridge.validateRequest(p,now);
 const baseline={protocol:'DISHA-DEBIT-BRIDGE-LAB-V1',kind:'SYNTHETIC_DEBIT_EVENT',
  orderId:p.orderId,payeeVpa:p.payeeVpa,amountPaise:p.amountPaise,
  nonce:p.nonce,observedAt:now};
 for(const changes of [{nonce:'b'.repeat(32)},{orderId:'DISHA_OTHER_123'},
  {amountPaise:'999'},{payeeVpa:'attacker@bank'},{kind:'BANK_CONFIRMED_DEBIT'},
  {observedAt:now-200000},{debitVerified:true,nonce:'b'.repeat(32)}]){
  const result=bridge.normalize({...baseline,...changes},expected,now);
  assert.equal(result.state,'INVALID_DEVICE_RESPONSE');
  assert.equal(result.debitVerified,false);
 }
 assert.equal(bridge.normalize(baseline,expected,now+90000).debitVerified,false);
});
test('arbitrary injected bankVerified flag is ignored',()=>{
 const p=params(),expected=bridge.validateRequest(p,now);
 const value=bridge.normalize({protocol:'DISHA-DEBIT-BRIDGE-LAB-V1',
  kind:'SYNTHETIC_DEBIT_EVENT',orderId:p.orderId,nonce:p.nonce,
  amountPaise:p.amountPaise,payeeVpa:p.payeeVpa,observedAt:now,
  debitVerified:true,paymentVerified:true,accountNumber:'SECRET'},expected,now);
 assert.equal(value.debitVerified,false);
 assert.equal(value.accountNumber,undefined);
});
test('concurrent duplicate requests rejected',async()=>{
 let unlock;const app=bridge.create({clock:()=>now,transport:{request:()=>new Promise(resolve=>{unlock=resolve})}});
 const first=app.requestDebitEvidence(params());
 await assert.rejects(()=>app.requestDebitEvidence(params()),/ONE_REQUEST_AT_A_TIME/);
 unlock(null);assert.equal((await first).state,'USER_CANCELLED');
});
test('Chrome adapter sends lab method and exposes only method-specific response',async()=>{
 let passed,completed=0,showCount=0;
 class FakePaymentRequest{
  constructor(methods,details){passed={methods,details}}
  async show(){showCount++;return {methodName:payment.METHOD,details:{
   protocol:'DISHA-DEBIT-BRIDGE-LAB-V1',kind:'SYNTHETIC_DEBIT_EVENT',
   orderId:'DISHA_ORDER_123',nonce:'a'.repeat(32),
   amountPaise:'105',payeeVpa:'receiver@oksbi',observedAt:now
  },complete:async()=>{completed++}}}
 }
 const t=payment.make({PaymentRequestClass:FakePaymentRequest,requireGesture:()=>true});
 const value=await bridge.create({clock:()=>now,transport:t}).requestDebitEvidence(params());
 assert.equal(passed.methods[0].supportedMethods,payment.METHOD);
 assert.equal(passed.details.total.amount.value,'1.05');
 assert.equal(showCount,1);assert.equal(completed,1);
 assert.equal(value.state,'LAB_EVENT_OBSERVED_UNVERIFIED');
 assert.equal(value.debitVerified,false);
});
test('canceled PaymentRequest returns USER_CANCELLED, not success',async()=>{
 class CancelPaymentRequest{
  async show(){const e=new Error('cancel');e.name='AbortError';throw e}
 }
 const t=payment.make({PaymentRequestClass:CancelPaymentRequest,requireGesture:()=>true});
 const v=await bridge.create({clock:()=>now,transport:t}).requestDebitEvidence(params());
 assert.equal(v.state,'USER_CANCELLED');
});
test('unexpected method rejected, response completed',async()=>{
 let completed=0;
 class WrongPaymentRequest{
  async show(){return {methodName:'https://evil.test/pay',details:{},complete:async()=>{completed++}}}
 }
 const t=payment.make({PaymentRequestClass:WrongPaymentRequest,requireGesture:()=>true});
 const value=await bridge.create({clock:()=>now,transport:t}).requestDebitEvidence(params());
 assert.equal(value.state,'INVALID_DEVICE_RESPONSE');assert.equal(completed,1);
});
test('Android manifest is test-only and implements Chromium payment filter',()=>{
 const manifest=fs.readFileSync(path.join(__dirname,'../experiments/android-debit-bridge-lab/app/src/main/AndroidManifest.xml'),'utf8');
 const java=fs.readFileSync(path.join(__dirname,'../experiments/android-debit-bridge-lab/app/src/main/java/in/thenitishkr/disha/debitbridgelab/SyntheticDebitHandlerActivity.java'),'utf8');
 assert.match(manifest,/org.chromium.intent.action.PAY/);
 assert.match(manifest,/org.chromium.default_payment_method_name/);
 assert.match(java,/RESULT_OK/);assert.match(java,/RESULT_CANCELED/);
 assert.doesNotMatch(java,/READ_SMS|NotificationListenerService|BankAccount|UPI_PIN/);
});
