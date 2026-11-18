'use strict';
const crypto = require('node:crypto');
const { rupeesToPaise } = require('./money');

const TRANSIENT_ERRORS = new Set(['40001', '40P01']);
const sleep = (delay) => new Promise(resolve => setTimeout(resolve, delay));

function nonEmpty(value, name, limit = 128) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > limit) {
    throw new TypeError(name + ' must be a nonempty bounded string');
  }
  return value;
}

/**
 * Posts two balanced entries atomically in one SERIALIZABLE PostgreSQL txn.
 * This establishes a trustworthy internal accounting invariant; it is NOT
 * independent cryptographic proof that an interbank payment has completed.
 *
 * Call only after your application has independently authorized this event.
 * Do not wire this method directly to an unauthenticated browser endpoint.
 */
async function postBalancedJournal(pool, input, maxRetries = 3) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required');
  }
  const merchantId = nonEmpty(input.merchantId, 'merchantId');
  const orderId = nonEmpty(input.orderId, 'orderId');
  const utr = nonEmpty(input.utr, 'utr');
  const idempotencyKey = nonEmpty(input.idempotencyKey, 'idempotencyKey');
  const debitAccountId = nonEmpty(input.debitAccountId, 'debitAccountId');
  const creditAccountId = nonEmpty(input.creditAccountId, 'creditAccountId');
  if (debitAccountId === creditAccountId) {
    throw new TypeError('Debit and credit accounts must differ');
  }
  const amountPaise = rupeesToPaise(input.amountRupees);
  const journalId = crypto.randomUUID();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      begun = true;
      const inserted = await client.query(
        'INSERT INTO disha_core_journals ' +
        '(journal_id, merchant_id, order_id, utr, idempotency_key, amount_paise) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) ' +
        'ON CONFLICT (idempotency_key) DO NOTHING RETURNING journal_id',
        [journalId, merchantId, orderId, utr, idempotencyKey, amountPaise]
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query(
          'SELECT journal_id, merchant_id, order_id, utr, amount_paise, state ' +
          'FROM disha_core_journals WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        const row = existing.rows[0];
        if (!row || row.merchant_id !== merchantId || row.order_id !== orderId ||
            row.utr !== utr || String(row.amount_paise) !== amountPaise ||
            row.state !== 'POSTED') {
          throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        }
        await client.query('COMMIT');
        begun = false;
        return { journalId: row.journal_id, amountPaise, replayed: true };
      }

      await client.query(
        'INSERT INTO disha_core_postings ' +
        '(journal_id, merchant_id, account_id, side, amount_paise) ' +
        'VALUES ($1, $2, $3, $4, $5), ($1, $2, $6, $7, $5)',
        [journalId, merchantId, debitAccountId, 'DEBIT', amountPaise,
          creditAccountId, 'CREDIT']
      );
      await client.query(
        "UPDATE disha_core_journals SET state = 'POSTED', posted_at = now() " +
        'WHERE journal_id = $1',
        [journalId]
      );
      // The deferred DB constraint trigger enforces exact balance at COMMIT.
      await client.query('COMMIT');
      begun = false;
      return { journalId, amountPaise, replayed: false };
    } catch (err) {
      if (begun) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      if (TRANSIENT_ERRORS.has(err.code) && attempt < maxRetries) {
        // Serializable transactions can abort under contention: retry whole txn.
        await sleep(10 * (attempt + 1));
        continue;
      }
      if (err.code === '23505') {
        const conflict = new Error('DUPLICATE_UTR_OR_ORDER');
        conflict.cause = err;
        throw conflict;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  throw new Error('TRANSACTION_RETRIES_EXHAUSTED');
}

async function verifyJournal(pool, journalId) {
  nonEmpty(journalId, 'journalId');
  const result = await pool.query(
    'SELECT j.journal_id, j.state, j.amount_paise, ' +
    'COUNT(p.posting_id)::integer AS entry_count, ' +
    "COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'DEBIT'), 0) AS debits, " +
    "COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'CREDIT'), 0) AS credits " +
    'FROM disha_core_journals j LEFT JOIN disha_core_postings p ON p.journal_id = j.journal_id ' +
    'WHERE j.journal_id = $1 GROUP BY j.journal_id, j.state, j.amount_paise',
    [journalId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    journalId: row.journal_id,
    state: row.state,
    amountPaise: String(row.amount_paise),
    debits: String(row.debits),
    credits: String(row.credits),
    entryCount: Number(row.entry_count),
    balanced: row.state === 'POSTED' && Number(row.entry_count) === 2 &&
      BigInt(row.debits) === BigInt(row.credits) &&
      BigInt(row.debits) === BigInt(row.amount_paise)
  };
}

module.exports = { postBalancedJournal, verifyJournal };
