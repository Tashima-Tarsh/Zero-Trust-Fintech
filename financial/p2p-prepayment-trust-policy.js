'use strict';
/* P2P prepayment trust policy. Never conflate a passkey assertion with device integrity.
 * No browser-supplied boolean is an attestation. An independent trusted verifier
 * must supply device verdicts; absence MUST remain UNKNOWN/blocked.
 */
const ALLOW='ALLOW',BLOCK='BLOCK';
const AUTH='PAYER_AUTHENTICATED',DEVICE='DEVICE_INTEGRITY_VERIFIED',DEBUG='DEBUGGER_RISK_VERIFIED';
function evaluatePrepaymentTrust(input={},clock=()=>Date.now()){
 const {orderId,sessionExpiresAt,auth={},device={}}=input;
 const reasons=[];
 if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(orderId)||
   !Number.isFinite(Number(sessionExpiresAt))||Number(sessionExpiresAt)<=clock())
  reasons.push('SESSION_INVALID_OR_EXPIRED');
 // Auth must have been proven server side by a verified registration or
 // authentication ceremony, with order binding and a fresh verification instant.
 if(auth.orderId!==orderId||auth.userVerified!==true||
   !Number.isFinite(auth.verifiedAt)||auth.verifiedAt>clock()||
   clock()-auth.verifiedAt>180000)
  reasons.push('PAYER_USER_VERIFICATION_REQUIRED');
 // device is a verified server-side attestation result. Do NOT accept arbitrary
 // JSON from browser in production as device evidence.
 if(device.trustSource!=='SERVER_VERIFIED_ATTESTATION'||device.orderId!==orderId||
   device.integrityVerdict!=='MEETS_DEVICE_INTEGRITY'||
   !Number.isFinite(device.verifiedAt)||device.verifiedAt>clock()||
   clock()-device.verifiedAt>180000)reasons.push('DEVICE_INTEGRITY_NOT_VERIFIED');
 if(device.trustSource!=='SERVER_VERIFIED_ATTESTATION'||
   device.debuggerRiskVerdict!=='NO_DEBUGGER_DETECTED')
  reasons.push('DEBUGGER_RISK_NOT_VERIFIED');
 return Object.freeze({decision:reasons.length?BLOCK:ALLOW,
  payerAuthenticated:!reasons.includes('PAYER_USER_VERIFICATION_REQUIRED'),
  deviceIntegrityVerified:!reasons.includes('DEVICE_INTEGRITY_NOT_VERIFIED'),
  debuggerRiskVerified:!reasons.includes('DEBUGGER_RISK_NOT_VERIFIED'),
  debitVerified:false,paymentVerified:false,
  reasons:Object.freeze(reasons)});
}
module.exports=Object.freeze({evaluatePrepaymentTrust,ALLOW,BLOCK,AUTH,DEVICE,DEBUG});
