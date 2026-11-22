'use strict';
/* DISHA signed seller delivery (pilot). Outbox is written INSIDE the same
 * PostgreSQL transaction that consumes a verified payment-provider response.
 * This never converts provider-reported success into independently verified debit.
 */
const crypto=require('node:crypto');
const TYPE='disha.payer_evidence.v1';
const STATES=Object.freeze({
  GOOGLE_PAY:'GOOGLE_PAY_REPORTED_SUCCESS',
  ANDROID_SMS_NOTIFICATION:'DEBIT_NOTIFICATION_OBSERVED',
  ANDROID_PAYMENT_NOTIFICATION:'DEBIT_NOTIFICATION_OBSERVED',
  PAYER_PROVIDER:'PAYER_DEBIT_CONFIRMED'
});
function eventFor({source,orderId,amount,payeeVpa,transactionId,receivedAt,verifiedDebit=false}){
 if(!Object.hasOwn(STATES,source)||typeof orderId!=='string'||!orderId||
    typeof amount!=='string'||!/^(0|[1-9]\d*)\.\d{2}$/.test(amount)||
    typeof payeeVpa!=='string'||!payeeVpa||
    typeof transactionId!=='string'||!transactionId||transactionId.length>150||
    !Number.isSafeInteger(receivedAt)||
    (verifiedDebit!==true&&verifiedDebit!==false)||
    (source==='PAYER_PROVIDER')!==verifiedDebit)throw Error('UNACCEPTABLE_EVIDENCE_FOR_SELLER');
 return Object.freeze({
  eventId:crypto.randomUUID(),type:TYPE,source,state:STATES[source],
  orderId,amount,payeeVpa,transactionId,receivedAt,
  debitVerified:verifiedDebit,
  paymentVerified:false,settlementVerified:false
 });
}
async function initializeOutbox(pool){
 if(!pool||typeof pool.query!=='function')return false;
 await pool.query(`CREATE TABLE IF NOT EXISTS disha_payer_evidence_outbox (
   event_id UUID PRIMARY KEY,
   source TEXT NOT NULL,
   transaction_id TEXT NOT NULL,
   order_id TEXT NOT NULL,
   body TEXT NOT NULL,
   attempt INTEGER NOT NULL DEFAULT 0,
   next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   delivered_at TIMESTAMPTZ,
   UNIQUE(source,transaction_id)
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS disha_payer_evidence_outbox_due_idx ON disha_payer_evidence_outbox(next_at,event_id) WHERE delivered_at IS NULL');
 return true;
}
/* Call ONLY inside the caller's successful verified-provider transaction.
 * Throws on any conflict, causing that entire transaction to roll back.
 */
async function enqueueVerifiedProviderEvent(client,{orderId,amount,payeeVpa,transactionId,receivedAt}){
 const evt=eventFor({source:'GOOGLE_PAY',orderId,amount,payeeVpa,transactionId,receivedAt});
 await client.query(
  'INSERT INTO disha_payer_evidence_outbox(event_id,source,transaction_id,order_id,body,next_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0))',
  [evt.eventId,evt.source,evt.transactionId,evt.orderId,JSON.stringify(evt),receivedAt]);
 return evt.eventId;
}
function signDelivery(secret,timestamp,body){
 if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('WEBHOOK_SECRET_INVALID');
 return 'sha256='+crypto.createHmac('sha256',secret).update(String(timestamp)+'.'+body).digest('hex');
}
function validatedDestination({url,secret}){
 if(typeof url!=='string'||typeof secret!=='string')throw Error('SELLER_DESTINATION_UNCONFIGURED');
 const parsed=new URL(url);
 // Explicit server-only config; reject redirects and plain HTTP. No URL is read
 // from payer submissions, notification contents, or provider return JSON.
 if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||
    parsed.hash||parsed.port&&parsed.port!=='443')throw Error('INVALID_SELLER_DESTINATION');
 signDelivery(secret,0,'');
 return {url:parsed.toString(),secret};
}
async function deliverNext({pool,destination,send=fetch,clock=()=>Date.now()}={}){
 if(!pool||typeof pool.query!=='function'||typeof destination!=='function'||typeof send!=='function')
  throw Error('DELIVERY_DEPENDENCIES_REQUIRED');
 const now=clock();
 // Claim with a short lease, atomically, across multiple workers.
 const claimed=await pool.query(`
 UPDATE disha_payer_evidence_outbox
 SET attempt=attempt+1,next_at=to_timestamp($2/1000.0)
 WHERE event_id=(SELECT event_id FROM disha_payer_evidence_outbox
  WHERE delivered_at IS NULL AND next_at<=to_timestamp($1/1000.0)
  ORDER BY next_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED)
 RETURNING event_id,order_id,body,attempt`,[now,now+60000]);
 const job=claimed.rows[0];if(!job)return false;
 try{
  const dest=validatedDestination(await destination(job.order_id));
  const timestamp=Math.floor(clock()/1000);
  const signature=signDelivery(dest.secret,timestamp,job.body);
  const response=await send(dest.url,{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{'content-type':'application/json','x-disha-event-id':String(job.event_id),
    'x-disha-timestamp':String(timestamp),'x-disha-signature':signature},
   body:job.body
  });
  if(!response?.ok)throw Error('SELLER_DELIVERY_REJECTED');
  await pool.query('UPDATE disha_payer_evidence_outbox SET delivered_at=to_timestamp($3/1000.0) WHERE event_id=$1 AND attempt=$2 AND delivered_at IS NULL',
   [job.event_id,job.attempt,clock()]);
 }catch(_){
  const delay=Math.min(3600000,1000*2**Math.min(12,job.attempt));
  await pool.query('UPDATE disha_payer_evidence_outbox SET next_at=to_timestamp($3/1000.0) WHERE event_id=$1 AND attempt=$2 AND delivered_at IS NULL',
   [job.event_id,job.attempt,clock()+delay]);
 }
 return true;
}
module.exports={STATES,TYPE,eventFor,initializeOutbox,enqueueVerifiedProviderEvent,signDelivery,validatedDestination,deliverNext};
