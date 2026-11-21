'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  ALLOWED_PACKAGES, canonicalEvidence, verifyDeviceEvidence, evaluateEvidence, aggregateSessionDecision
} = require('../financial/session-evidence');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const session = {
  order_id: 'ORDER_123456',
  nonce: 'a'.repeat(40),
  amount_paise: '100',
  payee_vpa: 'merchant@upi',
  consented_at: 100000,
  expires_at: 280000
};
const evidence = {
  protocol: 'DISHA-SESSION-EVIDENCE-V1',
  eventId: 'EVENT_123456',
  orderId: session.order_id,
  nonce: session.nonce,
  deviceId: 'DEVICE_123456',
  packageName: 'com.google.android.apps.nbu.paisa.user',
  postedAt: 150000,
  amountPaise: '100',
  payeeVpa: 'merchant@upi',
  transactionRef: 'UPI123456789',
  status: 'SUCCESS'
};
const bytes = canonicalEvidence(evidence);
const signature = crypto.sign('sha256', Buffer.from(bytes), privateKey).toString('base64url');

assert.equal(ALLOWED_PACKAGES.has(evidence.packageName), true);
assert.equal(verifyDeviceEvidence(evidence, signature, crypto.createPublicKey(publicKey)).length, 64);
assert.equal(evaluateEvidence(evidence, session, 160000).state, 'SIGNAL_MATCHED');

assert.throws(() => verifyDeviceEvidence(evidence, (signature.startsWith('AAAA') ? 'BBBB' : 'AAAA') + signature.slice(4), crypto.createPublicKey(publicKey)),
  /DEVICE_SIGNATURE_INVALID/);
assert.throws(() => canonicalEvidence({ ...evidence, packageName: 'com.example.fake' }), /EVIDENCE_FIELDS_INVALID/);
assert.throws(() => canonicalEvidence({ ...evidence, extra: 'unexpected' }), /EVIDENCE_FIELDS_INVALID/);
assert.equal(evaluateEvidence({ ...evidence, nonce: 'b'.repeat(40) }, session, 160000).state, 'CROSS_SESSION');
assert.equal(evaluateEvidence({ ...evidence, amountPaise: '101' }, session, 160000).state, 'AMOUNT_MISMATCH');
assert.equal(evaluateEvidence({ ...evidence, payeeVpa: 'attacker@upi' }, session, 160000).state, 'PAYEE_MISMATCH');
assert.equal(evaluateEvidence({ ...evidence, postedAt: 300000 }, session, 310000).state, 'SESSION_TIME_INVALID');
const observed = { ...evidence, protocol: 'DISHA-DEBIT-UTR-OBSERVATION-V1',
  referenceKind: 'UTR', transactionRef: '123456789012', postedAt: 150000 };
assert.equal(evaluateEvidence(observed, session, 160000).state, 'SIGNAL_MATCHED');
assert.equal(evaluateEvidence({ ...observed, postedAt: 160001 }, session, 160000).state,
  'SESSION_TIME_INVALID', 'Android observation cannot be future-dated even by one millisecond');
assert.equal(evaluateEvidence({ ...observed, postedAt: 99999 }, session, 160000).state,
  'SESSION_TIME_INVALID', 'Android observation must be after consent');
assert.equal(evaluateEvidence({ ...evidence, transactionRef: null }, session, 160000).state, 'INCOMPLETE_SIGNAL');
assert.equal(evaluateEvidence({ ...evidence, status: 'FAILED' }, session, 160000).state, 'PAYMENT_FAILED_SIGNAL');

assert.equal(aggregateSessionDecision([
  { device_id: 'DEVICE_A', transaction_ref: 'UPI123456789', decision_state: 'SIGNAL_MATCHED' },
  { device_id: 'DEVICE_B', transaction_ref: 'UPI123456789', decision_state: 'INCOMPLETE_SIGNAL' }
]), 'MULTI_DEVICE_CORROBORATED');
assert.equal(aggregateSessionDecision([
  { device_id: 'DEVICE_A', transaction_ref: 'UPI123456789', decision_state: 'SIGNAL_MATCHED' },
  { device_id: 'DEVICE_B', transaction_ref: 'UPI987654321', decision_state: 'SIGNAL_MATCHED' }
]), 'MULTIPLE_REFERENCE_CONFLICT');
assert.equal(aggregateSessionDecision([
  { device_id: 'DEVICE_A', transaction_ref: null, decision_state: 'AMOUNT_MISMATCH' }
]), 'FRAUD_REJECT');

console.log('PASS: session evidence signature, allowlist, binding, clock, amount, payee, replay and unified fraud decision tests');
