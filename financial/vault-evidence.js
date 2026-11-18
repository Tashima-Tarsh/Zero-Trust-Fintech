'use strict';
/**
 * DISHA Vault -> browser -> server: observation evidence only.
 * A verified WebAuthn ceremony authorizes this order's browser handoff.
 * A browser cannot read a different UPI application's private transaction
 * data; URI return parameters are untrusted claims, not confirmed credits.
 */
const crypto = require('node:crypto');
const express = require('express');
const {rupeesToPaise} = require('./money');
const {evaluateTemporalGate}=require('../utils/pony-tail-window');

const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(v);
const validHex=v=>typeof v==='string'&&/^[a-f0-9]{24,64}$/i.test(v);
const invalid=(status,code)=>Object.assign(new Error(code),{status,code});
const fields=['Status','status','txnId','txnRef','ApprovalRefNo','responseCode','tr','am','pa'];
const validEvent=new Set(['APP_RESUME','PAGESHOW_RETURN','RETURN_QUERY_OBSERVED']);
const timingEqual=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string')return false;
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
};

async function initializeVaultEvidenceSchema(pg){
  await pg.query(
    "CREATE TABLE IF NOT EXISTS disha_vault_authorizations ("+
    "vault_session_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,"+
    "checkout_token_hash TEXT NOT NULL,authorized_at BIGINT NOT NULL,"+
    "expires_at BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());"+
    "CREATE INDEX IF NOT EXISTS idx_disha_vault_auth_order ON disha_vault_authorizations(order_id);"+
    "CREATE TABLE IF NOT EXISTS disha_vault_evidence ("+
    "event_id TEXT PRIMARY KEY,vault_session_id TEXT NOT NULL "+
    "REFERENCES disha_vault_authorizations(vault_session_id),"+
    "order_id TEXT NOT NULL,payload_hash TEXT NOT NULL,"+
    "browser_event TEXT NOT NULL,observed_at BIGINT NOT NULL,"+
    "utr_candidate TEXT,claimed_status TEXT,"+
    "outcome TEXT NOT NULL,correlation JSONB NOT NULL,"+
    "return_params JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());"+
    "CREATE INDEX IF NOT EXISTS idx_disha_vault_evidence_order "+
    "ON disha_vault_evidence(order_id,created_at DESC);"+
    "CREATE INDEX IF NOT EXISTS idx_disha_vault_evidence_utr "+
    "ON disha_vault_evidence(utr_candidate) WHERE utr_candidate IS NOT NULL"
  );
}

async function rememberVaultAuthorization(pg,orderId,vaultSessionId){
  if(!pg)return; // SQLite fallback retains checkout, not durable evidence.
  if(!validId(orderId)||!validHex(vaultSessionId))throw invalid(400,'INVALID_VAULT_AUTHORIZATION');
  const order=(await pg.query(
    'SELECT session_id,status,expires_at FROM sessions WHERE order_id=$1',[orderId])).rows[0];
  if(!order||order.status!=='PENDING'||Date.now()>Number(order.expires_at))
    throw invalid(409,'ORDER_NOT_ACTIVE');
  // Only called *after* server-side WebAuthn signature verification.
  const tokenHash=crypto.createHash('sha256').update(order.session_id).digest('hex');
  const now=Date.now();
  await pg.query(
    'INSERT INTO disha_vault_authorizations(vault_session_id,order_id,'+
    'checkout_token_hash,authorized_at,expires_at) VALUES($1,$2,$3,$4,$5) '+
    'ON CONFLICT(vault_session_id) DO NOTHING',
    [vaultSessionId,orderId,tokenHash,now,Math.min(now+600000,Number(order.expires_at)+600000)]
  );
}

function validatePacket(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
     !validId(body.orderId)||!validHex(body.vaultSessionId)||
     !validHex(body.token)||!validId(body.eventId))
    throw invalid(400,'INVALID_VAULT_EVIDENCE');
  const e=body.evidence;
  if(!e||typeof e!=='object'||Array.isArray(e)||!validEvent.has(e.browserEvent)||
     !Number.isSafeInteger(e.handoffAt)||!Number.isSafeInteger(e.returnedAt)||
     (e.hiddenAt!==null&&!Number.isSafeInteger(e.hiddenAt))||
     !e.returnParams||typeof e.returnParams!=='object'||Array.isArray(e.returnParams))
    throw invalid(400,'INVALID_VAULT_EVIDENCE');
  const params={};
  for(const [key,value] of Object.entries(e.returnParams)){
    if(!fields.includes(key)||typeof value!=='string'||value.length>100)
      throw invalid(400,'INVALID_RETURN_PARAMETER');
    params[key]=value;
  }
  if(JSON.stringify(e).length>2000)throw invalid(413,'EVIDENCE_TOO_LARGE');
  if(e.handoffAt<0||e.handoffAt>Date.now()+300000||
     e.returnedAt<e.handoffAt||e.returnedAt>Date.now()+300000||
     (e.hiddenAt!==null&&(e.hiddenAt<e.handoffAt||e.hiddenAt>e.returnedAt)))
    throw invalid(400,'INVALID_HANDOFF_TIMELINE');
  if(!e.hiddenAt && Object.keys(params).length===0)
    throw invalid(400,'NO_RETURN_OBSERVATION');
  return {browserEvent:e.browserEvent,handoffAt:e.handoffAt,
    hiddenAt:e.hiddenAt,returnedAt:e.returnedAt,returnParams:params};
}

function classify(order,e,previousUtrOrder,now){
  const p=e.returnParams;
  // Server clock, not browser-supplied return time, controls Pony-tail state.
  const temporal=evaluateTemporalGate({
    createdAt:Number(order.created_at),expiresAt:Number(order.expires_at)
  },now);
  const candidates=[p.txnId,p.ApprovalRefNo].filter(Boolean);
  const validCandidates=candidates.filter(v=>/^[0-9]{12}$/.test(v));
  const utr=validCandidates.length?validCandidates[0]:null;
  const flags={
    vaultAuthorization:true,
    browserReturnOnly:true,
    backgroundObserved:e.hiddenAt!==null,
    utrObserved:Boolean(utr),
    sameUtrFields:validCandidates.length<2||validCandidates.every(v=>v===validCandidates[0]),
    amountMatches:p.am===undefined?null:false,
    payeeMatches:p.pa===undefined?null:String(p.pa).toLowerCase()===String(order.vpa_address).toLowerCase(),
    transactionRefMatches:(p.tr===undefined&&p.txnRef===undefined)?null:false,
    temporalGate:temporal.state,
    elapsedMs:temporal.elapsedMs,
    withinCheckoutWindow:temporal.state==='WAITING'||
      temporal.state==='OBSERVATION_WINDOW',
    existingUtrOrder:previousUtrOrder||null
  };
  if(p.am!==undefined){
    try{flags.amountMatches=rupeesToPaise(p.am)===rupeesToPaise(String(order.challenge_amount))}
    catch(_){flags.amountMatches=false}
  }
  const ref=p.tr||p.txnRef;
  if(ref!==undefined)flags.transactionRefMatches=
    ref===order.txn_ref||ref===order.order_id.replace(/[^A-Za-z0-9]/g,'').slice(0,35);
  const claimedStatus=String(p.Status||p.status||'').toUpperCase().slice(0,20)||null;
  let outcome=utr?'UTR_CANDIDATE_UNVERIFIED':'RETURN_OBSERVED_NO_UTR';
  if(claimedStatus==='FAILURE'||claimedStatus==='FAILED')outcome='FAILURE_CLAIM_UNVERIFIED';
  if(!flags.sameUtrFields||flags.amountMatches===false||flags.payeeMatches===false||
     flags.transactionRefMatches===false||(previousUtrOrder&&previousUtrOrder!==order.order_id))
    outcome='CONFLICTING_EVIDENCE';
  if(!flags.withinCheckoutWindow)outcome='LATE_RETURN_OBSERVATION';
  return {outcome,utrCandidate:utr,claimedStatus,correlation:flags};
}

async function persistVaultEvidence(pg,body){
  const e=validatePacket(body);
  const c=await pg.connect();let active=false;
  try{
    await c.query('BEGIN');active=true;
    const auth=(await c.query(
      'SELECT * FROM disha_vault_authorizations WHERE vault_session_id=$1 FOR UPDATE',
      [body.vaultSessionId])).rows[0];
    if(!auth||auth.order_id!==body.orderId)
      throw invalid(403,'VAULT_AUTHORIZATION_NOT_FOUND');
    if(Date.now()>Number(auth.expires_at))
      throw invalid(403,'VAULT_AUTHORIZATION_EXPIRED');
    const tokenHash=crypto.createHash('sha256').update(body.token).digest('hex');
    if(!timingEqual(tokenHash,auth.checkout_token_hash))
      throw invalid(403,'CHECKOUT_TOKEN_MISMATCH');
    const order=(await c.query('SELECT * FROM sessions WHERE order_id=$1',[body.orderId])).rows[0];
    if(!order||!timingEqual(body.token,order.session_id))
      throw invalid(403,'CHECKOUT_SESSION_MISMATCH');

    const contentHash=crypto.createHash('sha256').update(JSON.stringify({
      orderId:body.orderId,vaultSessionId:body.vaultSessionId,evidence:e
    })).digest('hex');
    const old=(await c.query(
      'SELECT payload_hash,outcome,utr_candidate,correlation FROM disha_vault_evidence '+
      'WHERE event_id=$1',[body.eventId])).rows[0];
    if(old){
      if(old.payload_hash!==contentHash)throw invalid(409,'EVIDENCE_EVENT_REPLAY_CONFLICT');
      await c.query('COMMIT');active=false;
      return {state:old.outcome,utrCandidate:old.utr_candidate,
        correlation:old.correlation,replayed:true,verified:false,settled:false};
    }
    const utr=[e.returnParams.txnId,e.returnParams.ApprovalRefNo]
      .filter(v=>typeof v==='string'&&/^[0-9]{12}$/.test(v))[0];
    let previous=null;
    if(utr){
      const bound=(await c.query('SELECT order_id FROM utr_order_bindings WHERE utr=$1',[utr])).rows[0];
      const seen=(await c.query(
        'SELECT order_id FROM disha_vault_evidence WHERE utr_candidate=$1 AND order_id<>$2 LIMIT 1',
        [utr,body.orderId])).rows[0];
      previous=bound?.order_id||seen?.order_id||null;
    }
    const result=classify(order,e,previous,Date.now());
    await c.query(
      'INSERT INTO disha_vault_evidence(event_id,vault_session_id,order_id,payload_hash,'+
      'browser_event,observed_at,utr_candidate,claimed_status,outcome,correlation,return_params) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [body.eventId,body.vaultSessionId,body.orderId,contentHash,
       e.browserEvent,e.returnedAt,result.utrCandidate,result.claimedStatus,
       result.outcome,JSON.stringify(result.correlation),JSON.stringify(e.returnParams)]);
    await c.query('COMMIT');active=false;
    // This method does not change session state, financial transactions or ledgers.
    return {state:result.outcome,utrCandidate:result.utrCandidate,
      correlation:result.correlation,replayed:false,verified:false,settled:false};
  }catch(err){
    if(active)try{await c.query('ROLLBACK')}catch(_){}
    throw err;
  }finally{c.release()}
}

function createVaultEvidenceRouter({getPool}){
  const router=express.Router();
  router.post('/evidence',async(req,res)=>{
    // Express JSON parsing is registered after the global CSRF middleware;
    // enforce this route's bound-token header here, after parsing the body.
    const csrf=req.get('x-csrf-token');
    if(!timingEqual(csrf,req.body?.token))
      return res.status(403).json({success:false,error:'VAULT_CSRF_TOKEN_REQUIRED'});
    const pool=getPool();
    if(!pool)return res.status(503).json({success:false,error:'EVIDENCE_STORAGE_UNAVAILABLE'});
    try{
      const r=await persistVaultEvidence(pool,req.body);
      return res.status(202).set('Cache-Control','no-store')
        .json({success:true,...r});
    }catch(err){
      if(!err.status)console.error('[Vault evidence]',err.message);
      return res.status(err.status||500).json({
        success:false,error:err.status?err.code:'EVIDENCE_STORAGE_UNAVAILABLE'
      });
    }
  });
  return router;
}

module.exports={initializeVaultEvidenceSchema,rememberVaultAuthorization,
  createVaultEvidenceRouter,persistVaultEvidence,validatePacket,classify};
