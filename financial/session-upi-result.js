'use strict';

const crypto = require('node:crypto');
const express = require('express');

const fail = (code, status = 422) => Object.assign(new Error(code), { code, status });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{6,150}$/.test(value);
const validDevice = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const validVpa = value => typeof value === 'string' && /^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i.test(value);
const validRef = value => value === null ||
  (typeof value === 'string' && /^[A-Za-z0-9._:/-]{6,100}$/.test(value));
const ALLOWED_PACKAGES = new Set([
  'com.google.android.apps.nbu.paisa.user',
  'com.phonepe.app',
  'net.one97.paytm',
  'in.org.npci.upiapp'
]);

function canonicalUpiResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('UPI_RESULT_FIELDS_INVALID');
  const keys = ['protocol','eventId','orderId','nonce','deviceId','packageName','returnedAt',
    'txnId','approvalRefNo','txnRef','responseCode','amountPaise','payeeVpa','status'];
  if (Object.keys(input).length !== keys.length || !keys.every(k => Object.hasOwn(input, k))) {
    throw fail('UPI_RESULT_FIELDS_INVALID');
  }
  const e = Object.fromEntries(keys.map(k => [k, input[k]]));
  if (e.protocol !== 'DISHA-UPI-RESULT-V1' ||
      !validId(e.eventId) || !validId(e.orderId) ||
      !/^[a-f0-9]{40}$/i.test(e.nonce || '') || !validDevice(e.deviceId) ||
      !ALLOWED_PACKAGES.has(e.packageName) ||
      !Number.isSafeInteger(e.returnedAt) || e.returnedAt <= 0 ||
      !validRef(e.txnId) || !validRef(e.approvalRefNo) || !validRef(e.txnRef) ||
      !(e.responseCode === null || (typeof e.responseCode === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(e.responseCode))) ||
      !(e.amountPaise === null || (typeof e.amountPaise === 'string' && /^[1-9][0-9]{0,15}$/.test(e.amountPaise))) ||
      !(e.payeeVpa === null || validVpa(e.payeeVpa)) ||
      !['SUCCESS','FAILED','PENDING','UNKNOWN'].includes(e.status)) {
    throw fail('UPI_RESULT_FIELDS_INVALID');
  }
  return JSON.stringify(e);
}

function verifyUpiResult(evidence, signature, publicKey) {
  const canonical = canonicalUpiResult(evidence);
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{80,200}$/.test(signature)) {
    throw fail('DEVICE_SIGNATURE_INVALID', 401);
  }
  let verified = false;
  try {
    verified = crypto.verify('sha256', Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64url'));
  } catch (_) {}
  if (!verified) throw fail('DEVICE_SIGNATURE_INVALID', 401);
  return sha256(canonical);
}

async function initializeSessionUpiResultSchema(pool) {
  if (!pool) throw fail('POSTGRES_REQUIRED', 503);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disha_session_upi_results (
      event_hash TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL REFERENCES disha_session_evidence_consents(order_id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      returned_at BIGINT NOT NULL,
      upi_txn_id TEXT,
      approval_ref_no TEXT,
      utr_candidate TEXT,
      merchant_txn_ref TEXT,
      response_code TEXT,
      amount_paise TEXT,
      payee_vpa TEXT,
      signal_status TEXT NOT NULL,
      decision_state TEXT NOT NULL
    );
    ALTER TABLE disha_session_upi_results ADD COLUMN IF NOT EXISTS utr_candidate TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS disha_session_upi_results_utr_unique
      ON disha_session_upi_results(utr_candidate) WHERE utr_candidate IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS disha_session_upi_results_txn_unique
      ON disha_session_upi_results(upi_txn_id) WHERE upi_txn_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS disha_session_upi_results_approval_unique
      ON disha_session_upi_results(approval_ref_no) WHERE approval_ref_no IS NOT NULL;
    CREATE INDEX IF NOT EXISTS disha_session_upi_results_order_time
      ON disha_session_upi_results(order_id, returned_at DESC);
    CREATE INDEX IF NOT EXISTS disha_session_upi_results_txn_id
      ON disha_session_upi_results(upi_txn_id) WHERE upi_txn_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS disha_session_upi_results_approval_ref
      ON disha_session_upi_results(approval_ref_no) WHERE approval_ref_no IS NOT NULL;
  `);
}

function createSessionUpiResultRouter({ getPool, getSession }) {
  const router = express.Router();
  const respondError = (res, err) => res.status(err.status || 500)
    .set('Cache-Control', 'no-store')
    .json({ success: false, error: err.status ? err.code : 'UPI_RESULT_UNAVAILABLE' });

  router.post('/', async (req, res) => {
    const body = req.body || {}, pool = getPool(), evidence = body.evidence;
    if (!pool) return respondError(res, fail('POSTGRES_REQUIRED', 503));
    const client = await pool.connect();
    let transaction = false;
    try {
      if (!evidence || !validId(evidence.orderId) || !validDevice(evidence.deviceId) ||
          typeof body.token !== 'string' || !/^[a-f0-9]{24,64}$/i.test(body.token)) {
        throw fail('UPI_RESULT_FIELDS_INVALID');
      }
      await client.query('BEGIN'); transaction = true;
      const consent = (await client.query(
        'SELECT * FROM disha_session_evidence_consents WHERE order_id=$1 FOR UPDATE',
        [evidence.orderId])).rows[0];
      if (!consent || consent.revoked_at || Date.now() >= Number(consent.expires_at)) {
        throw fail('SESSION_EXPIRED', 410);
      }
      if (!safeEqual(consent.nonce, evidence.nonce) ||
          !safeEqual(consent.token_hash, sha256(body.token))) throw fail('SESSION_BINDING_INVALID', 401);
      const session = await getSession(evidence.orderId);
      if (!session || session.status !== 'PENDING' || !safeEqual(session.sessionId, body.token)) {
        throw fail('SESSION_TOKEN_INVALID', 401);
      }
      const device = (await client.query(
        'SELECT public_key_pem FROM disha_session_evidence_devices WHERE order_id=$1 AND device_id=$2',
        [evidence.orderId, evidence.deviceId])).rows[0];
      if (!device) throw fail('DEVICE_NOT_ENROLLED', 403);
      const publicKey = crypto.createPublicKey(device.public_key_pem);
      const eventHash = verifyUpiResult(evidence, body.signature, publicKey);
      const now = Date.now();
      if (evidence.returnedAt < Number(consent.consented_at) - 30000 ||
          evidence.returnedAt > Number(consent.expires_at) ||
          evidence.returnedAt > now + 120000) throw fail('UPI_RESULT_TIME_INVALID', 409);

      let decisionState = 'UPI_RESULT_INCOMPLETE';
      if (evidence.amountPaise !== null && evidence.amountPaise !== consent.amount_paise) {
        decisionState = 'AMOUNT_MISMATCH';
      } else if (evidence.payeeVpa !== null &&
          evidence.payeeVpa.toLowerCase() !== consent.payee_vpa.toLowerCase()) {
        decisionState = 'PAYEE_MISMATCH';
      } else if (evidence.status === 'FAILED') {
        decisionState = 'UPI_PAYMENT_FAILED_RESPONSE';
      } else if (evidence.status === 'PENDING') {
        decisionState = 'UPI_PAYMENT_PENDING_RESPONSE';
      } else if (evidence.status === 'SUCCESS' &&
          (evidence.txnId || evidence.approvalRefNo) &&
          evidence.amountPaise !== null && evidence.payeeVpa !== null) {
        decisionState = 'UPI_RESPONSE_MATCHED';
      }

      const references = [evidence.txnId, evidence.approvalRefNo].filter(Boolean);
      for (const reference of references) {
        const prior = (await client.query(
          `SELECT order_id FROM disha_session_upi_results
           WHERE utr_candidate=$1 OR upi_txn_id=$1 OR approval_ref_no=$1
           LIMIT 1 FOR UPDATE`, [reference])).rows[0];
        const legacy = prior ? null : (await client.query(
          `SELECT order_id FROM disha_session_evidence_events
           WHERE transaction_ref=$1 LIMIT 1`, [reference])).rows[0];
        const duplicate = prior || legacy;
        if (duplicate) throw fail(
          duplicate.order_id === evidence.orderId ? 'UPI_RESULT_DUPLICATE' : 'TRANSACTION_REFERENCE_REPLAY', 409);
      }

      const count = Number((await client.query(
        'SELECT COUNT(*)::int AS count FROM disha_session_upi_results WHERE order_id=$1',
        [evidence.orderId])).rows[0].count);
      if (count >= 10) throw fail('SESSION_UPI_RESULT_LIMIT_REACHED', 429);

      await client.query(
        `INSERT INTO disha_session_upi_results
          (event_hash,event_id,order_id,device_id,package_name,returned_at,upi_txn_id,
           approval_ref_no,utr_candidate,merchant_txn_ref,response_code,amount_paise,payee_vpa,signal_status,decision_state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [eventHash,evidence.eventId,evidence.orderId,evidence.deviceId,evidence.packageName,
          evidence.returnedAt,evidence.txnId,evidence.approvalRefNo,evidence.txnId || evidence.approvalRefNo,
          evidence.txnRef,evidence.responseCode,evidence.amountPaise,evidence.payeeVpa,evidence.status,decisionState]);
      await client.query(
        'UPDATE disha_session_evidence_devices SET last_seen_at=$3 WHERE order_id=$1 AND device_id=$2',
        [evidence.orderId,evidence.deviceId,now]);
      await client.query('COMMIT'); transaction = false;
      const accepted = !['AMOUNT_MISMATCH','PAYEE_MISMATCH'].includes(decisionState);
      return res.status(202).set('Cache-Control','no-store').json({
        success:accepted, accepted, decisionState,
        ebit:{
          status:evidence.status,responseCode:evidence.responseCode,
          txnId:evidence.txnId,approvalRefNo:evidence.approvalRefNo,
          txnRef:evidence.txnRef,amountPaise:evidence.amountPaise,payeeVpa:evidence.payeeVpa
        },
        utrCandidate:evidence.txnId || evidence.approvalRefNo || null,
        paymentStateChanged:false
      });
    } catch (error) {
      if (transaction) await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return respondError(res, fail('UPI_RESULT_REPLAY_BLOCKED', 409));
      return respondError(res, error);
    } finally {
      client.release();
    }
  });
  return router;
}

module.exports = {
  ALLOWED_PACKAGES, canonicalUpiResult, verifyUpiResult,
  initializeSessionUpiResultSchema, createSessionUpiResultRouter
};
