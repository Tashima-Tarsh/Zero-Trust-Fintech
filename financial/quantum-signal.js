'use strict';
/**
 * DISHA Quantum Signal: a server-side digital twin of a *specific* checkout.
 * It is not an Android VM, notification reader, payment gateway or PSP API.
 * Browser app-return data is untrusted. Never infer a debit solely from a UTR.
 */
const crypto=require('node:crypto');
const express=require('express');
const {rupeesToPaise}=require('./money');
const now=()=>Date.now();
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(x);
const validHex=x=>typeof x==='string'&&/^[a-f0-9]{24,64}$/i.test(x);
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const ctEqual=(x,y)=>{
 if(typeof x!=='string'||typeof y!=='string')return false;
 const a=Buffer.from(x),b=Buffer.from(y);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
};
const allowedFields=new Set(['Status','status','txnId','txnRef','ApprovalRefNo','responseCode','tr','am','pa']);
const validEvents=new Set(['HANDOFF','BACKGROUND','RETURN']);
const validApps=new Set(['gpay','phonepe','paytm','bhim','generic']);
function returnFields(raw){
 if(raw===undefined||raw===null)return {};
 if(typeof raw!=='object'||Array.isArray(raw))throw fail(400,'INVALID_RETURN_FIELDS');
 const out={};
 for(const [k,v] of Object.entries(raw)){
  if(!allowedFields.has(k)||typeof v!=='string'||v.length>100)
   throw fail(400,'INVALID_RETURN_FIELDS');
  out[k]=v;
 }
 return out;
}
function snapshot(session){
 const uri=typeof session.upi_uri==='string'?session.upi_uri:'';
 if(!uri.startsWith('upi://pay?'))throw fail(409,'UPI_INTENT_NOT_STORED');
 const params=new URLSearchParams(uri.slice(uri.indexOf('?')+1));
 const pa=String(session.vpa_address||'').trim().toLowerCase();
 const amountPaise=rupeesToPaise(String(session.challenge_amount));
 if(!pa||params.get('pa')?.toLowerCase()!==pa||
    rupeesToPaise(String(params.get('am')||''))!==amountPaise)
  throw fail(409,'IMMUTABLE_INTENT_MISMATCH');
 const kind=params.has('mc')?'P2M':'P2P';
 if(kind==='P2M'&&(!/^[0-9]{4}$/.test(params.get('mc')||'')||!params.get('tr')))
  throw fail(409,'INVALID_P2M_INTENT');
 return {kind,payee:pa,amountPaise,txnRef:kind==='P2M'?params.get('tr'):String(session.txn_ref||'')};
}
function classify(twin,kind,params,serverTime,otherOrder){
 const origin={source:'BROWSER_OBSERVATION',paymentResultAuthenticated:false,deviceIntegrity:'UNKNOWN'};
 if(kind!=='RETURN')return {state:kind==='HANDOFF'?'HANDOFF_RECORDED':'BACKGROUND_OBSERVED',decision:'UNKNOWN',
  utrCandidate:null,correlation:{...origin}};
 const utrFields=[params.txnId,params.ApprovalRefNo].filter(Boolean);
 const candidates=utrFields.filter(x=>/^[0-9]{12}$/.test(x));
 const utrCandidate=candidates[0]||null;
 const utrFieldsConsistent=candidates.length<2||candidates.every(x=>x===candidates[0]);
 let amountMatches=null;
 if(params.am!==undefined){try{amountMatches=rupeesToPaise(params.am)===twin.amount_paise}catch(_){amountMatches=false}}
 const payeeMatches=params.pa===undefined?null:params.pa.toLowerCase()===twin.payee_vpa;
 const ref=params.tr??params.txnRef;
 const referenceMatches=ref===undefined?null:ref===twin.txn_ref;
 const expired=serverTime>Number(twin.expires_at);
 const claimedStatus=String(params.Status??params.status??'').toUpperCase();
 const conflict=!utrFieldsConsistent||Boolean(otherOrder)||amountMatches===false||
  payeeMatches===false||referenceMatches===false;
 let state='RETURN_OBSERVED_NO_UTR',decision='UNKNOWN';
 if(utrCandidate)state='UTR_CANDIDATE_UNVERIFIED';
 if(['FAILURE','FAILED','CANCELLED'].includes(claimedStatus))state='FAILURE_CLAIM_UNVERIFIED';
 if(conflict){state='CONFLICTING_EVIDENCE';decision='NO'}
 if(expired){state='LATE_RETURN_OBSERVATION';decision='UNKNOWN'}
 return {state,decision,utrCandidate,correlation:{
  ...origin,claimedStatus:claimedStatus||null,amountMatches,payeeMatches,referenceMatches,
  utrFormatValid:Boolean(utrCandidate),utrFieldsConsistent,
  utrReusedOnOtherOrder:Boolean(otherOrder),withinSessionWindow:!expired,
  originalOrderBound:true,transactionCompleted:'UNKNOWN'
 }};
}
async function initializeQuantumSignal(pg){
 if(!pg)return;
 await pg.query(
  'CREATE TABLE IF NOT EXISTS disha_quantum_twins ('+
  'order_id TEXT PRIMARY KEY, vault_session_id TEXT NOT NULL REFERENCES disha_vault_authorizations(vault_session_id),'+
  'nonce TEXT NOT NULL, payment_kind TEXT NOT NULL,amount_paise TEXT NOT NULL,'+
  'payee_vpa TEXT NOT NULL,txn_ref TEXT NOT NULL,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL);'+
  'CREATE TABLE IF NOT EXISTS disha_quantum_events ('+
  'event_id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES disha_quantum_twins(order_id),'+
  'event_kind TEXT NOT NULL,observed_at BIGINT NOT NULL,payload_hash TEXT NOT NULL,'+
  'source TEXT NOT NULL,return_fields JSONB NOT NULL,outcome TEXT NOT NULL,decision TEXT NOT NULL,'+
  'utr_candidate TEXT,correlation JSONB NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_qs_events_order ON disha_quantum_events(order_id,observed_at DESC);'+
  'CREATE INDEX IF NOT EXISTS idx_qs_events_utr ON disha_quantum_events(utr_candidate) WHERE utr_candidate IS NOT NULL;'
 );
}
function createQuantumSignalRouter({getPool}){
 const r=express.Router();
 const error=(res,e)=>res.status(e.status||500).set('Cache-Control','no-store')
  .json({success:false,error:e.status?e.code:'QUANTUM_SIGNAL_UNAVAILABLE'});
 async function authorizedOrder(c,orderId,token){
  if(!validId(orderId)||!validHex(token))throw fail(401,'SESSION_TOKEN_REQUIRED');
  const s=(await c.query('SELECT * FROM sessions WHERE order_id=$1',[orderId])).rows[0];
  if(!s||!ctEqual(s.session_id,token))throw fail(401,'SESSION_TOKEN_REQUIRED');
  return s;
 }
 const csrf=(req,token)=>{if(!ctEqual(req.get('x-csrf-token'),token))throw fail(403,'SESSION_CSRF_REQUIRED')};
 r.post('/start',async(req,res)=>{
  const pg=getPool();if(!pg)return error(res,fail(503,'POSTGRES_REQUIRED'));
  const {orderId,token,vaultSessionId}=req.body||{};
  const c=await pg.connect();let tx=false;
  try{
   csrf(req,token);
   if(!validHex(vaultSessionId))throw fail(403,'VAULT_SESSION_REQUIRED');
   await c.query('BEGIN');tx=true;
   const s=await authorizedOrder(c,orderId,token),time=now();
   if(s.status!=='PENDING'||time>=Number(s.expires_at))throw fail(409,'ORDER_INACTIVE');
   const vault=(await c.query(
    'SELECT order_id,checkout_token_hash,expires_at FROM disha_vault_authorizations WHERE vault_session_id=$1',
    [vaultSessionId])).rows[0];
   if(!vault||vault.order_id!==orderId||time>=Number(vault.expires_at)||
    !ctEqual(vault.checkout_token_hash,sha(token)))throw fail(403,'VAULT_AUTHORIZATION_INVALID');
   const snap=snapshot(s);
   const existing=(await c.query('SELECT * FROM disha_quantum_twins WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
   if(existing&&existing.vault_session_id!==vaultSessionId)throw fail(409,'ORDER_ALREADY_BOUND_TO_VAULT');
   const nonce=existing?.nonce||crypto.randomBytes(20).toString('hex');
   const expiresAt=Math.min(Number(s.expires_at),Number(vault.expires_at));
   if(!existing)await c.query('INSERT INTO disha_quantum_twins ('+
    'order_id,vault_session_id,nonce,payment_kind,amount_paise,payee_vpa,txn_ref,created_at,expires_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orderId,vaultSessionId,nonce,snap.kind,
      snap.amountPaise,snap.payee,snap.txnRef,time,expiresAt]);
   await c.query('COMMIT');tx=false;
   return res.set('Cache-Control','no-store').status(existing?200:201).json({
    success:true,orderId,nonce,paymentType:snap.kind,expiresAt,
    authorizationDecision:'YES',deviceIntegrity:'UNKNOWN',paymentDecision:'UNKNOWN'
   });
  }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});return error(res,e)}
  finally{c.release()}
 });
 r.post('/event',async(req,res)=>{
  const pg=getPool();if(!pg)return error(res,fail(503,'POSTGRES_REQUIRED'));
  const {orderId,token,nonce,eventId,eventKind,app,returnParams}=req.body||{};
  const c=await pg.connect();let tx=false;
  try{
   csrf(req,token);
   if(!validId(eventId)||!/^qs_[a-f0-9]{32}$/.test(eventId)||!validEvents.has(eventKind)||
      !validApps.has(app)||!validHex(nonce))throw fail(400,'INVALID_SIGNAL_EVENT');
   const params=returnFields(returnParams),payload=JSON.stringify({orderId,nonce,eventId,eventKind,app,returnParams:params});
   if(payload.length>1700)throw fail(413,'SIGNAL_TOO_LARGE');
   await c.query('BEGIN');tx=true;
   await authorizedOrder(c,orderId,token);
   const twin=(await c.query('SELECT * FROM disha_quantum_twins WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!twin||!ctEqual(twin.nonce,nonce))throw fail(403,'QUANTUM_SESSION_NOT_AUTHORIZED');
   const hash=sha(payload);
   const old=(await c.query('SELECT * FROM disha_quantum_events WHERE event_id=$1',[eventId])).rows[0];
   if(old){
    if(old.order_id!==orderId||!ctEqual(old.payload_hash,hash))throw fail(409,'SIGNAL_EVENT_REPLAY_CONFLICT');
    await c.query('COMMIT');tx=false;
    return res.set('Cache-Control','no-store').json({success:true,replayed:true,
     eventState:old.outcome,decision:old.decision,utrCandidate:old.utr_candidate||null});
   }
   // No remote browser timestamp can widen the original server-derived window.
   const time=now();
   if(time>Number(twin.expires_at)+600000)throw fail(410,'SIGNAL_WINDOW_CLOSED');
   const candidates=[params.txnId,params.ApprovalRefNo].filter(x=>/^[0-9]{12}$/.test(x||''));
   let other=null;
   if(eventKind==='RETURN'&&candidates.length){
    const prev=(await c.query('SELECT order_id FROM disha_quantum_events '+
     'WHERE utr_candidate=$1 AND order_id<>$2 LIMIT 1',[candidates[0],orderId])).rows[0];
    const bound=(await c.query('SELECT order_id FROM utr_order_bindings WHERE utr=$1',[candidates[0]])).rows[0];
    other=prev?.order_id||bound?.order_id||null;
    if(other===orderId)other=null;
   }
   const result=classify(twin,eventKind,params,time,other);
   await c.query('INSERT INTO disha_quantum_events(event_id,order_id,event_kind,observed_at,'+
    'payload_hash,source,return_fields,outcome,decision,utr_candidate,correlation) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[
      eventId,orderId,eventKind,time,hash,'BROWSER_OBSERVATION',JSON.stringify(params),
      result.state,result.decision,result.utrCandidate,JSON.stringify({...result.correlation,app})
    ]);
   await c.query('COMMIT');tx=false;
   return res.set('Cache-Control','no-store').status(202).json({success:true,replayed:false,
    eventState:result.state,decision:result.decision,utrCandidate:result.utrCandidate,
    correlation:result.correlation});
  }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});return error(res,e)}
  finally{c.release()}
 });
 r.get('/status/:orderId',async(req,res)=>{
  const pg=getPool();if(!pg)return error(res,fail(503,'POSTGRES_REQUIRED'));
  try{
   await authorizedOrder(pg,req.params.orderId,req.query.token);
   const twin=(await pg.query('SELECT payment_kind,expires_at FROM disha_quantum_twins WHERE order_id=$1',
     [req.params.orderId])).rows[0];
   const recent=(await pg.query('SELECT outcome,decision,utr_candidate,correlation FROM disha_quantum_events '+
     'WHERE order_id=$1 ORDER BY observed_at DESC LIMIT 1',[req.params.orderId])).rows[0];
   return res.set('Cache-Control','no-store').json({success:true,
    initialized:Boolean(twin),paymentType:twin?.payment_kind||null,expiresAt:twin?.expires_at||null,
    eventState:recent?.outcome||'AWAITING_VAULT_AUTHORIZATION',
    decision:recent?.decision||'UNKNOWN',utrCandidate:recent?.utr_candidate||null,
    correlation:recent?.correlation||null});
  }catch(e){return error(res,e)}
 });
 return r;
}
module.exports={initializeQuantumSignal,createQuantumSignalRouter,returnFields,snapshot,classify};
