'use strict';
// Research adapter for an EXPLICITLY ONBOARDED partner-originated payer debit
// event. Never impersonates Google/PSP, intercepts PSP traffic or reads GPay.
// Does not settle a merchant order or mutate the DISHA financial ledger.
const crypto=require('node:crypto'),express=require('express');
const {rupeesToPaise}=require('./money');
const TABLE='disha_payer_partner_debit_events';
const ID=/^[A-Za-z0-9_-]{6,150}$/;
const VPA=/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i;
function canonicalEvent(e){
 if(!e||typeof e!=='object'||Array.isArray(e))throw Error('EVENT_REQUIRED');
 const names=['protocol','sourceId','eventId','orderId','direction','debitLegStatus','utr','transactionRef','amountPaise','payeeVpa','occurredAt'];
 if(Object.keys(e).length!==names.length||names.some(k=>!Object.hasOwn(e,k)))throw Error('EVENT_FIELDS_INVALID');
 const v=Object.fromEntries(names.map(k=>[k,e[k]]));
 if(v.protocol!=='DISHA-PAYER-PSP-DEBIT-EVENT-V1'||!ID.test(v.sourceId)||!ID.test(v.eventId)||
    !ID.test(v.orderId)||v.direction!=='PAYER_DEBIT'||
    !['CONFIRMED','REVERSED'].includes(v.debitLegStatus)||
    !/^\d{12}$/.test(v.utr)||!ID.test(v.transactionRef)||
    typeof v.amountPaise!=='string'||!/^[1-9][0-9]{0,15}$/.test(v.amountPaise)||
    !VPA.test(v.payeeVpa)||!Number.isSafeInteger(v.occurredAt)||v.occurredAt<=0)
   throw Error('EVENT_FIELDS_INVALID');
 return JSON.stringify(v);
}
function validSignature(event,signature,trusted){
 try{
  const body=canonicalEvent(event);
  const pem=trusted?.[event.sourceId];
  if(typeof pem!=='string'||!pem.includes('PUBLIC KEY')||typeof signature!=='string'||
     !/^[A-Za-z0-9_-]{86}$/.test(signature))return false;
  const key=crypto.createPublicKey(pem);
  return key.asymmetricKeyType==='ed25519'&&
   crypto.verify(null,Buffer.from(body),key,Buffer.from(signature,'base64url'));
 }catch(_){return false}
}
async function initPayerPartnerDebit(pool){
 if(!pool)throw Error('POSTGRES_REQUIRED');
 await pool.query('CREATE TABLE IF NOT EXISTS '+TABLE+' ('+
 'source_id TEXT NOT NULL,event_id TEXT NOT NULL,order_id TEXT NOT NULL,'+
 'payload_sha256 TEXT NOT NULL,utr TEXT NOT NULL,transaction_ref TEXT NOT NULL,'+
 'amount_paise TEXT NOT NULL,payee_vpa TEXT NOT NULL,debit_leg_status TEXT NOT NULL,'+
 'occurred_at BIGINT NOT NULL,received_at BIGINT NOT NULL,'+
 'PRIMARY KEY(source_id,event_id))');
 await pool.query('CREATE INDEX IF NOT EXISTS idx_disha_partner_payer_debit_order ON '+TABLE+'(order_id,received_at DESC)');
}
function createPayerPartnerDebitRouter({getPool,getSession,getTrustedKeys,isOnboarded,clock=()=>Date.now()}){
 if([getPool,getSession,getTrustedKeys,isOnboarded].some(f=>typeof f!=='function'))throw Error('PARTNER_DEPENDENCIES_REQUIRED');
 const router=express.Router();
 router.post('/ingest',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const {event,signature}=req.body||{};
  let canonical;
  try{canonical=canonicalEvent(event)}catch(_){return res.status(400).json({accepted:false,reason:'INVALID_PARTNER_EVENT'})}
  if(isOnboarded(event.sourceId)!==true)
   return res.status(403).json({accepted:false,reason:'PARTNER_NOT_ONBOARDED'});
  if(!validSignature(event,signature,getTrustedKeys()))
   return res.status(401).json({accepted:false,reason:'PARTNER_SIGNATURE_INVALID'});
  const now=clock();
  if(event.occurredAt>now+30000||now-event.occurredAt>600000)
   return res.status(409).json({accepted:false,reason:'EVENT_TIME_INVALID'});
  try{
   const pool=getPool();
   if(!pool)return res.status(503).json({accepted:false,reason:'STORAGE_UNAVAILABLE'});
   const session=await getSession(event.orderId);
   if(!session||session.orderId!==event.orderId||!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase())||
    session.txnRef!==event.transactionRef||String(session.vpaAddress||'').toLowerCase()!==event.payeeVpa.toLowerCase()||
    rupeesToPaise(String(session.challengeAmount))!==event.amountPaise||
    !Number.isFinite(Number(session.expiresAt))||event.occurredAt>Number(session.expiresAt)+300000)
    return res.status(409).json({accepted:false,reason:'PAYER_ORDER_MISMATCH'});
   const hash=crypto.createHash('sha256').update(canonical).digest('hex');
   const sql='INSERT INTO '+TABLE+' (source_id,event_id,order_id,payload_sha256,utr,transaction_ref,'+
    'amount_paise,payee_vpa,debit_leg_status,occurred_at,received_at) '+
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING event_id';
   const values=[event.sourceId,event.eventId,event.orderId,hash,event.utr,event.transactionRef,
    event.amountPaise,event.payeeVpa.toLowerCase(),event.debitLegStatus,event.occurredAt,now];
   const row=await pool.query(sql,values);
   if(!row.rowCount)return res.status(409).json({accepted:false,reason:'PARTNER_EVENT_REPLAY'});
   return res.status(202).json({accepted:true,
    state:'PARTNER_PAYER_DEBIT_EVENT_RECORDED',orderId:event.orderId,
    payerDebitLeg:event.debitLegStatus,merchantCreditVerified:false,
    merchantLedgerMutated:false});
  }catch(_){return res.status(503).json({accepted:false,reason:'PARTNER_EVENT_STORAGE_UNAVAILABLE'})}
 });
 // Status is a partner-origin claim, not a generic browser or SMS claim.
 // Use latest event by arrival, including reversal, and scope by order.
 router.get('/status/:orderId',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const id=req.params.orderId,token=req.query.token;
  if(!ID.test(id)||typeof token!=='string'||token.length>256)
   return res.status(401).json({available:false,reason:'CHECKOUT_TOKEN_REQUIRED'});
  try{
   const session=await getSession(id);
   const a=Buffer.from(token),b=Buffer.from(String(session?.sessionId||''));
   if(!session||a.length!==b.length||!a.length||!crypto.timingSafeEqual(a,b))
    return res.status(401).json({available:false,reason:'CHECKOUT_TOKEN_REQUIRED'});
   const pool=getPool();
   if(!pool)return res.status(503).json({available:false,reason:'STORAGE_UNAVAILABLE'});
   const rows=await pool.query('SELECT source_id,utr,debit_leg_status,occurred_at FROM '+TABLE+
      ' WHERE order_id=$1 ORDER BY received_at DESC LIMIT 1',[id]);
   const e=rows.rows[0];
   return res.json({available:!!e,orderId:id,
     evidenceState:!e?'NO_PSP_PARTNER_EVENT':e.debit_leg_status==='REVERSED'?
      'PAYER_DEBIT_REVERSED':'PARTNER_REPORTED_PAYER_DEBIT',
     sourceAuthenticated:!!e,utr:e?.utr||null,
     // Consumer evidence is not finalized until actual partner onboarding,
     // bank evidence semantics and reversal handling are audited.
     debitVerified:false,paymentVerified:false,merchantCreditVerified:false});
  }catch(_){return res.status(503).json({available:false,reason:'EVIDENCE_UNAVAILABLE'})}
 });
 return router;
}
module.exports={canonicalEvent,validSignature,initPayerPartnerDebit,createPayerPartnerDebitRouter};
