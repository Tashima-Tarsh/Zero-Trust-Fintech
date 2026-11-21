'use strict';

/**
 * DISHA session-bound multi-device evidence channel.
 * Device signatures authenticate the enrolled device's submission.
 * This module never changes checkout/ledger status.
 */
const crypto = require('node:crypto');
const express = require('express');
const { rupeesToPaise } = require('./money');

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
const ALLOWED_PACKAGES = new Set([
  'com.google.android.apps.nbu.paisa.user',
  'com.phonepe.app',
  'net.one97.paytm',
  'in.org.npci.upiapp'
]);

function canonicalEvidence(input, allowedPackages = ALLOWED_PACKAGES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('EVIDENCE_FIELDS_INVALID');
  const keys = ['protocol','eventId','orderId','nonce','deviceId','packageName','postedAt',
    'amountPaise','payeeVpa','transactionRef','status'];
  if (Object.keys(input).length !== keys.length || !keys.every(k => Object.hasOwn(input, k))) {
    throw fail('EVIDENCE_FIELDS_INVALID');
  }
  const e = Object.fromEntries(keys.map(k => [k, input[k]]));
  if (e.protocol !== 'DISHA-SESSION-EVIDENCE-V1' ||
      !validId(e.eventId) || !validId(e.orderId) || !/^[a-f0-9]{40}$/i.test(e.nonce) ||
      !validDevice(e.deviceId) || !allowedPackages.has(e.packageName) ||
      !Number.isSafeInteger(e.postedAt) || e.postedAt <= 0 ||
      !(e.amountPaise === null || (typeof e.amountPaise === 'string' && /^[1-9][0-9]{0,15}$/.test(e.amountPaise))) ||
      !(e.payeeVpa === null || validVpa(e.payeeVpa)) ||
      !(e.transactionRef === null || (typeof e.transactionRef === 'string' && /^[A-Za-z0-9._:/-]{6,100}$/.test(e.transactionRef))) ||
      !['SUCCESS','FAILED','PENDING','UNKNOWN'].includes(e.status)) {
    throw fail('EVIDENCE_FIELDS_INVALID');
  }
  return JSON.stringify(e);
}

function verifyDeviceEvidence(evidence, signature, publicKey, allowedPackages = ALLOWED_PACKAGES) {
  const bytes = canonicalEvidence(evidence, allowedPackages);
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{80,200}$/.test(signature)) {
    throw fail('DEVICE_SIGNATURE_INVALID', 401);
  }
  let ok = false;
  try {
    ok = crypto.verify('sha256', Buffer.from(bytes), publicKey, Buffer.from(signature, 'base64url'));
  } catch (_) {}
  if (!ok) throw fail('DEVICE_SIGNATURE_INVALID', 401);
  return sha256(bytes);
}

function evaluateEvidence(e, session, now = Date.now()) {
  const expiry = Number(session.expires_at);
  const consentedAt = Number(session.consented_at);
  if (e.orderId !== session.order_id || e.nonce !== session.nonce) return { state: 'CROSS_SESSION', accepted: false };
  if (now >= expiry || e.postedAt > expiry || e.postedAt < consentedAt - 30000 || e.postedAt > now + 120000) {
    return { state: 'SESSION_TIME_INVALID', accepted: false };
  }
  const amountMatches = e.amountPaise !== null && e.amountPaise === session.amount_paise;
  const payeeMatches = e.payeeVpa !== null && e.payeeVpa.toLowerCase() === session.payee_vpa.toLowerCase();
  if (e.amountPaise !== null && !amountMatches) return { state: 'AMOUNT_MISMATCH', accepted: false };
  if (e.payeeVpa !== null && !payeeMatches) return { state: 'PAYEE_MISMATCH', accepted: false };
  if (e.status !== 'SUCCESS') return { state: e.status === 'FAILED' ? 'PAYMENT_FAILED_SIGNAL' : 'INCOMPLETE_SIGNAL', accepted: true };
  if (!amountMatches || !payeeMatches || !e.transactionRef) return { state: 'INCOMPLETE_SIGNAL', accepted: true };
  return { state: 'SIGNAL_MATCHED', accepted: true };
}

function aggregateSessionDecision(rows) {
  const states = rows.map(r => r.decision_state);
  const refs = new Set(rows.map(r => r.transaction_ref).filter(Boolean));
  const devices = new Set(rows.map(r => r.device_id).filter(Boolean));
  const fraudStates = new Set(['CROSS_SESSION','SESSION_TIME_INVALID','AMOUNT_MISMATCH',
    'PAYEE_MISMATCH','TRANSACTION_REFERENCE_REPLAY','CROSS_DEVICE_SIGNAL_CONFLICT']);
  if (states.some(s => fraudStates.has(s))) return 'FRAUD_REJECT';
  if (refs.size > 1) return 'MULTIPLE_REFERENCE_CONFLICT';
  if (states.includes('SIGNAL_MATCHED') && devices.size > 1 && refs.size === 1) return 'MULTI_DEVICE_CORROBORATED';
  if (states.includes('SIGNAL_MATCHED')) return 'SIGNAL_MATCHED';
  if (states.includes('PAYMENT_FAILED_SIGNAL')) return 'PAYMENT_FAILED_SIGNAL';
  return 'INCOMPLETE_SIGNAL';
}

async function initializeSessionEvidenceSchema(pool) {
  if (!pool) throw fail('POSTGRES_REQUIRED', 503);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disha_session_evidence_consents (
      order_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      nonce TEXT NOT NULL,
      amount_paise TEXT NOT NULL,
      payee_vpa TEXT NOT NULL,
      payment_type TEXT NOT NULL,
      consented_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      revoked_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS disha_session_evidence_devices (
      order_id TEXT NOT NULL REFERENCES disha_session_evidence_consents(order_id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      public_key_pem TEXT NOT NULL,
      enrolled_at BIGINT NOT NULL,
      last_seen_at BIGINT,
      PRIMARY KEY(order_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS disha_session_evidence_events (
      event_hash TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL REFERENCES disha_session_evidence_consents(order_id),
      device_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      posted_at BIGINT NOT NULL,
      received_at BIGINT NOT NULL,
      amount_paise TEXT,
      payee_vpa TEXT,
      transaction_ref TEXT,
      signal_status TEXT NOT NULL,
      decision_state TEXT NOT NULL
    );
    DROP INDEX IF EXISTS disha_session_evidence_txn_replay;
    CREATE INDEX IF NOT EXISTS disha_session_evidence_txn_lookup
      ON disha_session_evidence_events(transaction_ref)
      WHERE transaction_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS disha_session_evidence_order_time
      ON disha_session_evidence_events(order_id, posted_at DESC);
  `);
}

function createSessionEvidenceRouter({ getPool, getSession, allowedPackages = ALLOWED_PACKAGES }) {
  const router = express.Router();
  const respondError = (res, err) => res.status(err.status || 500)
    .set('Cache-Control', 'no-store')
    .json({ success: false, error: err.status ? err.code : 'SESSION_EVIDENCE_UNAVAILABLE' });

  router.post('/authorize', async (req, res) => {
    const b = req.body || {}, pool = getPool();
    if (!pool) return respondError(res, fail('POSTGRES_REQUIRED', 503));
    if (b.consent !== true || !validId(b.orderId) || !/^[a-f0-9]{24,64}$/i.test(b.token || '') ||
        !safeEqual(req.get('x-csrf-token'), b.token) || !validDevice(b.deviceId) ||
        typeof b.publicKeyPem !== 'string' || b.publicKeyPem.length > 4000) {
      return respondError(res, fail('CONSENT_OR_DEVICE_REQUIRED', 403));
    }
    let publicKey;
    try {
      publicKey = crypto.createPublicKey(b.publicKeyPem);
      if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('unsupported key');
      }
    } catch (_) { return respondError(res, fail('DEVICE_KEY_INVALID', 400)); }
    try {
      const session = await getSession(b.orderId);
      if (!session || !safeEqual(session.sessionId, b.token) || session.status !== 'PENDING' ||
          Date.now() >= Number(session.expiresAt)) throw fail('SESSION_INVALID_OR_EXPIRED', 409);
      const amountPaise = rupeesToPaise(String(session.challengeAmount));
      const payee = String(session.vpaAddress || '').toLowerCase();
      if (!/^[1-9][0-9]{0,15}$/.test(amountPaise) || !validVpa(payee)) throw fail('SESSION_BINDING_INVALID', 409);
      const paymentType =
        String(session.merchantType || '').toUpperCase().includes('P2M') ||
        String(session.merchantType || '').toUpperCase() === 'MERCHANT' ? 'P2M' : 'P2P';
      let merchantReference = '', merchantCategoryCode = '';
      if (session.upiUri) {
        const issuedParams = new URL(session.upiUri).searchParams;
        merchantReference = issuedParams.get('tr') || '';
        merchantCategoryCode = issuedParams.get('mc') || '';
      } else if (paymentType === 'P2M') {
        merchantReference = String(session.txnRef || session.orderId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 35);
        merchantCategoryCode = String(session.mcc || '');
      }
      const now = Date.now(), expiresAt = Math.min(Number(session.expiresAt), now + 180000);
      const nonce = crypto.randomBytes(20).toString('hex');
      let activeNonce = nonce, activeExpiry = expiresAt, activeConsentTime = now;
      const c = await pool.connect(); let tx = false;
      try {
        await c.query('BEGIN'); tx = true;
        const existing = (await c.query(
          'SELECT * FROM disha_session_evidence_consents WHERE order_id=$1 FOR UPDATE', [b.orderId])).rows[0];
        if (existing) {
          if (existing.revoked_at || Number(existing.expires_at) <= now ||
              !safeEqual(existing.token_hash, sha256(b.token)) ||
              existing.amount_paise !== amountPaise || existing.payee_vpa !== payee ||
              existing.payment_type !== paymentType) throw fail('SESSION_EVIDENCE_BINDING_CONFLICT', 409);
          activeNonce = existing.nonce;
          activeExpiry = Number(existing.expires_at);
          activeConsentTime = Number(existing.consented_at);
        } else {
          await c.query(
            `INSERT INTO disha_session_evidence_consents
              (order_id,token_hash,nonce,amount_paise,payee_vpa,payment_type,consented_at,expires_at,revoked_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
            [b.orderId, sha256(b.token), nonce, amountPaise, payee, paymentType, now, expiresAt]);
        }
        const enrolled = (await c.query(
          'SELECT public_key_pem FROM disha_session_evidence_devices WHERE order_id=$1 AND device_id=$2',
          [b.orderId, b.deviceId])).rows[0];
        if (enrolled && enrolled.public_key_pem !== b.publicKeyPem) {
          throw fail('DEVICE_KEY_REPLACEMENT_BLOCKED', 409);
        }
        const deviceCount = Number((await c.query(
          'SELECT COUNT(*)::int AS count FROM disha_session_evidence_devices WHERE order_id=$1',
          [b.orderId])).rows[0].count);
        if (!enrolled && deviceCount >= 3) throw fail('DEVICE_PAIR_LIMIT_REACHED', 409);
        if (!enrolled) await c.query(
          `INSERT INTO disha_session_evidence_devices(order_id,device_id,public_key_pem,enrolled_at)
           VALUES($1,$2,$3,$4)`, [b.orderId, b.deviceId, b.publicKeyPem, now]);
        await c.query('COMMIT'); tx = false;
      } catch (e) { if (tx) await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
      return res.status(201).set('Cache-Control','no-store').json({
        success:true, orderId:b.orderId, nonce:activeNonce, deviceId:b.deviceId,
        amountPaise, payeeVpa:payee, paymentType, merchantReference, merchantCategoryCode,
        expiresAt:activeExpiry, consentedAt:activeConsentTime, serverTime:now, allowedPackages:[...allowedPackages]
      });
    } catch (e) { console.error('[session-evidence] authorize failed:', e && (e.code || e.message) || 'unknown'); return respondError(res, e); }
  });

  router.post('/event', async (req, res) => {
    const b = req.body || {}, pool = getPool();
    if (!pool) return respondError(res, fail('POSTGRES_REQUIRED', 503));
    const c = await pool.connect(); let tx = false;
    try {
      if (!b.evidence || !validId(b.evidence.orderId) || !validDevice(b.evidence.deviceId)) throw fail('EVIDENCE_FIELDS_INVALID');
      await c.query('BEGIN'); tx = true;
      const consent = (await c.query(
        'SELECT * FROM disha_session_evidence_consents WHERE order_id=$1 FOR UPDATE', [b.evidence.orderId])).rows[0];
      if (!consent || consent.revoked_at || Date.now() >= Number(consent.expires_at)) throw fail('SESSION_EXPIRED', 410);
      const device = (await c.query(
        'SELECT public_key_pem FROM disha_session_evidence_devices WHERE order_id=$1 AND device_id=$2',
        [b.evidence.orderId, b.evidence.deviceId])).rows[0];
      if (!device) throw fail('DEVICE_NOT_ENROLLED', 403);
      const session = await getSession(b.evidence.orderId);
      if (!session || session.status !== 'PENDING' || !safeEqual(session.sessionId, b.token) ||
          !safeEqual(sha256(b.token || ''), consent.token_hash)) throw fail('SESSION_TOKEN_INVALID', 401);
      const publicKey = crypto.createPublicKey(device.public_key_pem);
      const eventHash = verifyDeviceEvidence(b.evidence, b.signature, publicKey, allowedPackages);
      let decision = evaluateEvidence(b.evidence, consent);
      if (decision.accepted && b.evidence.transactionRef) {
        const previousRef = (await c.query(
          'SELECT order_id,amount_paise,payee_vpa FROM disha_session_evidence_events WHERE transaction_ref=$1 ORDER BY received_at ASC LIMIT 1 FOR UPDATE',
          [b.evidence.transactionRef])).rows[0];
        if (previousRef && previousRef.order_id !== b.evidence.orderId) {
          decision = { state: 'TRANSACTION_REFERENCE_REPLAY', accepted: false };
        } else if (previousRef &&
                   ((previousRef.amount_paise && b.evidence.amountPaise && previousRef.amount_paise !== b.evidence.amountPaise) ||
                    (previousRef.payee_vpa && b.evidence.payeeVpa &&
                     previousRef.payee_vpa.toLowerCase() !== b.evidence.payeeVpa.toLowerCase()))) {
          decision = { state: 'CROSS_DEVICE_SIGNAL_CONFLICT', accepted: false };
        }
      }
      const eventCount = Number((await c.query(
        'SELECT COUNT(*)::int AS count FROM disha_session_evidence_events WHERE order_id=$1',
        [b.evidence.orderId])).rows[0].count);
      if (eventCount >= 40) throw fail('SESSION_EVENT_LIMIT_REACHED', 429);
      await c.query(
        `INSERT INTO disha_session_evidence_events
          (event_hash,event_id,order_id,device_id,package_name,posted_at,received_at,
           amount_paise,payee_vpa,transaction_ref,signal_status,decision_state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [eventHash,b.evidence.eventId,b.evidence.orderId,b.evidence.deviceId,b.evidence.packageName,
          b.evidence.postedAt,Date.now(),b.evidence.amountPaise,b.evidence.payeeVpa,
          b.evidence.transactionRef,b.evidence.status,decision.state]);
      await c.query('UPDATE disha_session_evidence_devices SET last_seen_at=$3 WHERE order_id=$1 AND device_id=$2',
        [b.evidence.orderId,b.evidence.deviceId,Date.now()]);
      const aggregate = (await c.query(
        `SELECT COUNT(*)::int AS event_count,
          COUNT(*) FILTER (WHERE decision_state='SIGNAL_MATCHED')::int AS matched_count,
          COUNT(DISTINCT device_id)::int AS device_count,
          COUNT(DISTINCT transaction_ref) FILTER (WHERE transaction_ref IS NOT NULL)::int AS reference_count
         FROM disha_session_evidence_events WHERE order_id=$1`, [b.evidence.orderId])).rows[0];
      const rows = (await c.query(
        'SELECT device_id,transaction_ref,decision_state FROM disha_session_evidence_events WHERE order_id=$1',
        [b.evidence.orderId])).rows;
      const unifiedDecision = aggregateSessionDecision(rows);
      await c.query('COMMIT'); tx = false;
      const payload = {
        success:decision.accepted,accepted:decision.accepted,decisionState:decision.state,
        paymentVerified:false,debitVerified:false,
        fraudDecision:unifiedDecision,
        sessionEvidence:{eventCount:aggregate.event_count,matchedSignalCount:aggregate.matched_count,
          participatingDeviceCount:aggregate.device_count,referenceCount:aggregate.reference_count}
      };
      return res.status(decision.accepted ? 202 : 409).set('Cache-Control','no-store').json(payload);
    } catch (e) {
      if (tx) await c.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return respondError(res, fail('EVIDENCE_REPLAY_BLOCKED', 409));
      return respondError(res, e);
    } finally { c.release(); }
  });

  router.post('/revoke', async (req, res) => {
    const b = req.body || {}, pool = getPool();
    if (!pool) return respondError(res, fail('POSTGRES_REQUIRED', 503));
    if (!validId(b.orderId) || typeof b.token !== 'string' || !safeEqual(req.get('x-csrf-token'), b.token)) {
      return respondError(res, fail('SESSION_TOKEN_INVALID', 401));
    }
    try {
      const session = await getSession(b.orderId);
      if (!session || !safeEqual(session.sessionId, b.token)) throw fail('SESSION_TOKEN_INVALID', 401);
      await pool.query('UPDATE disha_session_evidence_consents SET revoked_at=$2 WHERE order_id=$1',
        [b.orderId, Date.now()]);
      return res.set('Cache-Control','no-store').json({success:true,revoked:true});
    } catch (e) { return respondError(res,e); }
  });

  router.get('/status/:orderId', async (req, res) => {
    const pool = getPool(), token = req.query.token;
    if (!pool) return respondError(res, fail('POSTGRES_REQUIRED', 503));
    try {
      const session = await getSession(req.params.orderId);
      if (!session || !safeEqual(session.sessionId, token)) throw fail('SESSION_TOKEN_INVALID', 401);
      const row = (await pool.query(
        `SELECT c.consented_at,c.expires_at,c.revoked_at,
          COUNT(e.event_id)::int AS event_count,
          COUNT(*) FILTER (WHERE e.decision_state='SIGNAL_MATCHED')::int AS matched_count,
          COUNT(DISTINCT e.device_id)::int AS device_count
         FROM disha_session_evidence_consents c LEFT JOIN disha_session_evidence_events e ON e.order_id=c.order_id
         WHERE c.order_id=$1 GROUP BY c.order_id`, [req.params.orderId])).rows[0];
      if (!row) return res.json({success:true,state:'NOT_AUTHORIZED',fraudDecision:'NO_EVIDENCE',eventCount:0,matchedSignalCount:0,deviceCount:0});
      const events = (await pool.query(
        'SELECT device_id,transaction_ref,decision_state FROM disha_session_evidence_events WHERE order_id=$1',
        [req.params.orderId])).rows;
      const fraudDecision = aggregateSessionDecision(events);
      return res.set('Cache-Control','no-store').json({
        success:true,state:row.revoked_at?'REVOKED':Date.now()>=Number(row.expires_at)?'EXPIRED':'ACTIVE',
        fraudDecision,expiresAt:Number(row.expires_at),consentedAt:Number(row.consented_at),
        eventCount:row.event_count,matchedSignalCount:row.matched_count,deviceCount:row.device_count
      });
    } catch (e) { return respondError(res,e); }
  });
  return router;
}

module.exports = { ALLOWED_PACKAGES, canonicalEvidence, verifyDeviceEvidence,
  evaluateEvidence, aggregateSessionDecision, initializeSessionEvidenceSchema, createSessionEvidenceRouter };
