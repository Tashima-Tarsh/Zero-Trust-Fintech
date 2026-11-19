'use strict';
/*
 * DISHA payer-side debit notification evidence.
 * No gateway, bank API, SMS permission, automatic settlement or webhook.
 * The source package name and notification text originate on the payer device;
 * a Keystore signature binds an observation to the authorized companion, but
 * cannot independently certify bank-credit or prevent a compromised phone lying.
 */
const crypto=require('node:crypto');
const express=require('express');
const {rupeesToPaise}=require('./money');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{24,64}$/i.test(v);
const orderIdOk=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(v);
const err=(status,code)=>Object.assign(new Error(code),{status,code});
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const safe=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const BASE_SOURCES=['com.google.android.apps.nbu.paisa.user','com.phonepe.app','net.one97.paytm','in.org.npci.upiapp'];
function sources(){
 const extra=String(process.env.DISHA_DEBIT_SOURCE_PACKAGES||'').split(',').map(s=>s.trim()).filter(s=>/^[a-zA-Z][A-Za-z0-9_.]{2,100}$/.test(s));
 return [...new Set([...BASE_SOURCES,...extra])];
}
function canonical(ev){
 return ['pairId','eventId','sourcePackage','postedAt','amount','utrCandidate','payeeCandidate','signal']
  .map(k=>String(ev[k]===undefined||ev[k]===null?'':ev[k])).join('|');
}
async function initPayerDebitEvidence(pg){
 if(!pg)return;
 await pg.query(
  'CREATE TABLE IF NOT EXISTS disha_debit_pairs ('+
  'pair_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,vault_session_id TEXT NOT NULL '+
  'REFERENCES disha_vault_authorizations(vault_session_id),code_hash TEXT NOT NULL,'+
  'device_key TEXT,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,activated_at BIGINT);'+
  'CREATE INDEX IF NOT EXISTS disha_debit_pairs_order ON disha_debit_pairs(order_id,created_at DESC);'+
  'CREATE TABLE IF NOT EXISTS disha_debit_events ('+
  'event_id TEXT PRIMARY KEY,pair_id TEXT NOT NULL REFERENCES disha_debit_pairs(pair_id),'+
  'order_id TEXT NOT NULL,source_package TEXT NOT NULL,observed_at BIGINT NOT NULL,'+
  'amount TEXT NOT NULL,utr_candidate TEXT,payee_candidate TEXT,'+
  'state TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());'+
  'CREATE INDEX IF NOT EXISTS disha_debit_events_order ON disha_debit_events(order_id,created_at DESC);'+
  'CREATE INDEX IF NOT EXISTS disha_debit_events_utr ON disha_debit_events(utr_candidate) WHERE utr_candidate IS NOT NULL;'
 );
}
function checkEvidence(session,pair,ev,previous){
 let amountCorrect=false;
 try{amountCorrect=rupeesToPaise(String(ev.amount))===rupeesToPaise(String(session.challenge_amount))}catch(_){}
 const payee=String(ev.payeeCandidate||'').toLowerCase();
 const payeeCorrect=!payee||payee===String(session.vpa_address||'').toLowerCase();
 const utr=String(ev.utrCandidate||'');
 const utrValid=/^\d{12}$/.test(utr);
 const timeCorrect=Number.isSafeInteger(ev.postedAt)&&ev.postedAt>=Number(pair.activated_at)-5000&&
  ev.postedAt<=Number(pair.expires_at)&&ev.postedAt<=Date.now()+5000;
 const sourceCorrect=sources().includes(ev.sourcePackage);
 const explicitDebit=ev.signal==='DEBIT';
 const conflict=!amountCorrect||!payeeCorrect||Boolean(previous);
 const state=!explicitDebit||!sourceCorrect||!timeCorrect?'DEBIT_EVIDENCE_REJECTED':
  conflict?'CONFLICTING_DEBIT_EVIDENCE':
  utrValid?'PAYER_DEBIT_EVIDENCE_MATCHED':'PAYER_DEBIT_OBSERVED_NO_UTR';
 return {state,matched:state==='PAYER_DEBIT_EVIDENCE_MATCHED',details:{
  amountCorrect,payeeCorrect,utrValid,timeCorrect,sourceCorrect,explicitDebit,
  reusedUtr:Boolean(previous),orderBound:true}};
}
function createPayerDebitRouter({getPool}){
 const router=express.Router();
 async function sessionFor(c,orderId,token){
  if(!orderIdOk(orderId)||!hex(token))throw err(400,'INVALID_ORDER_TOKEN');
  const row=(await c.query('SELECT * FROM sessions WHERE order_id=$1',[orderId])).rows[0];
  if(!row||!safe(token,row.session_id))throw err(403,'CHECKOUT_TOKEN_REQUIRED');
  return row;
 }
 function respond(res,e){res.status(e.status||500).json({success:false,error:e.status?e.code:'PAYER_DEBIT_UNAVAILABLE'})}
 router.post('/pair',async(req,res)=>{
  const c=getPool();if(!c)return res.status(503).json({success:false,error:'POSTGRES_REQUIRED'});
  try{
   const {orderId,token,vaultSessionId}=req.body||{};
   if(!hex(vaultSessionId)||!safe(req.get('x-csrf-token'),token))throw err(403,'VAULT_AUTHORIZATION_REQUIRED');
   const s=await sessionFor(c,orderId,token);
   const now=Date.now();
   if(s.status!=='PENDING'||now>Number(s.expires_at))throw err(409,'SESSION_NOT_ACTIVE');
   const auth=(await c.query('SELECT * FROM disha_vault_authorizations WHERE vault_session_id=$1 AND order_id=$2',
    [vaultSessionId,orderId])).rows[0];
   if(!auth||now>Number(auth.expires_at)||!safe(auth.checkout_token_hash,sha(token)))
    throw err(403,'VAULT_AUTHORIZATION_REQUIRED');
   const code=crypto.randomBytes(32).toString('hex'),pairId='pd_'+crypto.randomBytes(12).toString('hex');
   const expiresAt=Math.min(now+180000,Number(s.expires_at),Number(auth.expires_at));
   await c.query('INSERT INTO disha_debit_pairs(pair_id,order_id,vault_session_id,code_hash,created_at,expires_at) '+
    'VALUES($1,$2,$3,$4,$5,$6)',[pairId,orderId,vaultSessionId,sha(code),now,expiresAt]);
   return res.status(201).set('Cache-Control','no-store').json({success:true,pairId,code,expiresAt});
  }catch(e){respond(res,e)}
 });
 router.post('/activate',async(req,res)=>{
  const pg=getPool();if(!pg)return res.status(503).json({success:false,error:'POSTGRES_REQUIRED'});
  const {pairId,code,publicKey}=req.body||{};
  if(!/^pd_[a-f0-9]{24}$/.test(pairId||'')||!hex(code)||typeof publicKey!=='string'||publicKey.length>2048)
   return res.status(400).json({success:false,error:'INVALID_DEVICE_PAIR'});
  const c=await pg.connect();let active=false;
  try{
   let key;try{key=crypto.createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error('curve');
   }catch(_){throw err(400,'INVALID_DEVICE_PUBLIC_KEY')}
   await c.query('BEGIN');active=true;
   const pair=(await c.query('SELECT * FROM disha_debit_pairs WHERE pair_id=$1 FOR UPDATE',[pairId])).rows[0];
   if(!pair||Date.now()>Number(pair.expires_at)||!safe(pair.code_hash,sha(code)))
    throw err(403,'PAIRING_EXPIRED_OR_INVALID');
   if(pair.activated_at)throw err(409,'PAIR_ALREADY_USED');
   await c.query('UPDATE disha_debit_pairs SET device_key=$2,activated_at=$3 WHERE pair_id=$1',[pairId,publicKey,Date.now()]);
   const s=(await c.query('SELECT challenge_amount,vpa_address FROM sessions WHERE order_id=$1',[pair.order_id])).rows[0];
   if(!s)throw err(404,'ORDER_NOT_FOUND');
   await c.query('COMMIT');active=false;
   return res.status(200).json({success:true,pairId,expiresAt:pair.expires_at,
    expectedAmount:String(s.challenge_amount),expectedPayee:String(s.vpa_address),allowedPackages:sources()});
  }catch(e){if(active)await c.query('ROLLBACK').catch(()=>{});respond(res,e)}
  finally{c.release()}
 });
 router.post('/report',async(req,res)=>{
  const pg=getPool();if(!pg)return res.status(503).json({success:false,error:'POSTGRES_REQUIRED'});
  const {evidence:ev,signature}=req.body||{};
  if(!ev||typeof ev!=='object'||Array.isArray(ev)||typeof signature!=='string'||signature.length>300||
   !/^pd_[a-f0-9]{24}$/.test(ev.pairId||'')||!/^pd_event_[a-f0-9]{32}$/.test(ev.eventId||'')||
   typeof ev.sourcePackage!=='string'||ev.sourcePackage.length>110||
   typeof ev.amount!=='string'||ev.amount.length>20||
   typeof ev.utrCandidate!=='string'||ev.utrCandidate.length>20||
   typeof ev.payeeCandidate!=='string'||ev.payeeCandidate.length>110)
   return res.status(400).json({success:false,error:'INVALID_DEBIT_EVIDENCE'});
  const c=await pg.connect();let active=false;
  try{
   await c.query('BEGIN');active=true;
   const pair=(await c.query('SELECT * FROM disha_debit_pairs WHERE pair_id=$1 FOR UPDATE',[ev.pairId])).rows[0];
   if(!pair||!pair.activated_at||Date.now()>Number(pair.expires_at))throw err(403,'DEBIT_PAIR_INACTIVE');
   const pk=crypto.createPublicKey({key:Buffer.from(pair.device_key,'base64'),type:'spki',format:'der'});
   if(!crypto.verify('sha256',Buffer.from(canonical(ev)),pk,Buffer.from(signature,'base64')))
    throw err(403,'DEVICE_SIGNATURE_INVALID');
   const contentHash=sha(canonical(ev));
   const existing=(await c.query('SELECT content_hash,state FROM disha_debit_events WHERE event_id=$1',[ev.eventId])).rows[0];
   if(existing){
    if(!safe(existing.content_hash,contentHash))throw err(409,'DEBIT_EVENT_REPLAY_CONFLICT');
    await c.query('COMMIT');active=false;
    return res.json({success:true,state:existing.state,matched:existing.state==='PAYER_DEBIT_EVIDENCE_MATCHED',
     paymentCompleted:false,replayed:true});
   }
   const s=(await c.query('SELECT * FROM sessions WHERE order_id=$1',[pair.order_id])).rows[0];
   if(!s)throw err(404,'ORDER_NOT_FOUND');
   const utr=/^\d{12}$/.test(ev.utrCandidate)?ev.utrCandidate:null;
   const previously=utr?(await c.query('SELECT order_id FROM disha_debit_events WHERE utr_candidate=$1 AND order_id<>$2 LIMIT 1',
    [utr,pair.order_id])).rows[0]:null;
   const check=checkEvidence(s,pair,ev,previously?.order_id||null);
   await c.query('INSERT INTO disha_debit_events(event_id,pair_id,order_id,source_package,observed_at,'+
    'amount,utr_candidate,payee_candidate,state,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [ev.eventId,ev.pairId,pair.order_id,ev.sourcePackage,ev.postedAt,ev.amount,utr,ev.payeeCandidate,check.state,contentHash]);
   await c.query('COMMIT');active=false;
   // Deliberately no UPDATE sessions status=SUCCESS; no journal or ledger credit.
   return res.status(202).json({success:true,state:check.state,matched:check.matched,
    paymentCompleted:false,correlation:check.details});
  }catch(e){if(active)await c.query('ROLLBACK').catch(()=>{});respond(res,e)}
  finally{c.release()}
 });
 router.get('/status/:orderId',async(req,res)=>{
  const pg=getPool();if(!pg)return res.status(503).json({success:false,error:'POSTGRES_REQUIRED'});
  try{
   const s=await sessionFor(pg,req.params.orderId,req.query.token);
   const pair=(await pg.query('SELECT pair_id,activated_at,expires_at FROM disha_debit_pairs WHERE order_id=$1 '+
    'ORDER BY created_at DESC LIMIT 1',[s.order_id])).rows[0];
   const e=(await pg.query('SELECT state,utr_candidate,source_package,observed_at FROM disha_debit_events '+
    'WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',[s.order_id])).rows[0];
   return res.set('Cache-Control','no-store').json({success:true,paired:Boolean(pair?.activated_at),
    pairingExpired:pair?Date.now()>Number(pair.expires_at):false,
    evidenceState:e?.state||'AWAITING_PAYER_DEBIT_EVIDENCE',
    payerDebitEvidenceMatched:e?.state==='PAYER_DEBIT_EVIDENCE_MATCHED',
    utrCandidate:e?.utr_candidate||null,paymentCompleted:s.status==='SUCCESS',
    sourcePackage:e?.source_package||null});
  }catch(e){respond(res,e)}
 });
 return router;
}
module.exports={createPayerDebitRouter,initPayerDebitEvidence,checkEvidence,canonical,sources};
