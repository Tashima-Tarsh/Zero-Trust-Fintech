'use strict';
/**
 * User-consented Android SMS observation transport.
 * A device signature authenticates the reporting key, NOT the alleged bank sender,
 * SMS contents, payment settlement or a UTR. No production payment mutation.
 */
const crypto = require('node:crypto');
const fail = code => Object.assign(new Error(code), {code});
const KEYS = ['protocol','serviceRequestId','challenge','amountPaise','payeeVpa',
  'observedAt','source','smsDigest','utrCandidate'];
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{6,150}$/.test(v);
const hex = (v,n) => typeof v === 'string' && new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const eq = (a,b) => typeof a==='string' && typeof b==='string' &&
  a.length===b.length && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function canonicalSmsObservation(payload) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload) ||
      Object.keys(payload).length!==KEYS.length || !KEYS.every(k=>Object.hasOwn(payload,k)))
    throw fail('SMS_OBSERVATION_FIELDS_INVALID');
  const p=Object.fromEntries(KEYS.map(k=>[k,payload[k]]));
  if (p.protocol!=='DISHA-SMS-OBSERVATION-V1' || !id(p.serviceRequestId) ||
      !hex(p.challenge,64) || !/^[1-9][0-9]{0,15}$/.test(p.amountPaise) ||
      !/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(p.payeeVpa) ||
      !Number.isSafeInteger(p.observedAt) || p.observedAt<=0 ||
      p.source!=='ANDROID_SMS_USER_CONSENTED' || !hex(p.smsDigest,64) ||
      !(p.utrCandidate===null || /^[0-9]{12}$/.test(p.utrCandidate)))
    throw fail('SMS_OBSERVATION_FIELDS_INVALID');
  return JSON.stringify(p);
}
function verifySmsObservation(payload, signature, publicKey, bound, now=Date.now()) {
  const canonical=canonicalSmsObservation(payload);
  if (!bound || !eq(payload.serviceRequestId,bound.serviceRequestId) ||
      !eq(payload.challenge,bound.challenge) ||
      !eq(payload.amountPaise,bound.amountPaise) ||
      !eq(payload.payeeVpa,bound.payeeVpa))
    throw fail('SMS_OBSERVATION_BINDING_MISMATCH');
  if (!Number.isSafeInteger(bound.createdAt) || !Number.isSafeInteger(bound.expiresAt) ||
      now>=bound.expiresAt || payload.observedAt<bound.createdAt-30000 ||
      payload.observedAt>bound.expiresAt || payload.observedAt>now+30000)
    throw fail('SMS_OBSERVATION_EXPIRED');
  if (typeof signature!=='string' || !/^[A-Za-z0-9_-]{86}$/.test(signature))
    throw fail('SMS_OBSERVATION_SIGNATURE_INVALID');
  let key;
  try { key=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey); }
  catch (_) { throw fail('SMS_OBSERVATION_KEY_INVALID'); }
  const decoded=Buffer.from(signature,'base64url');
  if (key.asymmetricKeyType!=='ed25519'||decoded.length!==64||
      !crypto.verify(null,Buffer.from(canonical),key,decoded))
    throw fail('SMS_OBSERVATION_SIGNATURE_INVALID');
  const observationHash=crypto.createHash('sha256').update(canonical).digest('hex');
  // A valid signature proves only this registered device key sent this payload.
  return Object.freeze({observationHash,source:'ANDROID_SMS_USER_CONSENTED',
    evidenceState:'DEVICE_REPORTED_SMS_OBSERVATION',
    utrCandidate:payload.utrCandidate,
    deviceSignatureVerified:true,
    bankSenderAuthenticated:false,debitVerified:false,paymentVerified:false,
    paymentStateChanged:false});
}
module.exports={canonicalSmsObservation,verifySmsObservation};
