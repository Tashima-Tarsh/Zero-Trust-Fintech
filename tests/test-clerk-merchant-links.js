'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'disha-clerk-test-'));
process.env.DATA_DIR = temp;
try {
  const { db } = require('../disha-cinematic/db');
  const { linkedMerchant, linkVerifiedMerchant } = require('../disha-cinematic/clerk-merchants');
  const first = linkVerifiedMerchant('user_secure_1', 'Owner@Test.Example');
  assert.equal(first.email, 'owner@test.example');
  assert.equal(linkVerifiedMerchant('user_secure_1', 'other@test.example').id, first.id);
  assert.equal(linkedMerchant('user_secure_1').id, first.id);
  assert.equal(linkVerifiedMerchant('user_secure_2', 'owner@test.example'), null, 'second Clerk identity cannot claim existing merchant');
  const second = linkVerifiedMerchant('user_secure_2', 'other@test.example');
  assert.notEqual(second.id, first.id);
  assert.equal(linkedMerchant('unrecognized_user'), null);
  db.close();
  console.log('Clerk merchant binding isolation: PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
