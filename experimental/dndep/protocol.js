'use strict';
/**
 * D-NDEP v0 experimental wire protocol.
 * Platform-side collector is NOT shipped: this validates an authenticated
 * platform assertion only; no debit/settlement verification is claimed.
 */
const crypto = require('node:crypto');
const ORIGIN = 'https://disha8-2.thenitishkr.in';
const PROTOCOL = 'DISHA-NDEP-OBSERVATION-V0';
const CHALLENGE = 'DISHA-NDEP-CHALLENGE-V0';
const WINDOW_MS = 180000;
const challengeKeys = ['protocol','origin','orderId','amountPaise','payeeVpa','nonce','issuedAt','expiresAt'];
const assertionKeys = ['protocol','challengeDigest','eventId','sourceKind','sourceId','sourceSignerSha256',
  'observedAt','consentedAt','amountPaise','payeeVpa','reference','direction','observerKeyId'];
const hex64 = /^[0-9a-f]{64}$/;
const orderRe = /^[A-Za-z0-9_-]{6,150}$/;
const vpaRe = /^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/;
const amountRe = /^[1-9][0-9]{0,12}$/;
const refRe = /^[A-Za-z0-9._:/-]{6,100}$/;
const failed = code => Object.freeze({ok:false,code,paymentVerified:false,debitVerified:false,ledgerMutated:false});
function strictJson(obj,keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
    Object.keys(obj).length !== keys.length || !keys.every(key => Object.hasOwn(obj,key))) throw Error('SCHEMA');
  return JSON.stringify(Object.fromEntries(keys.map(key => [key,obj[key]])));
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sig = (bytes,key) => crypto.sign('sha256',Buffer.from(bytes),key).toString('base64url');
function validSignature(bytes,signature,key) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{60,200}$/.test(signature) || !key) return false;
  try { return crypto.verify('sha256',Buffer.from(bytes),key,Buffer.from(signature,'base64url')); }
  catch (_) { return false; }
}
function validChallenge(c) {
  strictJson(c,challengeKeys);
  return c.protocol===CHALLENGE && c.origin===ORIGIN && orderRe.test(c.orderId) &&
    amountRe.test(c.amountPaise) && vpaRe.test(c.payeeVpa) &&
    hex64.test(c.nonce) && Number.isSafeInteger(c.issuedAt) && c.issuedAt>0 &&
    Number.isSafeInteger(c.expiresAt) && c.expiresAt-c.issuedAt===WINDOW_MS;
}
function createChallenge({orderId,amountPaise,payeeVpa,serverPrivateKey,now=Date.now(),randomBytes=crypto.randomBytes}) {
  const challenge={protocol:CHALLENGE,origin:ORIGIN,orderId,amountPaise,
    payeeVpa:typeof payeeVpa==='string'?payeeVpa.toLowerCase():payeeVpa,
    nonce:randomBytes(32).toString('hex'),issuedAt:now,expiresAt:now+WINDOW_MS};
  if (!validChallenge(challenge)) throw Error('CHALLENGE_INVALID');
  if (!serverPrivateKey) throw Error('SERVER_KEY_REQUIRED');
  return {challenge,serverSignature:sig(strictJson(challenge,challengeKeys),serverPrivateKey)};
}
function validAssertion(e) {
  strictJson(e,assertionKeys);
  return e.protocol===PROTOCOL && hex64.test(e.challengeDigest) &&
    typeof e.eventId==='string' && /^[A-Za-z0-9_-]{12,120}$/.test(e.eventId) &&
    ['notification','sms'].includes(e.sourceKind) &&
    typeof e.sourceId==='string' && e.sourceId.length>=2 && e.sourceId.length<=150 &&
    (e.sourceKind==='notification' ? /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(e.sourceId) :
      /^[A-Za-z0-9-]{2,20}$/.test(e.sourceId)) &&
    (e.sourceKind==='sms' ? e.sourceSignerSha256===null : typeof e.sourceSignerSha256==='string' && hex64.test(e.sourceSignerSha256)) &&
    Number.isSafeInteger(e.observedAt) && Number.isSafeInteger(e.consentedAt) &&
    amountRe.test(e.amountPaise) && vpaRe.test(e.payeeVpa) && refRe.test(e.reference) &&
    e.direction==='DEBIT' && typeof e.observerKeyId==='string' && /^[A-Za-z0-9_-]{8,100}$/.test(e.observerKeyId);
}
/**
 * Trust anchor injected by host, independent from a user-submitted observer key.
 * resolveObserver(keyId) => {publicKey,platformAuthorized,sourceVerifier}
 * sourceVerifier(e) must independently verify claimed package/cert/SMS provenance.
 * claimUniqueReference(eventKey,receiptHash) must be ATOMIC and PERSISTENT in prod.
 */
function verify({challenge,serverSignature,serverPublicKey,assertion,observerSignature,
  resolveObserver,claimUniqueReference,now=Date.now()}) {
  let challengeBytes,assertionBytes;
  try {
    if (!validChallenge(challenge) || !validAssertion(assertion)) return failed('SCHEMA');
    challengeBytes=strictJson(challenge,challengeKeys);
    assertionBytes=strictJson(assertion,assertionKeys);
  } catch (_) { return failed('SCHEMA'); }
  if (!validSignature(challengeBytes,serverSignature,serverPublicKey)) return failed('CHALLENGE_SIGNATURE_INVALID');
  if (typeof resolveObserver!=='function') return failed('OBSERVER_TRUST_UNAVAILABLE');
  let observer;
  try { observer=resolveObserver(assertion.observerKeyId); } catch (_) { return failed('OBSERVER_TRUST_UNAVAILABLE'); }
  if (!observer || observer.platformAuthorized!==true ||
    !validSignature(assertionBytes,observerSignature,observer.publicKey)) return failed('OBSERVER_UNTRUSTED');
  if (now<challenge.issuedAt || now>=challenge.expiresAt) return failed('SESSION_EXPIRED');
  if (assertion.challengeDigest!==digest(challengeBytes)) return failed('SESSION_BINDING');
  if (assertion.amountPaise!==challenge.amountPaise) return failed('AMOUNT_MISMATCH');
  if (assertion.payeeVpa!==challenge.payeeVpa) return failed('PAYEE_MISMATCH');
  if (assertion.consentedAt<challenge.issuedAt || assertion.consentedAt>assertion.observedAt ||
    assertion.observedAt>now || assertion.observedAt>=challenge.expiresAt) return failed('CONSENT_OR_EVENT_TIME');
  if (typeof observer.sourceVerifier!=='function') return failed('PROVENANCE_UNAVAILABLE');
  let sourceOk=false;
  try { sourceOk=observer.sourceVerifier(assertion)===true; } catch (_) {}
  if (!sourceOk) return failed('SOURCE_UNTRUSTED');
  if (typeof claimUniqueReference!=='function') return failed('REPLAY_STORE_UNAVAILABLE');
  const receiptHash=digest(assertionBytes);
  // Production implementation must claim (source-kind, reference) and event ID
  // within a single database transaction under unique constraints.
  let claimed=false;
  try {
    claimed=claimUniqueReference(assertion.sourceKind+':'+assertion.reference,
      assertion.eventId,receiptHash)===true;
  } catch (_) { return failed('REPLAY_STORE_UNAVAILABLE'); }
  if (!claimed) return failed('REPLAYED');
  return Object.freeze({ok:true,code:'DEBIT_EVIDENCE_OBSERVED',
    provenance:'PLATFORM_ATTESTED_BY_EXTERNAL_TRUST_RESOLVER',
    receiptHash,sourceKind:assertion.sourceKind,
    paymentVerified:false,debitVerified:false,ledgerMutated:false});
}
module.exports={ORIGIN,PROTOCOL,CHALLENGE,WINDOW_MS,createChallenge,verify,
  canonicalChallenge:c=>strictJson(c,challengeKeys),
  canonicalAssertion:e=>strictJson(e,assertionKeys),digest,sig};
