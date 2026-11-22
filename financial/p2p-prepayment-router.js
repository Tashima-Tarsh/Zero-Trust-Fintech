'use strict';
const express=require('express'),crypto=require('node:crypto');
const {evaluatePrepaymentTrust}=require('./p2p-prepayment-trust-policy');
function equal(a,b){
 if(typeof a!=='string'||typeof b!=='string'||!a||!b||a.length>256||b.length>256)return false;
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
}
function createP2pPrepaymentRouter({getSession,getVaultChallenge,getVerifiedDeviceAttestation,passkeyOnlyUntil=0,clock=()=>Date.now()}){
 if(![getSession,getVaultChallenge,getVerifiedDeviceAttestation].every(f=>typeof f==='function'))throw Error('PREPAYMENT_DEPENDENCY_REQUIRED');
 const router=express.Router();
 router.post('/authorize',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const {orderId,token,vaultSessionId}=req.body||{};
  if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(orderId)||
    typeof token!=='string'||token.length>256||
    typeof vaultSessionId!=='string'||!/^[a-f0-9]{32}$/i.test(vaultSessionId))
    return res.status(400).json({authorized:false,reason:'INVALID_REQUEST'});
  if(!equal(req.get('X-CSRF-Token'),token))return res.status(403).json({authorized:false,reason:'CHECKOUT_PROOF_REQUIRED'});
  try{
   const session=await getSession(orderId);
   if(!session||!equal(session.sessionId,token))return res.status(401).json({authorized:false,reason:'SESSION_AUTH_REQUIRED'});
   if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase())||session.status!=='PENDING')
    return res.status(409).json({authorized:false,reason:'SESSION_NOT_ACTIVE'});
   const challenge=await getVaultChallenge(vaultSessionId);
   const verified=challenge?.status==='VAULT_VERIFIED_AWAITING_UPI'&&challenge.orderId===orderId&&
     Number.isFinite(challenge.verifiedAt)&&Number(challenge.expiresAt)>clock();
   const now=clock();
   const temporaryPasskeyOnly=Number.isFinite(passkeyOnlyUntil)&&now<passkeyOnlyUntil;
   const device=temporaryPasskeyOnly?null:await getVerifiedDeviceAttestation({orderId,session});
   // Trusted device attestation is loaded from the server, NEVER from browser JSON.
   const outcome=evaluatePrepaymentTrust({orderId,sessionExpiresAt:session.expiresAt,
    auth:verified?{orderId,userVerified:true,verifiedAt:challenge.verifiedAt}:{},
    device:device||{}},clock);
   const reasons=temporaryPasskeyOnly?outcome.reasons.filter(reason=>
    reason!=='DEVICE_INTEGRITY_NOT_VERIFIED'&&reason!=='DEBUGGER_RISK_NOT_VERIFIED'):outcome.reasons;
   if(reasons.length)return res.status(403).json({authorized:false,
    reasons,debitVerified:false,paymentVerified:false});
   return res.json({authorized:true,orderId,expiresAt:Math.min(Number(session.expiresAt),
    Number(challenge.expiresAt),challenge.verifiedAt+180000,
    temporaryPasskeyOnly?passkeyOnlyUntil:Number(device.verifiedAt)+180000),
    debitVerified:false,paymentVerified:false});
  }catch(_){return res.status(503).json({authorized:false,reason:'TRUST_VERIFICATION_UNAVAILABLE'})}
 });
 return router;
}
module.exports={createP2pPrepaymentRouter,equal};
