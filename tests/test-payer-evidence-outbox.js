'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {eventFor,signDelivery,validatedDestination,deliverNext,
 enqueueVerifiedProviderEvent,initializeOutbox}=require('../financial/payer-evidence-outbox');
const {makeTimedStore}=require('../financial/timed-payment-bridge');
const base={orderId:'TEST_ORDER_902',amount:'1.05',
 payeeVpa:'receiver@upi',transactionId:'TXNTEST123',receivedAt:1000};
const secret='z'.repeat(48);
test('provider success maps to seller report, never bank debit',()=>{
 const e=eventFor({...base,source:'GOOGLE_PAY'});
 assert.equal(e.state,'GOOGLE_PAY_REPORTED_SUCCESS');
 assert.equal(e.debitVerified,false);
 assert.equal(e.paymentVerified,false);
 assert.equal(e.settlementVerified,false);
 assert.match(e.eventId,/^[\da-f-]{36}$/);
});
test('SMS and payment notifications have distinct source, both unverified',()=>{
 for(const source of ['ANDROID_SMS_NOTIFICATION','ANDROID_PAYMENT_NOTIFICATION']){
  const e=eventFor({...base,source});
  assert.equal(e.state,'DEBIT_NOTIFICATION_OBSERVED');
  assert.equal(e.source,source);
  assert.equal(e.debitVerified,false);
 }
});
test('payer debit confirmed is reserved for authenticated adapter, never Google event',()=>{
 assert.throws(()=>eventFor({...base,source:'GOOGLE_PAY',verifiedDebit:true}));
 assert.throws(()=>eventFor({...base,source:'PAYER_PROVIDER',verifiedDebit:false}));
 assert.equal(eventFor({...base,source:'PAYER_PROVIDER',verifiedDebit:true}).state,'PAYER_DEBIT_CONFIRMED');
 assert.throws(()=>eventFor({...base,source:'constructor'}));
});
test('seller HMAC binds exact timestamp and payload',()=>{
 const body=JSON.stringify(eventFor({...base,source:'GOOGLE_PAY'}));
 const expected='sha256='+crypto.createHmac('sha256',secret).update('100.'+body).digest('hex');
 assert.equal(signDelivery(secret,100,body),expected);
 assert.notEqual(signDelivery(secret,101,body),expected);
 assert.throws(()=>signDelivery('weak',100,body),/WEBHOOK_SECRET_INVALID/);
});
test('seller endpoint never accepts plaintext, embedded credentials or unconfigured secret',()=>{
 assert.equal(validatedDestination({url:'https://seller.example/evidence',secret}).url,
  'https://seller.example/evidence');
 for(const url of ['http://seller.example/evidence','https://user:pass@seller.example/',
  'https://seller.example:8443/webhook','javascript:evil','https://seller.example/#fragment'])
  assert.throws(()=>validatedDestination({url,secret}));
});
test('webhook worker sends HMAC and tracks delivered event id',async()=>{
 const e=eventFor({...base,source:'GOOGLE_PAY'}),job={event_id:e.eventId,order_id:e.orderId,body:JSON.stringify(e),attempt:1};
 const calls=[];
 const pool={async query(sql,params){calls.push({sql,params});return sql.includes('RETURNING event_id')?{rows:[job]}:{rows:[]}}};
 const sent=[];
 const send=async(url,init)=>{sent.push({url,init});return {ok:true}};
 const result=await deliverNext({pool,send,clock:()=>100000,
  destination:async id=>{assert.equal(id,e.orderId);return {url:'https://seller.example/evidence',secret}}});
 assert.equal(result,true);
 assert.equal(sent.length,1);
 assert.equal(sent[0].init.headers['x-disha-event-id'],e.eventId);
 assert.equal(sent[0].init.headers['x-disha-timestamp'],'100');
 assert.equal(sent[0].init.headers['x-disha-signature'],signDelivery(secret,100,sent[0].init.body));
 assert.equal(sent[0].init.redirect,'error');
 assert.ok(calls.some(c=>c.sql.includes('SET delivered_at')));
});
test('failed seller response schedules exponential retry; no financial mutation',async()=>{
 const e=eventFor({...base,source:'GOOGLE_PAY'}),job={event_id:e.eventId,order_id:e.orderId,body:JSON.stringify(e),attempt:2};
 const calls=[];
 const pool={async query(sql,params){calls.push({sql,params});return sql.includes('RETURNING event_id')?{rows:[job]}:{rows:[]}}};
 assert.equal(await deliverNext({pool,clock:()=>100000,
  destination:async()=>({url:'https://seller.example/evidence',secret}),
  send:async()=>({ok:false})}),true);
 const retry=calls.find(c=>c.sql.includes('SET next_at='));
 assert.equal(retry.params[2],104000);
 assert.ok(!calls.some(c=>c.sql.includes('SET delivered_at')));
});
test('outbox enqueue is a database write, not a forged paid state',async()=>{
 const calls=[];
 const client={async query(sql,params){calls.push({sql,params});return {rowCount:1}}};
 const eventId=await enqueueVerifiedProviderEvent(client,base);
 assert.match(eventId,/^[\da-f-]{36}$/);
 assert.match(calls[0].sql,/INSERT INTO disha_payer_evidence_outbox/);
 const payload=JSON.parse(calls[0].params[4]);
 assert.equal(payload.debitVerified,false);
 assert.equal(payload.state,'GOOGLE_PAY_REPORTED_SUCCESS');
});
test('seller outbox runs in same transaction as 120s challenge and provider replay',async()=>{
 const calls=[];
 const client={
  async query(sql,params){
   calls.push(sql);
   if(sql.includes('SELECT order_id')&&sql.includes('FOR UPDATE'))
    return {rows:[{order_id:base.orderId,amount_rupees:base.amount,payee_vpa:base.payeeVpa,expires_ms:5000,used_at:null}]};
   if(sql.includes('INSERT INTO disha_upi_app_evidence_replay'))return {rowCount:1};
   return {rowCount:1};
  },release(){calls.push('RELEASE')}
 };
 const store=makeTimedStore(()=>({query:async()=>({}),connect:async()=>client}),
  {shouldQueueSeller:id=>id===base.orderId});
 assert.equal(await store.consume({reference:'a'.repeat(32),orderId:base.orderId,txnId:base.transactionId,now:1000}),true);
 const insert=calls.findIndex(s=>s.includes('INSERT INTO disha_payer_evidence_outbox'));
 assert.ok(insert>0);
 assert.ok(calls.indexOf('COMMIT')>insert);
 assert.ok(calls.some(s=>s.includes('ON CONFLICT (fingerprint) DO NOTHING')));
});
test('failed outbox insertion rolls back challenge and replay together',async()=>{
 const calls=[];
 const client={
  async query(sql){calls.push(sql);
   if(sql.includes('SELECT order_id')&&sql.includes('FOR UPDATE'))
    return {rows:[{order_id:base.orderId,amount_rupees:base.amount,payee_vpa:base.payeeVpa,expires_ms:5000,used_at:null}]};
   if(sql.includes('INSERT INTO disha_upi_app_evidence_replay'))return {rowCount:1};
   if(sql.includes('INSERT INTO disha_payer_evidence_outbox'))throw Error('DB_DOWN');
   return {rowCount:1};
  },release(){}
 };
 const store=makeTimedStore(()=>({query:async()=>({}),connect:async()=>client}),{shouldQueueSeller:()=>true});
 await assert.rejects(()=>store.consume({reference:'a'.repeat(32),orderId:base.orderId,txnId:base.transactionId,now:1000}),/DB_DOWN/);
 assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));
});
test('outbox is durable and delivery is disabled unless explicitly configured',async()=>{
 const queries=[];
 assert.equal(await initializeOutbox({query:async s=>{queries.push(s)}}),true);
 assert.match(queries[0],/UNIQUE\(source,transaction_id\)/);
 const code=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.match(code,/DISHA_SELLER_EVIDENCE_PILOT==='1'/);
 assert.match(code,/id===pilotOrderId/);
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../financial/payer-evidence-outbox.js'),'utf8'),/reconcileCredit|UPDATE ledger|paymentVerified:true/);
});
