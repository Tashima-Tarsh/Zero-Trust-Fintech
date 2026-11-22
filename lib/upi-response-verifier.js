'use strict';
/* Authenticates supported UPI app return messages; never settles financial transactions.
 * Google Pay India web response spec: SHA256(tezResponse) hex UTF8, ECDSA SHA256, DER hex signature.
 * Provide trusted Google Pay keyId -> PEM mapping from a server-owned verified key source.
 */
const crypto=require('node:crypto');
const GOOGLE_METHOD='https://tez.google.com/pay';
const UNSUPPORTED=Object.freeze(['PHONEPE','PAYTM','BHIM','AMAZON_PAY','WHATSAPP_PAY','CRED','OTHER_UPI']);
const deny=(reason,provider='UNKNOWN')=>Object.freeze({provider,reason,signatureVerified:false,paymentVerified:false,debitVerified:false,settlementVerified:false});
function amountPaise(s){
 if(typeof s!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(s))return null;
 const [r,f='']=s.split('.');
 return Number(r)*100+Number(f.padEnd(2,'0'));
}
function verifyGooglePay(response,expected,keys,options={}){
 const provider='GOOGLE_PAY';
 if(response?.methodName!==GOOGLE_METHOD)return deny('WRONG_PAYMENT_METHOD',provider);
 if(!expected||!/^[\w.+-]+@[\w.-]+$/i.test(expected.pa||'')||
  typeof expected.amount!=='string'||amountPaise(expected.amount)===null||amountPaise(expected.amount)<=0||
  typeof expected.txnRef!=='string'||!expected.txnRef||expected.txnRef.length>128)return deny('INVALID_EXPECTED_TRANSACTION',provider);
 const d=response.details;
 if(!d||typeof d!=='object'||Array.isArray(d))return deny('MISSING_DETAILS',provider);
 if(typeof d.tezResponse!=='string'||!d.tezResponse||d.tezResponse.length>8192)return deny('MISSING_SIGNED_MESSAGE',provider);
 if(typeof d.signatureKeyId!=='string'||!/^[\w.-]{1,128}$/.test(d.signatureKeyId)||
  typeof d.signature!=='string'||!/^(?:[0-9a-f]{2}){8,512}$/.test(d.signature))return deny('INVALID_SIGNATURE_FORMAT',provider);
 if(!keys||typeof keys!=='object'||!Object.hasOwn(keys,d.signatureKeyId))return deny('UNKNOWN_SIGNING_KEY',provider);
 if(typeof keys[d.signatureKeyId]!=='string'||!keys[d.signatureKeyId].includes('BEGIN PUBLIC KEY'))return deny('INVALID_TRUSTED_KEY',provider);
 try{
  const key=crypto.createPublicKey(keys[d.signatureKeyId]);
  if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')return deny('UNSUPPORTED_SIGNING_KEY',provider);
  const hex=crypto.createHash('sha256').update(d.tezResponse,'utf8').digest('hex');
  if(!crypto.verify('sha256',Buffer.from(hex,'utf8'),key,Buffer.from(d.signature,'hex')))return deny('INVALID_SIGNATURE',provider);
 }catch(_){return deny('CRYPTOGRAPHIC_VERIFICATION_FAILED',provider)}
 let t;try{t=JSON.parse(d.tezResponse)}catch(_){return deny('INVALID_SIGNED_JSON',provider)}
 if(!t||typeof t!=='object'||Array.isArray(t))return deny('INVALID_SIGNED_JSON',provider);
 if(String(t.toVpa||'').toLowerCase()!==expected.pa.toLowerCase()||
  amountPaise(t.amount)!==amountPaise(expected.amount)||t.txnRef!==expected.txnRef||
  typeof t.txnId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(t.txnId))
  return Object.freeze({...deny('SIGNED_TRANSACTION_MISMATCH',provider),signatureVerified:true});
 if(typeof options.isReplay==='function'&&options.isReplay({provider,txnId:t.txnId,txnRef:t.txnRef}))
  return Object.freeze({...deny('REPLAY_DETECTED',provider),signatureVerified:true});
 const success=t.Status==='SUCCESS';
 return Object.freeze({provider,reason:success?'AUTHENTIC_APP_REPORTED_SUCCESS':'AUTHENTIC_APP_REPORTED_NON_SUCCESS',
  signatureVerified:true,providerReportedSuccess:success,providerReportedStatus:typeof t.Status==='string'?t.Status:'MISSING',
  paymentVerified:false,debitVerified:false,settlementVerified:false,txnId:t.txnId,txnRef:t.txnRef});
}
function verifyUPIResponse({provider,response,expected,trustedKeys,isReplay}={}){
 if(provider==='GOOGLE_PAY')return verifyGooglePay(response,expected,trustedKeys,{isReplay});
 return deny(UNSUPPORTED.includes(provider)?'PROVIDER_SIGNATURE_SCHEME_UNAVAILABLE':'UNKNOWN_PROVIDER',provider||'UNKNOWN');
}
module.exports=Object.freeze({GOOGLE_METHOD,UNSUPPORTED,amountPaise,verifyGooglePay,verifyUPIResponse});
