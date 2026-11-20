'use strict';
/*
 * DISHA ProofBridge research protocol (zero-install web checkout).
 * ISSUER-SIGNED DEVICE EVIDENCE IS NOT BANK SETTLEMENT.
 * No root detection, private app access, real UTR extraction or ledger mutation.
 * Enabled only with DISHA_PROOFBRIDGE_EXPERIMENT=1.
 */
const crypto=require('node:crypto');
const express=require('express');
const {rupeesToPaise}=require('./money');

const fail=(code,status=422)=>Object.assign(new Error(code),{code,status});
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const exact=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(value);
const tokenOk=value=>typeof value==='string'&&/^[a-f0-9]{24,64}$/i.test(value);
const vpa=value=>typeof value==='string'&&/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(value);
const proofFields=['protocol','issuerId','orderId','nonce','utr','amountPaise','payeeVpa','outcome','paidAt','ticketHash'];

function canonicalCapsule(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).length!==proofFields.length||
    !proofFields.every(k=>Object.hasOwn(input,k)))throw fail('PROOF_FIELDS_INVALID');
 const c=Object.fromEntries(proofFields.map(k=>[k,input[k]]));
 if(c.protocol!=='DISHA-PROOF-CAPSULE-V1'||!/^[A-Za-z0-9._-]{3,64}$/.test(c.issuerId)||
    !id(c.orderId)||!/^[a-f0-9]{40}$/i.test(c.nonce)||
    !/^[0-9]{12}$/.test(c.utr)||
    !/^[1-9][0-9]{0,15}$/.test(c.amountPaise)||!vpa(c.payeeVpa)||
    c.outcome!=='SUCCESS_CLAIM'||!Number.isSafeInteger(c.paidAt)||
    !/^[a-f0-9]{64}$/.test(c.ticketHash))throw fail('PROOF_FIELDS_INVALID');
 return JSON.stringify(c);
}

function receiptIntegrity(c,session,time=Date.now()){
 if(c.orderId!==session.order_id||c.nonce!==session.nonce||
    c.amountPaise!==session.amount_paise||c.payeeVpa!==session.payee_vpa||
    c.ticketHash!==session.ticket_hash)throw fail('PROOF_ORDER_MISMATCH',409);
 if(c.paidAt<Number(session.consented_at)-30000||
    c.paidAt>Number(session.expires_at)+60000||
    c.paidAt>time+300000)throw fail('PROOF_TIME_INVALID');
 return true;
}
function verifySignedCapsule(capsule,signature,publicKey){
 const bytes=canonicalCapsule(capsule);
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{80,140}$/.test(signature))
   throw fail('PROOF_SIGNATURE_INVALID',401);
 const sig=Buffer.from(signature,'base64url');
 if(sig.length!==64)throw fail('PROOF_SIGNATURE_INVALID',401);
 let verified=false;
 try{verified=crypto.verify(null,Buffer.from(bytes),publicKey,sig)}catch(_){}
 if(!verified)throw fail('PROOF_SIGNATURE_INVALID',401);
 return digest(bytes);
}
function issuedTicket(order,nonce,expiry,secret){
 const ticket={protocol:'DISHA-PROOF-TICKET-V1',orderId:order.orderId,
   nonce,amountPaise:order.amountPaise,payeeVpa:order.payeeVpa,
   paymentUriHash:digest(order.upiUri),expiresAt:expiry};
 const serialized=JSON.stringify(ticket);
 const signature=crypto.createHmac('sha256',secret).update(serialized).digest('hex');
 return {ticket,signature,ticketHash:digest(serialized+'.'+signature)};
}
function inspectPayment(session,upiUri){
 if(!id(session.orderId)||!tokenOk(session.sessionId)||session.status!=='PENDING'||
    Date.now()>=Number(session.expiresAt))throw fail('ORDER_INACTIVE',409);
 if(typeof upiUri!=='string'||!upiUri.startsWith('upi://pay?'))
    throw fail('PAYMENT_URI_INVALID');
 const u=new URL(upiUri),q=u.searchParams;
 const payee=(session.vpaAddress||'').toLowerCase();
 const rawAmount=q.get('am');
 if(u.protocol!=='upi:'||u.hostname!=='pay'||!vpa(payee)||
    q.get('pa')?.toLowerCase()!==payee||
    q.get('cu')!=='INR'||!rawAmount||
    rupeesToPaise(rawAmount)!==rupeesToPaise(String(session.challengeAmount))||
    ['pa','am','cu'].some(k=>q.getAll(k).length!==1))
    throw fail('PAYMENT_PAYLOAD_TAMPERED',409);
 const p2m=String(session.merchantType||'').toUpperCase();
 if(p2m==='PERSONAL'||p2m==='P2P'){
   if(q.has('mc')||q.has('tr'))throw fail('PAYMENT_KIND_MISMATCH',409);
 }else if(p2m==='MERCHANT'||p2m==='P2M'){
   if(!/^[0-9]{4}$/.test(q.get('mc')||'')||!q.get('tr'))throw fail('PAYMENT_KIND_MISMATCH',409);
 }else throw fail('PAYMENT_KIND_MISMATCH',409);
 return {orderId:session.orderId,amountPaise:rupeesToPaise(rawAmount),
   payeeVpa:payee,upiUri};
}
async function initProofBridgeSchema(pool){
 if(!pool)throw fail('POSTGRES_REQUIRED',503);
 await pool.query(
  "CREATE TABLE IF NOT EXISTS disha_proofbridge_sessions ("+
  "order_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,nonce TEXT NOT NULL,"+
  "amount_paise TEXT NOT NULL,payee_vpa TEXT NOT NULL,upi_uri_sha256 TEXT NOT NULL,"+
  "ticket_hash TEXT NOT NULL,expires_at BIGINT NOT NULL,consented_at BIGINT NOT NULL);"+
  "CREATE TABLE IF NOT EXISTS disha_proofbridge_capsules ("+
  "capsule_hash TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES disha_proofbridge_sessions(order_id),"+
  "issuer_id TEXT NOT NULL,utr TEXT NOT NULL,amount_paise TEXT NOT NULL,payee_vpa TEXT NOT NULL,"+
  "paid_at BIGINT NOT NULL,received_at BIGINT NOT NULL,"+
  "evidence_state TEXT NOT NULL DEFAULT 'UTR_OBSERVED_UNVERIFIED',"+
  "UNIQUE(issuer_id,utr));"+
  "CREATE INDEX IF NOT EXISTS idx_disha_pb_capsules_order ON disha_proofbridge_capsules(order_id,received_at DESC)"
 );
}
function createProofBridgeRouter({getPool,getSession,getUpiUri}){
 const router=express.Router();
 const error=(res,e)=>res.status(e.status||500).set('Cache-Control','no-store')
   .json({success:false,error:e.status?e.code:'PROOFBRIDGE_UNAVAILABLE'});
 const enabled=()=>process.env.DISHA_PROOFBRIDGE_EXPERIMENT==='1';
 const secret=()=>process.env.PROOFBRIDGE_TICKET_SECRET||'';
 const configured=()=>enabled()&&secret().length>=32;
 router.post('/authorize',async(req,res)=>{
  if(!configured())return error(res,fail('PROOFBRIDGE_DISABLED',503));
  const b=req.body||{},pool=getPool();
  if(!pool)return error(res,fail('POSTGRES_REQUIRED',503));
  if(b.consent!==true||!id(b.orderId)||!tokenOk(b.token)||!exact(req.get('x-csrf-token'),b.token))
    return error(res,fail('CONSENT_OR_TOKEN_REQUIRED',403));
  const c=await pool.connect();let tx=false;
  try{
   const session=await getSession(b.orderId);
   if(!session||!exact(session.sessionId,b.token))throw fail('SESSION_TOKEN_INVALID',401);
   const order=inspectPayment(session,getUpiUri(session));
   const now=Date.now(),expiresAt=Math.min(Number(session.expiresAt),now+180000);
   if(expiresAt<=now)throw fail('ORDER_INACTIVE',409);
   await c.query('BEGIN');tx=true;
   const existing=(await c.query('SELECT * FROM disha_proofbridge_sessions WHERE order_id=$1 FOR UPDATE',[b.orderId])).rows[0];
   if(existing&&(!exact(existing.token_hash,digest(b.token))||
     existing.amount_paise!==order.amountPaise||existing.payee_vpa!==order.payeeVpa||
     existing.upi_uri_sha256!==digest(order.upiUri)))throw fail('PAYMENT_PAYLOAD_TAMPERED',409);
   const nonce=existing?.nonce||crypto.randomBytes(20).toString('hex');
   const expiry=existing?Number(existing.expires_at):expiresAt;
   if(expiry<=now)throw fail('SESSION_EXPIRED',410);
   const issued=issuedTicket(order,nonce,expiry,secret());
   if(existing&&existing.ticket_hash!==issued.ticketHash)throw fail('PROOF_TICKET_CONFLICT',409);
   if(!existing)await c.query(
    'INSERT INTO disha_proofbridge_sessions(order_id,token_hash,nonce,amount_paise,payee_vpa,upi_uri_sha256,ticket_hash,expires_at,consented_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [b.orderId,digest(b.token),nonce,order.amountPaise,order.payeeVpa,
      digest(order.upiUri),issued.ticketHash,expiry,now]);
   await c.query('COMMIT');tx=false;
   return res.status(200).set('Cache-Control','no-store').json({
    success:true,orderId:b.orderId,upiUri:order.upiUri,
    ticket:issued.ticket,ticketSignature:issued.signature,
    ticketHash:issued.ticketHash,expiresAt:expiry,
    deviceIntegrity:'UNKNOWN',paymentState:'PENDING_VERIFICATION'});
  }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});return error(res,e)}
  finally{c.release()}
 });
 router.post('/capsule',async(req,res)=>{
  if(!configured())return error(res,fail('PROOFBRIDGE_DISABLED',503));
  const pool=getPool();if(!pool)return error(res,fail('POSTGRES_REQUIRED',503));
  const pub=process.env.PROOFBRIDGE_ISSUER_PUBLIC_KEY_BASE64||'';
  const issuerId=process.env.PROOFBRIDGE_ISSUER_ID||'';
  if(!pub||!issuerId)return error(res,fail('PROOF_ISSUER_NOT_CONFIGURED',503));
  const c=await pool.connect();let tx=false;
  try{
   const capsule=req.body?.capsule,signature=req.body?.signature;
   if(capsule?.issuerId!==issuerId)throw fail('PROOF_ISSUER_NOT_TRUSTED',403);
   const publicKey=crypto.createPublicKey({key:Buffer.from(pub,'base64'),format:'der',type:'spki'});
   const hash=verifySignedCapsule(capsule,signature,publicKey);
   await c.query('BEGIN');tx=true;
   const record=(await c.query(
    'SELECT * FROM disha_proofbridge_sessions WHERE order_id=$1 FOR UPDATE',
    [capsule.orderId])).rows[0];
   if(!record)throw fail('PROOF_SESSION_MISSING',404);
   receiptIntegrity(capsule,record);
   const previous=(await c.query(
    'SELECT capsule_hash,order_id FROM disha_proofbridge_capsules WHERE issuer_id=$1 AND utr=$2',
    [issuerId,capsule.utr])).rows[0];
   if(previous&&(previous.order_id!==capsule.orderId||previous.capsule_hash!==hash))
     throw fail('UTR_REPLAY_BLOCKED',409);
   if(!previous)await c.query(
    'INSERT INTO disha_proofbridge_capsules (capsule_hash,order_id,issuer_id,utr,amount_paise,payee_vpa,paid_at,received_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [hash,capsule.orderId,issuerId,capsule.utr,capsule.amountPaise,capsule.payeeVpa,capsule.paidAt,Date.now()]);
   await c.query('COMMIT');tx=false;
   // NEVER post to sessions, transactions, utr_order_bindings or the ledger.
   return res.set('Cache-Control','no-store').json({
    success:true,evidenceState:'UTR_OBSERVED_UNVERIFIED',
    paymentVerified:false,utrCandidate:capsule.utr,replayed:Boolean(previous)});
  }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});return error(res,e)}
  finally{c.release()}
 });
 router.get('/status/:orderId',async(req,res)=>{
  if(!configured())return error(res,fail('PROOFBRIDGE_DISABLED',503));
  const pool=getPool();if(!pool)return error(res,fail('POSTGRES_REQUIRED',503));
  try{
   const orderId=req.params.orderId,token=req.query.token;
   if(!id(orderId)||!tokenOk(token))throw fail('SESSION_TOKEN_INVALID',401);
   const session=await getSession(orderId);
   if(!session||!exact(session.sessionId,token))throw fail('SESSION_TOKEN_INVALID',401);
   const a=(await pool.query('SELECT * FROM disha_proofbridge_sessions WHERE order_id=$1',[orderId])).rows[0];
   if(!a||!exact(a.token_hash,digest(token)))throw fail('PROOF_SESSION_MISSING',404);
   const c=(await pool.query(
     'SELECT utr,issuer_id,paid_at,evidence_state FROM disha_proofbridge_capsules WHERE order_id=$1 ORDER BY received_at DESC LIMIT 1',
     [orderId])).rows[0];
   return res.set('Cache-Control','no-store').json({
    success:true,orderId,consented:true,deviceIntegrity:'UNKNOWN',
    evidenceState:c?.evidence_state||'AWAITING_EVIDENCE',paymentVerified:false,
    utrCandidate:c?.utr||null,issuerId:c?.issuer_id||null,claimedPaidAt:c?.paid_at||null});
  }catch(e){return error(res,e)}
 });
 return router;
}
module.exports={canonicalCapsule,verifySignedCapsule,issuedTicket,inspectPayment,receiptIntegrity,initProofBridgeSchema,createProofBridgeRouter};
