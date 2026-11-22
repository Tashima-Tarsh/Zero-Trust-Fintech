'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isIndependentlyPinnedObserverKey } = require('../financial/session-evidence');

const a = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const b = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const digest = key => crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
const approved = digest(a.publicKey);
const other = digest(b.publicKey);
const original = process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
try {
  delete process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
  assert.equal(isIndependentlyPinnedObserverKey(a.publicKey), false, 'default must deny');
  process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 = 'not-a-digest';
  assert.equal(isIndependentlyPinnedObserverKey(a.publicKey), false, 'invalid pin must deny');
  process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 = other;
  assert.equal(isIndependentlyPinnedObserverKey(a.publicKey), false, 'unapproved enrollment must deny');
  process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 = '  ' + other + ' , ' + approved.toUpperCase() + ' ';
  assert.equal(isIndependentlyPinnedObserverKey(a.publicKey), true, 'admin pin list must accept matching key');
  assert.equal(isIndependentlyPinnedObserverKey(a.publicKey.export({type:'spki',format:'pem'})), true, 'PEM and KeyObject must agree');
  assert.equal(isIndependentlyPinnedObserverKey(b.publicKey), true, 'second admin-approved key accepted');
  assert.equal(isIndependentlyPinnedObserverKey('not a key'), false, 'malformed key must deny');
  process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 = approved;
  assert.equal(isIndependentlyPinnedObserverKey(b.publicKey), false, 'other key must not inherit trust');
  console.log('PASS: fail-closed independently pinned platform-observer key enrollment checks');
} finally {
  if (original === undefined) delete process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
  else process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 = original;
}
