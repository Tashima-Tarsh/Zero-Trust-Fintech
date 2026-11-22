'use strict';
// DISHA 120-second provider-return bridge. Never independently verifies payer bank debit.
// Reuses existing server-owned session, Google Pay signature verifier, and PostgreSQL replay table.
const crypto=require('node:crypto');
const express=require('express');
const {verifyUPIResponse,GOOGLE_METHOD}=require('../lib/upi-response-verifier');
const money=require('./money');
const {enqueueVerifiedProviderEvent}=require('./payer-evidence-outbox');
const TTL_MS=120000;
function validId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(v)}
function same(a,b){
 if(typeof a!=='string'||typeof b!=='string'||!a||!b||a.length>256||b.length>256)return false;
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
}
function providerKeys(getTrustedKeys){
 try{const keys=getTrustedKeys();return keys&&typeof keys==='object'&&!Array.isArray(keys)?keys:{}}catch(_){return {}}
}
function expectedSession(session,orderId,token,now){
 if(!validId(orderId)||typeof token!=='string'||!session||session.orderId!==orderId||!same(token,session.sessionId))
  return {error:'SESSION_AUTH_REQUIRED',status:401};
 if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
  return {error:'P2P_ONLY',status:409};
 if(session.status!=='PENDING'||!Number.isFinite(Number(session.expiresAt))||Number(session.expiresAt)<=now)
  return {error:'SESSION_NOT_ACTIVE',status:409};
 let amount;
 try{amount=money.rupeesToPaise(String(session.challengeAmount))}catch(_){}
 if(typeof amount!=='string'||!/^\d+$/.test(amount)||BigInt(amount)<=0n||
   typeof session.vpaAddress!=='string'||!/^[-\w.]+@[-\w.]+$/i.test(session.vpaAddress))
  return {error:'SESSION_FIELDS_INVALID',status:409};
 return {amount:money.paiseToRupees(amount),pa:session.vpaAddress};
}
function makeTimedStore(getPool,{shouldQueueSeller=()=>false}={}){
 if(typeof getPool!=='function')throw Error('POOL_GETTER_REQUIRED');
 const pool=()=>{const value=getPool();if(!value||typeof value.query!=='function')throw Error('TIMED_STORE_UNAVAILABLE');return value};
 return Object.freeze({
  async save(row){await pool().query(
   'INSERT INTO disha_upi_timed_challenges(reference,order_id,amount_rupees,payee_vpa,expires_at) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0))',
   [row.reference,row.orderId,row.amount,row.pa,row.expiresAt]);},
  async get(ref){const r=await pool().query(
   'SELECT reference,order_id,amount_rupees,payee_vpa,extract(epoch from expires_at)*1000 AS expires_ms,used_at FROM disha_upi_timed_challenges WHERE reference=$1',[ref]);
   return r.rows[0]||null;},
  async consume({reference,orderId,txnId,now}){
   const db=pool();if(typeof db.connect!=='function')throw Error('ATOMIC_STORE_REQUIRED');
   const client=await db.connect();
   try{
    await client.query('BEGIN');
    const r=await client.query(
     'SELECT order_id,amount_rupees,payee_vpa,extract(epoch from expires_at)*1000 AS expires_ms,used_at FROM disha_upi_timed_challenges WHERE reference=$1 FOR UPDATE',[reference]);
    const row=r.rows[0];
    if(!row||row.order_id!==orderId||row.used_at!==null||Number(row.expires_ms)<=now){
     await client.query('ROLLBACK');return false;
    }
    // The existing ledger-independent replay table enforces global transaction-ID uniqueness.
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(['GOOGLE_PAY',txnId])).digest('hex');
    const inserted=await client.query(
     'INSERT INTO disha_upi_app_evidence_replay(fingerprint,order_id,provider) VALUES($1,$2,$3) ON CONFLICT (fingerprint) DO NOTHING RETURNING fingerprint',
     [fingerprint,orderId,'GOOGLE_PAY']);
    if(inserted.rowCount!==1){await client.query('ROLLBACK');return false}
    await client.query('UPDATE disha_upi_timed_challenges SET used_at=NOW() WHERE reference=$1',[reference]);
    if(shouldQueueSeller(orderId)===true){
     await enqueueVerifiedProviderEvent(client,{
      orderId,amount:row.amount_rupees,payeeVpa:row.payee_vpa,
      transactionId:txnId,receivedAt:now
     });
    }
    await client.query('COMMIT');return true;
   }catch(e){try{await client.query('ROLLBACK')}catch(_){}throw e}
   finally{client.release()}
  }
 });
}
async function initTimedStore(pool){
 if(!pool||typeof pool.query!=='function')return false;
 await pool.query(`CREATE TABLE IF NOT EXISTS disha_upi_timed_challenges (
   reference TEXT PRIMARY KEY,
   order_id TEXT NOT NULL,
   amount_rupees TEXT NOT NULL,
   payee_vpa TEXT NOT NULL,
   expires_at TIMESTAMPTZ NOT NULL,
   used_at TIMESTAMPTZ,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS disha_upi_timed_challenges_order_idx ON disha_upi_timed_challenges(order_id,created_at)');
 return true;
}
function createTimedPaymentRouter({getSession,getTrustedKeys,store,clock=()=>Date.now()}={}){
 if(typeof getSession!=='function'||typeof getTrustedKeys!=='function'||!store||
    !['get','save','consume'].every(k=>typeof store[k]==='function'))throw Error('BRIDGE_DEPENDENCIES_REQUIRED');
 const router=express.Router();
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next()});
 async function sessionFrom(body,res){
  let session;try{session=await getSession(body.orderId)}catch(_){
   res.status(503).json({state:'SESSION_UNAVAILABLE',debitVerified:false});return null}
  const expected=expectedSession(session,body.orderId,body.token,clock());
  if(expected.error){res.status(expected.status).json({state:expected.error,debitVerified:false});return null}
  return {session,expected};
 }
 router.post('/prepare',async(req,res)=>{
  const body=req.body||{};
  if(!validId(body.orderId)||typeof body.token!=='string'||body.token.length>256)
   return res.status(400).json({state:'INVALID_REQUEST',debitVerified:false});
  const info=await sessionFrom(body,res);if(!info)return;
  const expiresAt=Math.min(Number(info.session.expiresAt),clock()+TTL_MS);
  if(expiresAt<=clock())return res.status(409).json({state:'SESSION_NOT_ACTIVE',debitVerified:false});
  const reference=crypto.randomBytes(16).toString('hex');
  try{await store.save({reference,orderId:body.orderId,amount:info.expected.amount,pa:info.expected.pa,expiresAt})}
  catch(_){return res.status(503).json({state:'TIMED_STORE_UNAVAILABLE',debitVerified:false})}
  // Payment method availability depends on a participating installed app. This is a capability request only.
  return res.json({state:'CHALLENGE_PREPARED',transactionRef:reference,expiresAt,
   paymentRequest:{
    methods:[{supportedMethods:GOOGLE_METHOD,data:{
     pa:info.expected.pa,pn:'DISHA UPI recipient',tr:reference,tn:'DISHA timed checkout'
    }}],
    details:{total:{label:'DISHA checkout',amount:{currency:'INR',value:info.expected.amount}}}
   },debitVerified:false});
 });
 router.post('/accept',async(req,res)=>{
  const {orderId,token,transactionRef,methodName,details}=req.body||{};
  if(!validId(orderId)||typeof token!=='string'||token.length>256||
    typeof transactionRef!=='string'||!/^[a-f0-9]{32}$/.test(transactionRef)||
    methodName!==GOOGLE_METHOD||!details||typeof details!=='object'||Array.isArray(details)||
    JSON.stringify(details).length>12000)
   return res.status(400).json({state:'INVALID_REQUEST',debitVerified:false});
  const info=await sessionFrom({orderId,token},res);if(!info)return;
  let challenge;
  try{challenge=await store.get(transactionRef)}catch(_){
   return res.status(503).json({state:'TIMED_STORE_UNAVAILABLE',debitVerified:false})}
  if(!challenge||challenge.order_id!==orderId||challenge.used_at!==null||
     challenge.amount_rupees!==info.expected.amount||
     typeof challenge.payee_vpa!=='string'||challenge.payee_vpa.toLowerCase()!==info.expected.pa.toLowerCase()||
     Number(challenge.expires_ms)<=clock())
   return res.status(409).json({state:'CHALLENGE_UNAVAILABLE',debitVerified:false});
  const evidence=verifyUPIResponse({
   provider:'GOOGLE_PAY',response:{methodName,details},
   expected:{...info.expected,txnRef:transactionRef},
   trustedKeys:providerKeys(getTrustedKeys)
  });
  if(evidence.signatureVerified!==true||evidence.providerReportedSuccess!==true)
   return res.status(422).json({state:evidence.reason,debitVerified:false,providerReportedSuccess:false});
  try{
   const consumed=await store.consume({reference:transactionRef,orderId,txnId:evidence.txnId,now:clock()});
   if(!consumed)return res.status(409).json({state:'REPLAY_OR_EXPIRED',debitVerified:false});
  }catch(_){return res.status(503).json({state:'TIMED_STORE_UNAVAILABLE',debitVerified:false})}
  return res.json({state:'PROVIDER_REPORTED_SUCCESS',provider:'GOOGLE_PAY',
   signatureVerified:true,providerReportedSuccess:true,
   debitVerified:false,paymentVerified:false,settlementVerified:false,paymentStateChanged:false});
 });
 return router;
}
module.exports={TTL_MS,expectedSession,initTimedStore,makeTimedStore,createTimedPaymentRouter};
