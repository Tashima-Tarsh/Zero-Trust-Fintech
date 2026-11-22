'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const express=require('express'),crypto=require('node:crypto');
const {canonicalEvent,validSignature,createPayerPartnerDebitRouter}=require('../financial/payer-partner-debit-bridge');
const pair=crypto.generateKeyPairSync('ed25519');
const sourceId='PSP_TEST_BANK_2026',orderId='P2P_PARTNER_DEBIT_TEST_1',token='a'.repeat(48),now=1700000000000;
const key=pair.publicKey.export({type:'spki',format:'pem'}).toString();
const session={orderId,sessionId:token,merchantType:'P2P',status:'PENDING',
 txnRef:'TXNREF20261123',vpaAddress:'shop@oksbi',challengeAmount:1.05,expiresAt:now+180000};
const event={protocol:'DISHA-PAYER-PSP-DEBIT-EVENT-V1',
 sourceId,eventId:'TEST_EVT_001',orderId,direction:'PAYER_DEBIT',
 debitLegStatus:'CONFIRMED',utr:'000000000123',
 transactionRef:session.txnRef,amountPaise:'105',payeeVpa:'shop@oksbi',occurredAt:now};
const sign=e=>crypto.sign(null,Buffer.from(canonicalEvent(e)),pair.privateKey).toString('base64url');
async function fixture({enabled=true,keys={[sourceId]:key},getSession=async()=>session}={},run){
 const inserted=new Map();
 const pool={async query(sql,values){
  if(/^INSERT/i.test(sql)){
   const eventKey=values[0]+':'+values[1];
   if(inserted.has(eventKey))return {rowCount:0,rows:[]};
   inserted.set(eventKey,{source_id:values[0],event_id:values[1],order_id:values[2],
    utr:values[4],debit_leg_status:values[8],occurred_at:values[9],received_at:values[10]});
   return {rowCount:1,rows:[{event_id:values[1]}]};
  }
  if(/^SELECT/i.test(sql)){
   const rows=[...inserted.values()].filter(r=>r.order_id===values[0]);
   rows.sort((a,b)=>b.received_at-a.received_at);
   return {rowCount:rows.length,rows:rows.slice(0,1)};
  }
  throw Error('UNEXPECTED_SQL');
 }};
 const app=express();app.use(express.json());app.use('/partner',createPayerPartnerDebitRouter({
  getPool:()=>pool,getSession,getTrustedKeys:()=>keys,
  isOnboarded:id=>enabled&&id===sourceId,clock:()=>now}));
 const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.listening?r():listener.once('listening',r));
 const url='http://127.0.0.1:'+listener.address().port+'/partner';
 const post=async(e=event,s=sign(e))=>{
  const resp=await fetch(url+'/ingest',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({event:e,signature:s})});
  return {code:resp.status,data:await resp.json()};
 };
 const get=async(t=token)=>{
  const resp=await fetch(url+'/status/'+orderId+'?token='+encodeURIComponent(t));
  return {code:resp.status,data:await resp.json()};
 };
 try{await run({post,get,inserted})}finally{await new Promise(r=>listener.close(r))}
}
test('canonical payload order, signature and deliberate no-debit-settlement assertion',()=>{
 assert.equal(validSignature(event,sign(event),{[sourceId]:key}),true);
 assert.equal(validSignature({...event,amountPaise:'200'},sign(event),{[sourceId]:key}),false);
 assert.equal(validSignature(event,sign(event),{}),false);
 assert.throws(()=>canonicalEvent({...event,unknown:'test'}),/FIELDS/);
});
test('not-onboarded partner cannot produce a callback',async()=>{
 await fixture({enabled:false},async({post})=>{
  const r=await post();assert.equal(r.code,403);assert.equal(r.data.accepted,false)
 });
});
test('trusted signed callback stores payer debit candidate without credit or ledger changes',async()=>{
 await fixture({},async({post,get,inserted})=>{
  const first=await post();
  assert.equal(first.code,202);assert.equal(first.data.accepted,true);
  assert.equal(first.data.payerDebitLeg,'CONFIRMED');
  assert.equal(first.data.merchantCreditVerified,false);
  assert.equal(first.data.merchantLedgerMutated,false);
  const status=await get();assert.equal(status.code,200);
  assert.equal(status.data.evidenceState,'PARTNER_REPORTED_PAYER_DEBIT');
  assert.equal(status.data.debitVerified,false,'no live contracted bank source in fixture');
  assert.equal(status.data.merchantCreditVerified,false);
  assert.equal((await get('b'.repeat(48))).code,401);
  assert.equal(inserted.size,1);
  const repeat=await post();assert.equal(repeat.code,409);
  assert.equal(repeat.data.reason,'PARTNER_EVENT_REPLAY');
 });
});
test('a forged, wrong-amount, wrong-payee or wrong reference event cannot enter inbox',async()=>{
 await fixture({},async({post,inserted})=>{
  assert.equal((await post(event,'not-a-signature')).code,401);
  for(const altered of [
   {...event,amountPaise:'999'},
   {...event,payeeVpa:'evil@oksbi'},
   {...event,transactionRef:'OTHER_REF'},
   {...event,orderId:'OTHER_ORDER'},
   {...event,occurredAt:now-700000}
  ]){
   const result=await post(altered);
   assert.equal(result.code,altered.occurredAt!==now?409:409);
  }
  assert.equal(inserted.size,0);
 });
});
test('reversal is captured as a separate payer-debit event, never as credit confirmation',async()=>{
 await fixture({},async({post,get})=>{
  const reverse={...event,eventId:'TEST_EVT_002',debitLegStatus:'REVERSED'};
  assert.equal((await post(reverse)).code,202);
  const status=await get();assert.equal(status.data.evidenceState,'PAYER_DEBIT_REVERSED');
  assert.equal(status.data.debitVerified,false);
 });
});
