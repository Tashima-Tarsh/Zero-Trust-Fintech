#!/usr/bin/env node
'use strict';
/** Runs only against ephemeral localhost PostgreSQL in CI. Never production. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { postBalancedJournal, verifyJournal } = require('../financial/postgres-ledger');

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing to run integration test on non-local database');
  }
  const pool = new Pool({ connectionString: url, max: 8 });
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const merchantId = 'test_' + suffix;
  const debitAccountId = 'test_debit_' + suffix;
  const creditAccountId = 'test_credit_' + suffix;
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_financial_core.sql'), 'utf8'));
    await pool.query(
      'INSERT INTO disha_core_accounts (account_id, merchant_id, account_type) ' +
      'VALUES ($1, $3, $4), ($2, $3, $5)',
      [debitAccountId, creditAccountId, merchantId, 'ASSET', 'REVENUE']
    );
    const base = {
      merchantId,
      orderId: 'order_' + suffix,
      utr: 'utr_' + suffix,
      idempotencyKey: 'idem_' + suffix,
      amountRupees: '500.01',
      debitAccountId, creditAccountId
    };
    const first = await postBalancedJournal(pool, base);
    assert.equal(first.replayed, false);
    assert.equal(first.amountPaise, '50001');
    const verified = await verifyJournal(pool, first.journalId);
    assert.equal(verified?.balanced, true, JSON.stringify(verified));
    assert.equal(verified.debits, '50001');
    assert.equal(verified.credits, '50001');
    assert.equal(verified.entryCount, 2);

    const again = await postBalancedJournal(pool, base);
    assert.equal(again.replayed, true);
    assert.equal(again.journalId, first.journalId);
    await assert.rejects(postBalancedJournal(pool, { ...base, amountRupees: '500.02' }), /IDEMPOTENCY_KEY_CONFLICT/);

    await assert.rejects(postBalancedJournal(pool, {
      ...base, idempotencyKey: 'other_idem_' + suffix, orderId: 'other_order_' + suffix
    }), /DUPLICATE_UTR_OR_ORDER/);
    await assert.rejects(postBalancedJournal(pool, {
      ...base, idempotencyKey: 'another_idem_' + suffix, utr: 'other_utr_' + suffix
    }), /DUPLICATE_UTR_OR_ORDER/);

    // Two concurrent workers racing for the same UTR: exactly one may post.
    const race = await Promise.allSettled([1, 2].map(i => postBalancedJournal(pool, {
      ...base, orderId: 'race_order_' + i + '_' + suffix,
      utr: 'race_utr_' + suffix,
      idempotencyKey: 'race_idem_' + i + '_' + suffix
    })));
    assert.equal(race.filter(x => x.status === 'fulfilled').length, 1, 'Only one racing worker may post');
    assert.equal(race.filter(x => x.status === 'rejected').length, 1, 'Competing worker must not post');

    // PostgreSQL must abort an unbalanced journal at COMMIT.
    const client = await pool.connect();
    const badJournalId = 'unbalanced_' + suffix;
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO disha_core_journals (journal_id, merchant_id, order_id, utr, idempotency_key, amount_paise) ' +
        'VALUES ($1, $2, $3, $4, $5, $6)',
        [badJournalId, merchantId, 'bad_order_' + suffix, 'bad_utr_' + suffix,
          'bad_idem_' + suffix, '50001']
      );
      await client.query(
        'INSERT INTO disha_core_postings (journal_id, merchant_id, account_id, side, amount_paise) ' +
        "VALUES ($1, $2, $3, 'DEBIT', $4)",
        [badJournalId, merchantId, debitAccountId, '50001']
      );
      await client.query(
        "UPDATE disha_core_journals SET state = 'POSTED', posted_at = now() WHERE journal_id = $1",
        [badJournalId]
      );
      await assert.rejects(client.query('COMMIT'), err => err.code === '23514');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const absent = await pool.query('SELECT 1 FROM disha_core_journals WHERE journal_id = $1', [badJournalId]);
    assert.equal(absent.rowCount, 0, 'Failed COMMIT must leave no partial journal');

    // Posted entries cannot be modified retroactively.
    await assert.rejects(pool.query(
      'UPDATE disha_core_journals SET amount_paise = 2 WHERE journal_id = $1',
      [first.journalId]
    ), err => err.code === '23514');
    await assert.rejects(pool.query(
      'UPDATE disha_core_postings SET amount_paise = 2 WHERE journal_id = $1',
      [first.journalId]
    ), err => err.code === '23514');

    // Accounts may not be borrowed from a different merchant.
    await assert.rejects(postBalancedJournal(pool, {
      ...base, merchantId: 'different_merchant_' + suffix,
      orderId: 'wrong_merchant_order_' + suffix,
      utr: 'wrong_merchant_utr_' + suffix,
      idempotencyKey: 'wrong_merchant_idem_' + suffix
    }), err => err.code === '23503');

    console.log('PostgreSQL invariants PASS: balanced-only commits, replay safety,');
    console.log('unique UTR/order, concurrent race, immutable postings, merchant segregation.');
  } finally {
    await pool.end();
  }
}
main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
