'use strict';
const express=require('express');
const crypto=require('node:crypto');
const {extractDebitSmsCandidate,matchDebitSmsToCheckout}=require('./sms-debit-candidate');
const {rupeesToPaise}=require('./money');
const {lookupBankSender}=require('./bank-sms-header-registry');
const TABLE='disha_sms_debit_candidates';
async function initSmsDebitRelay(pool){
 if(!pool)throw Error('SMS_RELAY_POSTGRES_REQUIRED');
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
  event_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  amount_paise TEXT NOT NULL,
  utr_candidate TEXT,
  payee_vpa TEXT,
  sender_header_matched BOOLEAN NOT NULL,
  observed_at BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  match_state TEXT NOT NULL,
  evidence_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
  debit_verified BOOLEAN NOT NULL DEFAULT FALSE,
  payment_verified BOOLEAN NOT NULL DEFAULT FALSE
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_debit_candidates_order ON ${TABLE}(order_id,received_at DESC)`);
}
function canonicalEnvelope(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_ENVELOPE');
 const {protocol,orderId,sourceId,nonce,sender,text,receivedAt}=input;
 if(protocol!=='DISHA-SMS-DEBIT-RELAY-V1'||typeof orderId!=='string'||!/^[a-z0-9_-]{6,150}$/i.test(orderId)||
    typeof sourceId!=='string'||!/^[a-z0-9_-]{3,60}$/i.test(sourceId)||
    typeof nonce!=='string'||!/^[a-z0-9_-]{20,100}$/i.test(nonce)||
    typeof sender!=='string'||sender.length>40||typeof text!=='string'||text.length>1600||
    !Number.isSafeInteger(receivedAt)||receivedAt<=0)throw Error('INVALID_ENVELOPE');
 return JSON.stringify({protocol,orderId,sourceId,nonce,sender,text,receivedAt});
}
function verifyEnvelope(envelope,signature,keys){
 try{
  const message=canonicalEnvelope(envelope);
  const key64=keys?.[envelope.sourceId];
  if(typeof key64!=='string'||!/^[a-zA-Z0-9_-]{40,}$/.test(key64)||
   typeof signature!=='string'||!/^[a-zA-Z0-9_-]{86}$/.test(signature))return false;
  const key=crypto.createPublicKey({key:Buffer.from(key64,'base64url'),format:'der',type:'spki'});
  return key.asymmetricKeyType==='ed25519' &&
   crypto.verify(null,Buffer.from(message),key,Buffer.from(signature,'base64url'));
 }catch(_){return false}
}
function createSmsDebitRelayRouter({getPool,getSession,getTrustedKeys,clock=()=>Date.now()}){
 const router=express.Router();
 router.post('/ingest',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const envelope=req.body?.envelope,signature=req.body?.signature;
  if(!verifyEnvelope(envelope,signature,getTrustedKeys()))
   return res.status(401).json({accepted:false,error:'TRUSTED_SOURCE_SIGNATURE_REQUIRED',debitVerified:false});
  const now=clock();
  if(Math.abs(now-envelope.receivedAt)>180000)
   return res.status(409).json({accepted:false,error:'SOURCE_TIMESTAMP_OUTSIDE_WINDOW'});
  const candidate=extractDebitSmsCandidate(envelope);
  if(!candidate)return res.status(422).json({accepted:false,error:'DEBIT_SMS_CANDIDATE_NOT_FOUND'});
  try{
   const pool=getPool();
   if(!pool)return res.status(503).json({accepted:false,error:'STORAGE_REQUIRED'});
   const session=await getSession(envelope.orderId);
   if(!session||session.status!=='PENDING'||!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
    return res.status(409).json({accepted:false,error:'ACTIVE_P2P_SESSION_REQUIRED'});
   const match=matchDebitSmsToCheckout(candidate,session,{now});
   if(!match.matched)return res.status(409).json({accepted:false,error:'CHECKOUT_SMS_MISMATCH',reasons:match.reasons});
   const eventHash=crypto.createHash('sha256').update(canonicalEnvelope(envelope)).digest('hex');
   const sql=`INSERT INTO ${TABLE} (event_hash,order_id,source_id,amount_paise,utr_candidate,payee_vpa,
     sender_header_matched,observed_at,received_at,match_state,evidence_authenticated,debit_verified,payment_verified)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,FALSE,FALSE)
     ON CONFLICT(event_hash) DO NOTHING RETURNING event_hash`;
   const result=await pool.query(sql,[eventHash,envelope.orderId,envelope.sourceId,candidate.amountPaise,
    candidate.utrCandidate,candidate.payeeVpaCandidate,candidate.senderHeaderMatched,candidate.receivedAt,
    now,'SESSION_MATCHED_SOURCE_SIGNED_SMS_UNVERIFIED']);
   return res.status(result.rowCount?202:409).json({accepted:result.rowCount>0,
    state:result.rowCount?'SMS_CANDIDATE_OBSERVED_UNVERIFIED':'DUPLICATE_SMS_CANDIDATE',
    sourceAuthenticated:true,bankOriginAuthenticated:false,debitVerified:false,paymentVerified:false});
  }catch(_){return res.status(503).json({accepted:false,error:'SMS_RELAY_STORAGE_UNAVAILABLE'})}
 });
 return router;
}
module.exports={initSmsDebitRelay,createSmsDebitRelayRouter,canonicalEnvelope,verifyEnvelope,TABLE};
