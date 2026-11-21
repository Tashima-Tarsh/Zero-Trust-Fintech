'use strict';
/**
 * Experimental payer-side credential transport (zero-install checkout).
 * Issuer signatures authenticate signed claims, not bank ledger settlement.
 * Requires a participating wallet; today's UPI apps do not implement this contract.
 */
const crypto=require('node:crypto');
const express=require('express');
const {rupeesToPaise}=require('./money');
const {createEvidenceAcknowledgement}=require('./debit-evidence-receipt');
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(value);
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{24,64}$/i.test(value);
const same=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const fields=['protocol','issuerId','serviceRequestId','challenge','utr',
 'debitConfirmed','amountPaise','payeeVpa','paidAt'];
function canonicalReceipt(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).length!==fields.length||!fields.every(k=>Object.hasOwn(input,k)))
  throw fail(422,'DEBIT_CREDENTIAL_FIELDS_INVALID');
 const e=Object.fromEntries(fields.map(k=>[k,input[k]]));
 if(e.protocol!=='DISHA-DEBIT-CREDENTIAL-V1'||
   !/^[A-Za-z0-9._-]{3,64}$/.test(e.issuerId||'')||
   !validId(e.serviceRequestId)||!/^[a-f0-9]{64}$/.test(e.challenge||'')||
   !/^[0-9]{12}$/.test(e.utr||'')||e.debitConfirmed!==true||
   !/^[1-9][0-9]{0,15}$/.test(e.amountPaise||'')||
   !/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(e.payeeVpa||'')||
   !Number.isSafeInteger(e.paidAt)||e.paidAt<=0)
  throw fail(422,'DEBIT_CREDENTIAL_FIELDS_INVALID');
 return JSON.stringify(e);
}
function verifyReceipt(receipt,signature,publicKey,bound,now=Date.now()){
 const data=canonicalReceipt(receipt);
 if(!same(receipt.issuerId,bound.issuerId)||
    !same(receipt.serviceRequestId,bound.serviceRequestId)||
    !same(receipt.challenge,bound.challenge)||
    !same(receipt.amountPaise,bound.amountPaise)||
    !same(receipt.payeeVpa,bound.payeeVpa))
  throw fail(409,'DEBIT_CREDENTIAL_BINDING_MISMATCH');
 if(now>bound.expiresAt||receipt.paidAt<bound.createdAt-30000||
   receipt.paidAt>bound.expiresAt||receipt.paidAt>now+30000)
  throw fail(410,'DEBIT_CREDENTIAL_EXPIRED');
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))
  throw fail(401,'DEBIT_CREDENTIAL_SIGNATURE_INVALID');
 const sig=Buffer.from(signature,'base64url');
 let key;
 try{key=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey)}
 catch(_){throw fail(503,'DEBIT_ISSUER_KEY_INVALID');}
 if(key.asymmetricKeyType!=='ed25519'||sig.length!==64||
    !crypto.verify(null,Buffer.from(data),key,sig))
  throw fail(401,'DEBIT_CREDENTIAL_SIGNATURE_INVALID');
 return sha(data);
}
async function initDebitCredentialSchema(pool){
 if(!pool)return;
 await pool.query(
  'CREATE TABLE IF NOT EXISTS disha_debit_credential_challenges ('+
   'service_request_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,challenge TEXT NOT NULL,'+
   'amount_paise TEXT NOT NULL,payee_vpa TEXT NOT NULL,created_at BIGINT NOT NULL,'+
   'expires_at BIGINT NOT NULL);'+
  'CREATE TABLE IF NOT EXISTS disha_debit_credential_claims ('+
   'service_request_id TEXT PRIMARY KEY,utr TEXT NOT NULL UNIQUE,'+
   'issuer_id TEXT NOT NULL,receipt_hash TEXT NOT NULL UNIQUE,received_at BIGINT NOT NULL);'
 );
}
function createDebitCredentialRouter({getPool,getSession}){
 const router=express.Router();
 const enabled=()=>process.env.DISHA_DEBIT_CREDENTIAL_EXPERIMENT==='1';
 const err=(res,e)=>res.status(e.status||503).set('Cache-Control','no-store')
  .json({success:false,error:e.status?e.code:'DEBIT_CREDENTIAL_UNAVAILABLE'});
 async function sessionFor(id,token){
  if(!validId(id)||!validToken(token))throw fail(401,'SESSION_TOKEN_REQUIRED');
  const session=await getSession(id);
  if(!session||!same(session.sessionId,token))throw fail(401,'SESSION_TOKEN_REQUIRED');
  if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
   throw fail(409,'P2P_REQUIRED');
  if(String(session.status).toUpperCase()!=='PENDING'||Date.now()>=Number(session.expiresAt))
   throw fail(409,'SERVICE_REQUEST_INACTIVE');
  return session;
 }
 function csrf(req,token){
  if(!same(req.get('x-csrf-token'),token))throw fail(403,'SESSION_CSRF_REQUIRED');
 }
 router.post('/challenge',async(req,res)=>{
  res.set('Cache-Control','no-store');
  // A read-only challenge is always available. Signing/presentation ingestion stays gated.
  const pool=getPool();if(!pool)return err(res,fail(503,'POSTGRES_REQUIRED'));
  const {serviceRequestId,token}=req.body||{};
  let client,tx=false;
  try{
   csrf(req,token);
   const session=await sessionFor(serviceRequestId,token);
   client=await pool.connect();await client.query('BEGIN');tx=true;
   const existing=(await client.query(
    'SELECT * FROM disha_debit_credential_challenges WHERE service_request_id=$1 FOR UPDATE',
    [serviceRequestId])).rows[0];
   const claimed=(await client.query(
    'SELECT 1 FROM disha_debit_credential_claims WHERE service_request_id=$1',
    [serviceRequestId])).rows[0];
   if(claimed)throw fail(409,'DEBIT_CREDENTIAL_ALREADY_USED');
   const now=Date.now(),amountPaise=rupeesToPaise(String(session.challengeAmount));
   const payeeVpa=String(session.vpaAddress||'').toLowerCase();
   if(!/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(payeeVpa))
    throw fail(409,'PAYEE_INVALID');
   if(existing&&(!same(existing.token_hash,sha(token))||
     existing.amount_paise!==amountPaise||existing.payee_vpa!==payeeVpa))
    throw fail(409,'SERVICE_REQUEST_BINDING_MISMATCH');
   const challenge=existing&&Number(existing.expires_at)>now?
    existing.challenge:crypto.randomBytes(32).toString('hex');
   const expiresAt=existing&&Number(existing.expires_at)>now?
    Number(existing.expires_at):Math.min(Number(session.expiresAt),now+120000);
   if(expiresAt<=now)throw fail(410,'DEBIT_CREDENTIAL_EXPIRED');
   if(!existing)await client.query(
    'INSERT INTO disha_debit_credential_challenges VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [serviceRequestId,sha(token),challenge,amountPaise,payeeVpa,now,expiresAt]);
   else if(Number(existing.expires_at)<=now)await client.query(
    'UPDATE disha_debit_credential_challenges SET challenge=$2,created_at=$3,expires_at=$4 WHERE service_request_id=$1',
    [serviceRequestId,challenge,now,expiresAt]);
   await client.query('COMMIT');tx=false;
   // OID4VP is the browser transport; participating wallets must implement
   // the DISHA debit credential type. No ordinary UPI app support is assumed.
   return res.json({success:true,serviceRequestId,expiresAt,
    protocol:'openid4vp-v1-unsigned',request:{
     response_type:'vp_token',response_mode:'dc_api',
     nonce:challenge,client_id:'web-origin:'+req.protocol+'://'+req.get('host'),
     dcql_query:{credentials:[{id:'disha_debit',format:'dc+sd-jwt',
      meta:{vct_values:['https://disha8-2.thenitishkr.in/credentials/upi-debit-v1']},
      claims:[{path:['utr']},{path:['debitConfirmed']},{path:['amountPaise']},{path:['payeeVpa']}]}]}
    }});
  }catch(e){if(tx)await client.query('ROLLBACK').catch(()=>{});return err(res,e)}
  finally{client?.release()}
 });

 // Master Bridge ingress. Only allowlisted issuer signatures, never text/SMS
 // supplied by a browser, can enter this evidence store.
 router.post('/provider-claim',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!enabled())return err(res,fail(503,'DEBIT_CREDENTIAL_DISABLED'));
  const pool=getPool();if(!pool)return err(res,fail(503,'POSTGRES_REQUIRED'));
  const issuerId=process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_ID||'';
  const keyBase64=process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_PUBLIC_KEY_BASE64||'';
  if(!issuerId||!keyBase64)return err(res,fail(503,'DEBIT_ISSUER_NOT_CONFIGURED'));
  const {receipt,signature}=req.body||{};
  let client,tx=false;
  try{
   const data=canonicalReceipt(receipt);
   if(data.length>4096||!same(receipt.issuerId,issuerId))
    throw fail(401,'DEBIT_PROVIDER_NOT_TRUSTED');
   const session=await getSession(receipt.serviceRequestId);
   if(!session||!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
    throw fail(404,'SERVICE_REQUEST_NOT_FOUND');
   if(String(session.status).toUpperCase()!=='PENDING'||
     Date.now()>=Number(session.expiresAt))throw fail(409,'SERVICE_REQUEST_INACTIVE');
   client=await pool.connect();await client.query('BEGIN');tx=true;
   const row=(await client.query(
    'SELECT * FROM disha_debit_credential_challenges WHERE service_request_id=$1 FOR UPDATE',
    [receipt.serviceRequestId])).rows[0];
   if(!row)throw fail(404,'DEBIT_CHALLENGE_MISSING');
   const amountPaise=rupeesToPaise(String(session.challengeAmount));
   const payeeVpa=String(session.vpaAddress||'').toLowerCase();
   if(row.amount_paise!==amountPaise||row.payee_vpa!==payeeVpa)
    throw fail(409,'SERVICE_REQUEST_BINDING_MISMATCH');
   const publicKey=crypto.createPublicKey({
    key:Buffer.from(keyBase64,'base64'),format:'der',type:'spki'
   });
   const receiptHash=verifyReceipt(receipt,signature,publicKey,{
    serviceRequestId:receipt.serviceRequestId,issuerId,
    challenge:row.challenge,amountPaise,payeeVpa,
    createdAt:Number(row.created_at),expiresAt:Number(row.expires_at)
   });
   await client.query(
    'INSERT INTO disha_debit_credential_claims(service_request_id,utr,issuer_id,receipt_hash,received_at) VALUES($1,$2,$3,$4,$5)',
    [receipt.serviceRequestId,receipt.utr,issuerId,receiptHash,Date.now()]);
   await client.query('COMMIT');tx=false;
   // A signed provider claim alone is NOT independent settlement evidence.
   return res.status(202).json({success:true,
    evidenceState:'ISSUER_SIGNED_DEBIT_CLAIM_UNVERIFIED',
    paymentVerified:false,debitVerified:false,paymentStateChanged:false});
  }catch(e){
   if(tx)await client.query('ROLLBACK').catch(()=>{});
   if(e.code==='23505')return err(res,fail(409,'DEBIT_REFERENCE_REPLAY'));
   return err(res,e);
  }finally{client?.release()}
 });
 // Checkout can retrieve its own signed claims, not arbitrary service IDs.
 router.get('/status/:serviceRequestId',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const pool=getPool();if(!pool)return err(res,fail(503,'POSTGRES_REQUIRED'));
  try{
   const serviceRequestId=req.params.serviceRequestId,token=req.query.token;
   if(!validId(serviceRequestId)||!validToken(token))
    throw fail(401,'SESSION_TOKEN_REQUIRED');
   const session=await getSession(serviceRequestId);
   if(!session||!same(session.sessionId,token))
    throw fail(401,'SESSION_TOKEN_REQUIRED');
   if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
    throw fail(409,'P2P_REQUIRED');
   const row=(await pool.query(
    'SELECT utr,issuer_id,received_at FROM disha_debit_credential_claims '+
    'WHERE service_request_id=$1',[serviceRequestId])).rows[0];
   return res.json({success:true,serviceRequestId,
    evidenceState:row?'ISSUER_SIGNED_DEBIT_CLAIM_UNVERIFIED':'AWAITING_TRUSTED_PROVIDER',
    issuerId:row?.issuer_id||null,utrCandidate:row?.utr||null,
    signedClaimReceivedAt:row?Number(row.received_at):null,
    paymentVerified:false,debitVerified:false,paymentStateChanged:false});
  }catch(e){return err(res,e)}
 });
 // DISHA-signed acknowledgement of a trusted issuer's submitted claim.
 // The server deliberately attests to evidence RECEIPT, not bank settlement.
 router.get('/evidence-receipt/:serviceRequestId',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const pool=getPool();if(!pool)return err(res,fail(503,'POSTGRES_REQUIRED'));
  try{
   const serviceRequestId=req.params.serviceRequestId,token=req.query.token;
   if(!validId(serviceRequestId)||!validToken(token))
    throw fail(401,'SESSION_TOKEN_REQUIRED');
   const session=await getSession(serviceRequestId);
   if(!session||!same(session.sessionId,token))
    throw fail(401,'SESSION_TOKEN_REQUIRED');
   if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
    throw fail(409,'P2P_REQUIRED');
   const row=(await pool.query(
    'SELECT utr,issuer_id,receipt_hash,received_at FROM disha_debit_credential_claims '+
    'WHERE service_request_id=$1',[serviceRequestId])).rows[0];
   if(!row)throw fail(404,'DEBIT_ISSUER_CLAIM_MISSING');
   const signingKey=process.env.DISHA_EVIDENCE_RECEIPT_PRIVATE_KEY_BASE64;
   if(!signingKey)throw fail(503,'DISHA_EVIDENCE_SIGNING_NOT_CONFIGURED');
   let receipt;
   try{receipt=createEvidenceAcknowledgement(serviceRequestId,row,signingKey)}
   catch(_){throw fail(503,'DISHA_EVIDENCE_SIGNING_UNAVAILABLE')}
   return res.json({success:true,evidenceReceipt:receipt,
    evidenceAuthenticated:true,debitVerified:false,paymentVerified:false,
    paymentStateChanged:false});
  }catch(e){return err(res,e)}
 });
 router.post('/present',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!enabled())return err(res,fail(503,'DEBIT_CREDENTIAL_DISABLED'));
  const pool=getPool();if(!pool)return err(res,fail(503,'POSTGRES_REQUIRED'));
  const {serviceRequestId,token,presentation}=req.body||{};
  let client,tx=false;
  try{
   csrf(req,token);
   const session=await sessionFor(serviceRequestId,token);
   const issuerId=process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_ID||'';
   const keyBase64=process.env.DISHA_DEBIT_CREDENTIAL_ISSUER_PUBLIC_KEY_BASE64||'';
   if(!issuerId||!keyBase64)throw fail(503,'DEBIT_ISSUER_NOT_CONFIGURED');
   if(!presentation||typeof presentation!=='object'||Array.isArray(presentation))
    throw fail(422,'DEBIT_PRESENTATION_INVALID');
   const {receipt,signature}=presentation;
   client=await pool.connect();await client.query('BEGIN');tx=true;
   const row=(await client.query(
    'SELECT * FROM disha_debit_credential_challenges WHERE service_request_id=$1 FOR UPDATE',
    [serviceRequestId])).rows[0];
   if(!row||!same(row.token_hash,sha(token)))throw fail(401,'DEBIT_CHALLENGE_MISSING');
   const currentAmount=rupeesToPaise(String(session.challengeAmount));
   const currentPayee=String(session.vpaAddress||'').toLowerCase();
   if(row.amount_paise!==currentAmount||row.payee_vpa!==currentPayee)
    throw fail(409,'SERVICE_REQUEST_BINDING_MISMATCH');
   const publicKey=crypto.createPublicKey({key:Buffer.from(keyBase64,'base64'),format:'der',type:'spki'});
   const receiptHash=verifyReceipt(receipt,signature,publicKey,
    {serviceRequestId,issuerId,challenge:row.challenge,amountPaise:row.amount_paise,
     payeeVpa:row.payee_vpa,createdAt:Number(row.created_at),expiresAt:Number(row.expires_at)});
   await client.query(
    'INSERT INTO disha_debit_credential_claims(service_request_id,utr,issuer_id,receipt_hash,received_at) VALUES($1,$2,$3,$4,$5)',
    [serviceRequestId,receipt.utr,issuerId,receiptHash,Date.now()]);
   await client.query('COMMIT');tx=false;
   // Cryptographically authenticated issuer claim is not independent bank settlement.
   return res.status(202).json({success:true,serviceRequestId,utr:receipt.utr,
    evidenceState:'ISSUER_SIGNED_DEBIT_CLAIM',issuerId,
    evidenceAuthenticated:true,debitVerified:false,paymentVerified:false,
    paymentStateChanged:false});
  }catch(e){
   if(tx)await client.query('ROLLBACK').catch(()=>{});
   if(e.code==='23505')return err(res,fail(409,'DEBIT_REFERENCE_REPLAY'));
   return err(res,e);
  }finally{client?.release()}
 });
 return router;
}
module.exports={canonicalReceipt,verifyReceipt,initDebitCredentialSchema,createDebitCredentialRouter};
