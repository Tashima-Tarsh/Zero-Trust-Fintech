'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { canonicalUpiResult, verifyUpiResult, ALLOWED_PACKAGES } =
  require('../financial/session-upi-result');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const evidence = {
  protocol: 'DISHA-UPI-RESULT-V1',
  eventId: 'EVENT_123456',
  orderId: 'ORDER_123456',
  nonce: 'a'.repeat(40),
  deviceId: 'DEVICE_123456',
  packageName: 'com.google.android.apps.nbu.paisa.user',
  returnedAt: 150000,
  txnId: '123456789012',
  approvalRefNo: '123456789013',
  txnRef: 'DISHA_ORDER_123',
  responseCode: '00',
  amountPaise: '100',
  payeeVpa: 'merchant@upi',
  status: 'SUCCESS'
};
const bytes = canonicalUpiResult(evidence);
const signature = crypto.sign('sha256', Buffer.from(bytes), privateKey).toString('base64url');

assert.equal(ALLOWED_PACKAGES.has(evidence.packageName), true);
assert.equal(verifyUpiResult(evidence, signature, crypto.createPublicKey(publicKey)).length, 64);
assert.throws(() => canonicalUpiResult({ ...evidence, unexpected: true }), /UPI_RESULT_FIELDS_INVALID/);
assert.throws(() => canonicalUpiResult({ ...evidence, packageName: 'com.fake.upi' }), /UPI_RESULT_FIELDS_INVALID/);
assert.throws(() => verifyUpiResult(evidence, 'invalid', crypto.createPublicKey(publicKey)), /DEVICE_SIGNATURE_INVALID/);
assert.equal(canonicalUpiResult({ ...evidence, txnId: null, approvalRefNo: null }).length > 0, true);
console.log('PASS: Android UPI result schema, app allowlist, exact canonical signature and malformed-field rejection');
