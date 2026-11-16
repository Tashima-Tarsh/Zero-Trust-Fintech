const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.NODE_ENV = 'production';
process.env.DATA_DIR = fs.mkdtempSync(path.join(__dirname, 'identity-data-'));
const store = require('../disha-cinematic/identity-store');
const data = require('../disha-cinematic/db');
test('verified identities link once and cannot claim another subject merchant', () => {
  const first = store.resolve('user_original', 'merchant@example.com');
  assert.equal(store.find('user_original').id, first.id);
  assert.equal(store.resolve('user_imposter', 'merchant@example.com'), null);
  assert.equal(store.find('user_imposter'), null);
  assert.equal(store.resolve('user_original', 'changed@example.com').id, first.id);
  const other = store.resolve('user_other', 'other@example.com');
  assert.notEqual(other.id, first.id);
});
test.after(() => { data.db.close(); fs.rmSync(process.env.DATA_DIR, { recursive:true, force:true }); });
