'use strict';
/**
 * UDEB reference evidence contract (Claude iteration 1).
 * This is a verification component only: it does not acquire Android data,
 * confirm debit or settlement, or mutate a financial ledger.
 */
const crypto=require('node:crypto');
const ORIGIN='https://disha8-2.thenitishkr.in';
const PROTOCOL='DISHA-UDEB-OBSERVATION-V1';
const FIELDS=['protocol','orderId','nonce','origin','sourceClass','sourceIdentity',
 'sourceCertificateSha256','eventId','amountPaise','payeeVpa','direction',
 'reference','observedAt','consentedAt'];
const fail=code=>({ok:false,code,paymentVerified:false,debitVerified:false,paymentStateChanged:false});
function normalize(e){
 if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).length!==FIELDS.length||
   !FIELDS.every(k=>Object.hasOwn(e,k)))throw Error('EVIDENCE_SCHEMA');
 const hex=/^[a-f0-9]{64}$/;
 if(e.protocol!==PROTOCOL||typeof e.orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(e.orderId)||
   typeof e.nonce!=='string'||!hex.test(e.nonce)||e.origin!==ORIGIN||
   !['notification','sms'].includes(e.sourceClass)||
   typeof e.sourceIdentity!=='string'||e.sourceIdentity.length>150||
   (e.sourceClass==='notification'&&!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(e.sourceIdentity))||
   (e.sourceClass==='sms'&&!/^[A-Za-z0-9-]{2,20}$/.test(e.sourceIdentity))||
   !(e.sourceCertificateSha256===null||
     (typeof e.sourceCertificateSha256==='string'&&hex.test(e.sourceCertificateSha256)))||
   (e.sourceClass==='notification'&&e.sourceCertificateSha256===null)||
   (e.sourceClass==='sms'&&e.sourceCertificateSha256!==null)||
   typeof e.eventId!=='string'||!/^[A-Za-z0-9_-]{12,120}$/.test(e.eventId)||
   typeof e.amountPaise!=='string'||!/^[1-9][0-9]{0,12}$/.test(e.amountPaise)||
   typeof e.payeeVpa!=='string'||!/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9._-]{2,40}$/.test(e.payeeVpa)||
   e.direction!=='DEBIT'||typeof e.reference!=='string'||!/^[A-Za-z0-9._:\/-]{6,100}$/.test(e.reference)||
   !Number.isSafeInteger(e.observedAt)||!Number.isSafeInteger(e.consentedAt))
   throw Error('EVIDENCE_SCHEMA');
 return JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,e[k]])));
}
function makeChallenge({orderId,amountPaise,payeeVpa,now=Date.now(),randomBytes=crypto.randomBytes}={}){
 if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(orderId)||
   typeof amountPaise!=='string'||!/^[1-9][0-9]{0,12}$/.test(amountPaise)||
   typeof payeeVpa!=='string'||!/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9._-]{2,40}$/.test(payeeVpa)||
   !Number.isSafeInteger(now)||now<=0)throw Error('CHALLENGE_FIELDS');
 const nonce=randomBytes(32).toString('hex');
 if(!/^[a-f0-9]{64}$/.test(nonce))throw Error('CHALLENGE_RANDOM');
 return Object.freeze({orderId,amountPaise,payeeVpa:payeeVpa.toLowerCase(),
  origin:ORIGIN,nonce,issuedAt:now,expiresAt:now+180000});
}
function verify({evidence,signature,trustedPublicKey,challenge,approvedSource,now=Date.now(),replayStore}){
 let bytes;
 try{bytes=normalize(evidence)}catch(_){return fail('EVIDENCE_SCHEMA')}
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{60,200}$/.test(signature)||
  !trustedPublicKey)return fail('SIGNATURE_INVALID');
 let valid=false;
 try{valid=crypto.verify('sha256',Buffer.from(bytes),trustedPublicKey,
  Buffer.from(signature,'base64url'))}catch(_){}
 if(!valid)return fail('SIGNATURE_INVALID');
 if(!challenge||!Number.isSafeInteger(challenge.issuedAt)||
  !Number.isSafeInteger(challenge.expiresAt)||
  challenge.expiresAt!==challenge.issuedAt+180000||
  now<challenge.issuedAt||now>=challenge.expiresAt)return fail('SESSION_EXPIRED');
 if(evidence.orderId!==challenge.orderId||evidence.nonce!==challenge.nonce||
  evidence.origin!==challenge.origin)return fail('SESSION_BINDING');
 if(evidence.amountPaise!==challenge.amountPaise)return fail('AMOUNT_MISMATCH');
 if(evidence.payeeVpa.toLowerCase()!==challenge.payeeVpa)return fail('PAYEE_MISMATCH');
 if(evidence.observedAt<challenge.issuedAt||evidence.observedAt>now||
  evidence.consentedAt<challenge.issuedAt||evidence.consentedAt>evidence.observedAt)
  return fail('TIME_INVALID');
 if(typeof approvedSource!=='function'||
  !approvedSource(evidence.sourceClass,evidence.sourceIdentity,evidence.sourceCertificateSha256))
  return fail('SOURCE_UNTRUSTED');
 if(!replayStore||typeof replayStore.claim!=='function')return fail('REPLAY_STORE_UNAVAILABLE');
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 // In production claim() must use a persistent atomic UNIQUE constraint.
 if(!replayStore.claim(evidence.sourceClass+':'+evidence.reference,digest))
  return fail('REPLAYED');
 return {ok:true,code:'DEVICE_OBSERVATION_AUTHENTICATED',
  evidenceClass:evidence.sourceClass==='notification'?'DECLARED_NOTIFICATION_SOURCE':'DECLARED_SMS_SOURCE',
  receiptId:digest,paymentVerified:false,debitVerified:false,paymentStateChanged:false};
}
module.exports={ORIGIN,PROTOCOL,normalize,makeChallenge,verify};
