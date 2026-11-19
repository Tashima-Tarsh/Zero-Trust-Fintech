'use strict';
// Regression: a deployed Railway PostgreSQL schema can predate upi_uri.
// Exercise the exact bootstrap function on an isolated legacy table, twice,
// without importing, deleting or changing pre-existing financial records.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {ensureCheckoutSessionSchema} = require('../financial/checkout-schema');

(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','::1'].includes(new URL(url).hostname)) {
    throw Error('This regression must use disposable local CI PostgreSQL only');
  }
  const pool = new Pool({connectionString:url});
  const client = await pool.connect();
  const schema = 'checkout_legacy_' + crypto.randomBytes(6).toString('hex');
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await client.query('CREATE SCHEMA ' + schema);
    await client.query('SET LOCAL search_path TO ' + schema);
    await client.query(
      'CREATE TABLE sessions (' +
      'session_id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL,' +
      'challenge_amount NUMERIC(10,2), status TEXT NOT NULL,' +
      'created_at BIGINT NOT NULL)'
    );
    await client.query(
      "INSERT INTO sessions (session_id,order_id,challenge_amount,status,created_at) " +
      "VALUES ('old-session','old-order',499.01,'PENDING',123456789)"
    );
    await ensureCheckoutSessionSchema(client);
    await ensureCheckoutSessionSchema(client); // idempotent
    const row = (await client.query("SELECT * FROM sessions WHERE order_id='old-order'")).rows[0];
    assert.equal(row.challenge_amount,'499.01');
    assert.equal(row.status,'PENDING');
    assert.equal(row.created_at,'123456789');
    assert.equal(row.upi_uri,null,'Do not fabricate old QR bytes');
    assert.equal(row.customer_id,null,'Do not rewrite old sessions');
    assert.equal(row.state,'WAITING','New default must be safe');
    await client.query(
      "INSERT INTO sessions(session_id,order_id,challenge_amount,status,created_at,upi_uri) " +
      "VALUES ('new-session','new-order',1.00,'PENDING',123456790,'upi://pay?pa=test@upi&am=1.00&cu=INR')"
    );
    assert.match((await client.query("SELECT upi_uri FROM sessions WHERE order_id='new-order'")).rows[0].upi_uri,/^upi:\/\/pay\?/);
    console.log('POSTGRES_CHECKOUT_BOOTSTRAP_PASS: legacy data preserved, missing column repaired, new checkout URI persisted');
  } finally {
    if (inTransaction) try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    await pool.end();
  }
})().catch(err => {console.error(err);process.exitCode=1;});
