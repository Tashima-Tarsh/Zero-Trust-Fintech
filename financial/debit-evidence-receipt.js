'use strict';
/**
 * DISHA's own signature attests ONLY to receipt of an independently signed
 * provider claim. It does not attest to UPI settlement or bank ledger debit.
 */
const crypto = require('node:crypto');
const ORDER = ['protocol','serviceRequestId','issuerId','utrCandidate','sourceReceiptSha256',
  'claimReceivedAt','evidenceState','paymentVerified','debitVerified'];
const STATE = 'ISSUER_SIGNED_DEBIT_CLAIM_UNVERIFIED';
function canonicalAcknowledgement(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) ||
      Object.keys(fields).length !== ORDER.length || !ORDER.every(k => Object.hasOwn(fields,k))) {
    throw Error('DEBIT_EVIDENCE_ACK_FIELDS_INVALID');
  }
  const a=Object.fromEntries(ORDER.map(k=>[k,fields[k]]));
  if (a.protocol !== 'DISHA-DEBIT-EVIDENCE-ACK-V1' ||
      !/^[A-Za-z0-9_-]{6,150}$/.test(a.serviceRequestId) ||
      !/^[A-Za-z0-9._-]{3,64}$/.test(a.issuerId) ||
      !/^[0-9]{12}$/.test(a.utrCandidate) ||
      !/^[a-f0-9]{64}$/.test(a.sourceReceiptSha256) ||
      !Number.isSafeInteger(a.claimReceivedAt) || a.claimReceivedAt <= 0 ||
      a.evidenceState !== STATE || a.paymentVerified !== false || a.debitVerified !== false) {
    throw Error('DEBIT_EVIDENCE_ACK_FIELDS_INVALID');
  }
  return JSON.stringify(a);
}
function createEvidenceAcknowledgement(serviceRequestId, row, privateKeyDerBase64) {
  if (typeof privateKeyDerBase64 !== 'string' || !privateKeyDerBase64) {
    throw Error('DISHA_EVIDENCE_SIGNING_NOT_CONFIGURED');
  }
  const acknowledgement={
    protocol:'DISHA-DEBIT-EVIDENCE-ACK-V1',
    serviceRequestId,
    issuerId:row.issuer_id,
    utrCandidate:row.utr,
    sourceReceiptSha256:row.receipt_hash,
    claimReceivedAt:Number(row.received_at),
    evidenceState:STATE,
    paymentVerified:false,
    debitVerified:false
  };
  const message=canonicalAcknowledgement(acknowledgement);
  const key=crypto.createPrivateKey({
    key:Buffer.from(privateKeyDerBase64,'base64'),format:'der',type:'pkcs8'
  });
  if (key.asymmetricKeyType !== 'ed25519') throw Error('DISHA_EVIDENCE_KEY_INVALID');
  return {acknowledgement,signature:crypto.sign(null,Buffer.from(message),key).toString('base64url'),
    signatureAlgorithm:'Ed25519'};
}
function verifyEvidenceAcknowledgement(signed, publicKeyDerBase64) {
  if (!signed || signed.signatureAlgorithm !== 'Ed25519' ||
      typeof signed.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signed.signature)) {
    return false;
  }
  try {
    const key=crypto.createPublicKey({
      key:Buffer.from(publicKeyDerBase64,'base64'),format:'der',type:'spki'
    });
    return key.asymmetricKeyType==='ed25519' &&
      crypto.verify(null,Buffer.from(canonicalAcknowledgement(signed.acknowledgement)),
        key,Buffer.from(signed.signature,'base64url'));
  } catch (_) { return false; }
}
module.exports={canonicalAcknowledgement,createEvidenceAcknowledgement,
  verifyEvidenceAcknowledgement};
