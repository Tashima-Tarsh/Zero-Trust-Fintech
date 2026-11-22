'use strict';
/* Read-only authenticated application-return evidence. No debit or ledger promotion. */
const express=require('express');
const crypto=require('node:crypto');
const {verifyUPIResponse}=require('../lib/upi-response-verifier');
const money=require('./money');
function constantEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string'||!a||!b||a.length>256||b.length>256)return false;
 const ha=crypto.createHash('sha256').update(a).digest(),hb=crypto.createHash('sha256').update(b).digest();
 return crypto.timingSafeEqual(ha,hb);
}
function createUpiAppEvidenceRouter({getSession,getTrustedKeys,clock=()=>Date.now()}){
 if(typeof getSession!=='function'||typeof getTrustedKeys!=='function')throw Error('EVIDENCE_DEPENDENCIES_REQUIRED');
 const router=express.Router();
 router.post('/verify',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const {orderId,token,methodName,details}=req.body||{};
  if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(orderId)||
   typeof token!=='string'||token.length>256||typeof methodName!=='string'||
   !details||typeof details!=='object'||Array.isArray(details)||
   JSON.stringify(details).length>12000)return res.status(400).json({state:'INVALID_REQUEST',debitVerified:false,paymentVerified:false});
  let session;
  try{session=await getSession(orderId)}catch(_){return res.status(503).json({state:'SESSION_UNAVAILABLE',debitVerified:false,paymentVerified:false})}
  if(!session||!constantEqual(token,session.sessionId))
   return res.status(401).json({state:'SESSION_AUTH_REQUIRED',debitVerified:false,paymentVerified:false});
  if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
   return res.status(409).json({state:'P2P_ONLY',debitVerified:false,paymentVerified:false});
  if(!Number.isFinite(Number(session.expiresAt))||clock()>=Number(session.expiresAt)||
    session.status!=='PENDING')
   return res.status(409).json({state:'SESSION_NOT_ACTIVE',debitVerified:false,paymentVerified:false});
  let amount;
  try{amount=money.rupeesToPaise(String(session.challengeAmount))}catch(_){
   return res.status(409).json({state:'SESSION_AMOUNT_INVALID',debitVerified:false,paymentVerified:false});
  }
  const expected={pa:session.vpaAddress,amount:money.paiseToRupees(amount),txnRef:session.txnRef};
  let keys;
  try{keys=getTrustedKeys()}catch(_){keys={}}
  const evidence=verifyUPIResponse({provider:methodName==='https://tez.google.com/pay'?'GOOGLE_PAY':'OTHER_UPI',
   response:{methodName,details},expected,trustedKeys:keys});
  // No response payload or payer PII is stored. Verified signature is not confirmation of debit.
  return res.json({state:'APP_RESPONSE_VERIFICATION_COMPLETED',orderId,
   signatureVerified:evidence.signatureVerified===true,
   responseReason:evidence.reason,provider:evidence.provider,
   providerReportedSuccess:evidence.providerReportedSuccess===true,
   debitVerified:false,paymentVerified:false,settlementVerified:false,paymentStateChanged:false});
 });
 return router;
}
module.exports={createUpiAppEvidenceRouter};
