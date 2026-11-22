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
  'in.org.npci.upiapp',
  // These are notifications POSTED BY messaging apps, not trusted bank SMS.
  'com.google.android.apps.messaging',
  'com.android.mms'
]);

// Independently provisioned observer keys, not checkout-enrolled software identity.
// This is a trust allowlist; it does not on its own attest to notification provenance.
function isIndependentlyPinnedObserverKey(publicKey) {
  const pins = new Set((process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 || '')
    .split(',').map(value => value.trim().toLowerCase())
    .filter(value => /^[a-f0-9]{64}$/.test(value)));
  if (!pins.size) return false;
  try {
    const key = publicKey instanceof crypto.KeyObject && publicKey.type === 'public'
      ? publicKey : crypto.createPublicKey(publicKey);
    const spki = key.export({type:'spki',format:'der'});
    return pins.has(sha256(spki));
  } catch (_) { return false; }
}

function canonicalEvidence(input, allowedPackages = ALLOWED_PACKAGES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('EVIDENCE_FIELDS_INVALID');
  const keys = ['protocol','eventId','orderId','nonce','deviceId','packageName','postedAt',
    'amountPaise','payeeVpa','transactionRef','status'];
  const observed = input.protocol === 'DISHA-DEBIT-UTR-OBSERVATION-V1';
  if (observed) keys.push('referenceKind');
  if (Object.keys(input).length !== keys.length || !keys.every(k => Object.hasOwn(input, k))) {
    throw fail('EVIDENCE_FIELDS_INVALID');
  }
  const e = Object.fromEntries(keys.map(k => [k, input[k]]));
  if ((!observed && e.protocol !== 'DISHA-SESSION-EVIDENCE-V1') ||
      !validId(e.eventId) || !validId(e.orderId) || !/^[a-f0-9]{40}$/i.test(e.nonce) ||
      !validDevice(e.deviceId) || !allowedPackages.has(e.packageName) ||
      !Number.isSafeInteger(e.postedAt) || e.postedAt <= 0 ||
      !(e.amountPaise === null || (typeof e.amountPaise === 'string' && /^[1-9][0-9]{0,15}$/.test(e.amountPaise))) ||
      !(e.payeeVpa === null || validVpa(e.payeeVpa)) ||
      !(e.transactionRef === null || (typeof e.transactionRef === 'string' && /^[A-Za-z0-9._:/-]{6,100}$/.test(e.transactionRef))) ||
      !['SUCCESS','FAILED','PENDING','UNKNOWN'].includes(e.status)) {
    throw fail('EVIDENCE_FIELDS_INVALID');
  }
  if (observed && (!ALLOWED_PACKAGES.has(e.packageName) || e.status !== 'SUCCESS' ||
      !e.amountPaise || !e.payeeVpa || !/^[0-9]{12}$/.test(e.transactionRef || '') ||
      !['UTR','RRN'].includes(e.referenceKind))) throw fail('EVIDENCE_FIELDS_INVALID');
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

const RECEIPT_MIME = new Set(['text/plain','image/png','image/jpeg','application/pdf']);
const RECEIPT_FIELDS = ['protocol','orderId','nonce','deviceId','mimeType','postedAt','sha256','byteLength'];
function canonicalSharedReceipt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== RECEIPT_FIELDS.length ||
      !RECEIPT_FIELDS.every(key => Object.hasOwn(input,key))) throw fail('SHARED_RECEIPT_FIELDS_INVALID');
  const value = Object.fromEntries(RECEIPT_FIELDS.map(key => [key,input[key]]));
  if (value.protocol !== 'DISHA-SHARED-RECEIPT-V1' || !validId(value.orderId) ||
      !/^[a-f0-9]{40}$/.test(value.nonce) || !validDevice(value.deviceId) ||
      !RECEIPT_MIME.has(value.mimeType) || !Number.isSafeInteger(value.postedAt) ||
      value.postedAt <= 0 || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 ||
      value.byteLength > 512000) throw fail('SHARED_RECEIPT_FIELDS_INVALID');
  return JSON.stringify(value);
}
function matchSharedReceiptText(bytes, mimeType, amountPaise) {
  if (mimeType !== 'text/plain') return {matched:false,reason:'RECEIPT_IMAGE_REQUIRES_EXTRACTION'};
  const text = bytes.toString('utf8');
  // Only explicitly labelled references qualify; a random 12-digit number does not.
  const labels = [...text.matchAll(/\b(UTR|RRN)\s*(?:no\.?|number|:|#|-)*\s*(\d{12})(?!\d)/gi)];
  const refs = [...new Set(labels.map(match => match[2]))];
  const amounts = [...text.matchAll(/(?:₹|INR\s*|Rs\.?\s*)(\d{1,12}(?:,\d{3})*)(?:\.(\d{1,2}))?/gi)]
    .map(match => {
      const rupees = match[1].replace(/,/g,'');
      return (BigInt(rupees)*100n + BigInt((match[2] || '').padEnd(2,'0'))).toString();
    });
  const uniqueAmounts = [...new Set(amounts)];
  return {matched:refs.length===1 && uniqueAmounts.length===1 &&
      uniqueAmounts[0]===amountPaise,
    reference:refs.length===1?refs[0]:null,
    reason:refs.length!==1?'REFERENCE_MISSING_OR_AMBIGUOUS':
      uniqueAmounts.length!==1?'AMOUNT_MISSING_OR_AMBIGUOUS':
      uniqueAmounts[0]!==amountPaise?'AMOUNT_MISMATCH':null};
}

function evaluateEvidence(e, session, now = Date.now()) {
  const expiry = Number(session.expires_at);
  const consentedAt = Number(session.consented_at);
  if (e.orderId !== session.order_id || e.nonce !== session.nonce) return { state: 'CROSS_SESSION', accepted: false };
  const isObservation = e.protocol === 'DISHA-DEBIT-UTR-OBSERVATION-V1';
  if (now >= expiry || e.postedAt > expiry ||
      e.postedAt < consentedAt - (isObservation ? 0 : 30000) ||
      e.postedAt > now + (isObservation ? 0 : 120000)) {
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
    CREATE TABLE IF NOT EXISTS disha_android_observation_pairings (
      ticket_hash TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      observer_token_hash TEXT UNIQUE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      claimed_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS disha_android_observation_pairings_order
      ON disha_android_observation_pairings(order_id,expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS disha_android_observation_one_unclaimed
      ON disha_android_observation_pairings(order_id) WHERE claimed_at IS NULL;
    ALTER TABLE disha_session_evidence_consents ADD COLUMN IF NOT EXISTS source_package TEXT;
    CREATE TABLE IF NOT EXISTS disha_session_evidence_devices (
      order_id TEXT NOT NULL REFERENCES disha_session_evidence_consents(order_id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      public_key_pem TEXT NOT NULL,
      enrolled_at BIGINT NOT NULL,
      last_seen_at BIGINT,
      PRIMARY KEY(order_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS disha_session_shared_receipts (
      order_id TEXT PRIMARY KEY REFERENCES disha_session_evidence_consents(order_id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      source_sha256 TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      source_bytes BYTEA NOT NULL,
      observed_at BIGINT NOT NULL,
      reference TEXT,
      text_matched BOOLEAN NOT NULL DEFAULT FALSE
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
    ALTER TABLE disha_session_evidence_events ADD COLUMN IF NOT EXISTS reference_kind TEXT;
    -- One RRN can legitimately appear in both a payer-app alert and an SMS.
    -- Cross-order reuse is checked under a transaction-scoped advisory lock.
    DROP INDEX IF EXISTS disha_session_observed_ref_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS disha_session_observed_source_unique
      ON disha_session_evidence_events(order_id,package_name,transaction_ref)
      WHERE reference_kind IS NOT NULL AND decision_state = 'SIGNAL_MATCHED';
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

  // A checkout may issue one 60-second, high-entropy ticket. The ticket is
  // the ONLY secret put in an Android app handoff URL. The Android observer gets
  // a separate short-lived capability, never the checkout bearer.
  const validTicket = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  const scopedObserver = async (pool, orderId, token) => {
    if (!pool || !validId(orderId) || !validTicket(token)) return false;
    const rows = (await pool.query(
      'SELECT 1 FROM disha_android_observation_pairings WHERE order_id=$1 AND observer_token_hash=$2 AND claimed_at IS NOT NULL AND expires_at>$3 LIMIT 1',
      [orderId, sha256(token), Date.now()])).rows;
    return rows.length === 1;
  };
  router.post('/pairing/issue', async (req,res) => {
    const b=req.body||{},pool=getPool();
    if (!pool) return respondError(res,fail('POSTGRES_REQUIRED',503));
    if (!validId(b.orderId) || typeof b.token !== 'string' ||
        !safeEqual(req.get('x-csrf-token'),b.token)) return respondError(res,fail('SESSION_TOKEN_INVALID',401));
    try {
      const session=await getSession(b.orderId),now=Date.now();
      if (!session || !safeEqual(session.sessionId,b.token))
        throw fail('SESSION_TOKEN_INVALID',401);
      if (session.status!=='PENDING' || now>=Number(session.expiresAt))
        throw fail('SESSION_INVALID_OR_EXPIRED',409);
      const ticket=crypto.randomBytes(32).toString('base64url');
      const expires=Math.min(Number(session.expiresAt),now+60000);
      await pool.query('DELETE FROM disha_android_observation_pairings WHERE expires_at<$1',[now-60000]);
      // Rotate any unclaimed ticket; multiple app links must not remain live.
      await pool.query('DELETE FROM disha_android_observation_pairings WHERE order_id=$1 AND claimed_at IS NULL',
        [b.orderId]);
      await pool.query(
        'INSERT INTO disha_android_observation_pairings(ticket_hash,order_id,created_at,expires_at) VALUES($1,$2,$3,$4)',
        [sha256(ticket),b.orderId,now,expires]);
      return res.status(201).set('Cache-Control','no-store').json({success:true,ticket,expiresAt:expires});
    } catch(e){return respondError(res,e);}
  });
  router.post('/pairing/redeem', async(req,res)=>{
    const b=req.body||{},pool=getPool();
    if (!pool) return respondError(res,fail('POSTGRES_REQUIRED',503));
    if (!validTicket(b.ticket)) return respondError(res,fail('PAIRING_TICKET_INVALID',400));
    const c=await pool.connect();let tx=false;
    try {
      await c.query('BEGIN');tx=true;
      const now=Date.now();
      const claimed=(await c.query(
        'UPDATE disha_android_observation_pairings SET claimed_at=$2 WHERE ticket_hash=$1 AND claimed_at IS NULL AND expires_at>$2 RETURNING order_id,expires_at',
        [sha256(b.ticket),now])).rows[0];
      if (!claimed) throw fail('PAIRING_TICKET_EXPIRED_OR_USED',409);
      const session=await getSession(claimed.order_id);
      if (!session || session.status!=='PENDING' || now>=Number(session.expiresAt))
        throw fail('SESSION_INVALID_OR_EXPIRED',409);
      const observerToken=crypto.randomBytes(32).toString('base64url');
      // Ticket expires after 60 seconds; the scoped observation capability
      // survives only until the checkout ends (at most 180s after redemption).
      // claimed_at remains set, so extending this row cannot revive the ticket.
      const observerExpiry=Math.min(Number(session.expiresAt),now+180000);
      await c.query('UPDATE disha_android_observation_pairings SET observer_token_hash=$2,expires_at=$3 WHERE ticket_hash=$1',
        [sha256(b.ticket),sha256(observerToken),observerExpiry]);
      await c.query('COMMIT');tx=false;
      return res.set('Cache-Control','no-store').json({
        success:true,orderId:claimed.order_id,observerToken,expiresAt:observerExpiry
      });
    } catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});return respondError(res,e);}
    finally {c.release();}
  });

  router.post('/authorize', async (req, res) => {
    const b = req.body || {}, pool = getPool();
    if (!pool) return respondError(res, fail('POSTGRES_REQUIRED', 503));
    if (b.consent !== true || !validId(b.orderId) || !/^(?:[a-f0-9]{24,64}|[A-Za-z0-9_-]{43})$/i.test(b.token || '') ||
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
      const isScoped = !safeEqual(session?.sessionId,b.token) &&
        await scopedObserver(pool,b.orderId,b.token);
      if (!session || (!safeEqual(session.sessionId,b.token) && !isScoped) ||
          session.status !== 'PENDING' || Date.now() >= Number(session.expiresAt))
        throw fail('SESSION_INVALID_OR_EXPIRED',409);
      const selectedPackage=isScoped ? b.sourcePackage : (session.observationPackage||null);
      if (isScoped && !ALLOWED_PACKAGES.has(selectedPackage)) throw fail('SOURCE_PACKAGE_INVALID',422);
      // Optional experimental platform mode: reject an unapproved observer at
      // enrollment instead of allowing it to submit and failing only at receipt.
      // Default OFF preserves the existing Android fixture research workflow.
      // An independent OEM/admin channel must provision the pinned SPKI digest.
      if (process.env.DISHA_PLATFORM_OBSERVER_ENFORCE === '1' && selectedPackage &&
          !isIndependentlyPinnedObserverKey(publicKey)) {
        throw fail('PLATFORM_OBSERVER_KEY_UNTRUSTED', 403);
      }
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
              existing.payment_type !== paymentType ||
              (existing.source_package||null)!==(selectedPackage||null)) throw fail('SESSION_EVIDENCE_BINDING_CONFLICT', 409);
          activeNonce = existing.nonce;
          activeExpiry = Number(existing.expires_at);
          activeConsentTime = Number(existing.consented_at);
        } else {
          await c.query(
            `INSERT INTO disha_session_evidence_consents
              (order_id,token_hash,nonce,amount_paise,payee_vpa,payment_type,consented_at,expires_at,revoked_at,source_package)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)`,
            [b.orderId, sha256(b.token), nonce, amountPaise, payee, paymentType, now, expiresAt, selectedPackage]);
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
        expiresAt:activeExpiry, consentedAt:activeConsentTime, serverTime:now,
        allowedPackages:selectedPackage ?
          [...new Set([selectedPackage,'com.google.android.apps.messaging','com.android.mms'])] :
          [...allowedPackages]
      });
    } catch (e) { console.error('[session-evidence] authorize failed:', e && (e.code || e.message) || 'unknown'); return respondError(res, e); }
  });

  // User-selected Android Sharesheet content. The broker signs a hash and
  // session-bound envelope; the original bytes remain opaque user-supplied data.
  // This endpoint does NOT infer the originating UPI app from an ACTION_SEND.
  router.post('/shared-receipt', express.raw({type:'application/octet-stream',limit:'512kb'}), async(req,res) => {
    const pool=getPool(), raw=req.body;
    if (!pool) return respondError(res,fail('POSTGRES_REQUIRED',503));
    if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > 512000)
      return respondError(res,fail('SHARED_RECEIPT_BYTES_INVALID',422));
    let envelope, message;
    try {
      const encoded=req.get('x-disha-receipt-envelope');
      if (typeof encoded!=='string' || !/^[A-Za-z0-9_-]{40,1600}$/.test(encoded))
        throw fail('SHARED_RECEIPT_FIELDS_INVALID');
      envelope=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
      message=canonicalSharedReceipt(envelope);
      if (envelope.byteLength!==raw.length || sha256(raw)!==envelope.sha256)
        throw fail('SHARED_RECEIPT_HASH_MISMATCH');
      const signature=req.get('x-disha-receipt-signature');
      if (typeof signature!=='string'||!/^[A-Za-z0-9_-]{80,200}$/.test(signature))
        throw fail('DEVICE_SIGNATURE_INVALID',401);
    } catch(e) {return respondError(res,e.status?e:fail('SHARED_RECEIPT_FIELDS_INVALID'));}
    const c=await pool.connect();let tx=false;
    try {
      await c.query('BEGIN');tx=true;
      const consent=(await c.query(
        'SELECT * FROM disha_session_evidence_consents WHERE order_id=$1 FOR UPDATE',
        [envelope.orderId])).rows[0];
      const now=Date.now();
      if (!consent || consent.revoked_at || now>=Number(consent.expires_at) ||
          envelope.nonce!==consent.nonce || envelope.postedAt<Number(consent.consented_at) ||
          envelope.postedAt>now+10000 || envelope.postedAt>=Number(consent.expires_at))
        throw fail('SESSION_EXPIRED',410);
      const token=req.get('x-csrf-token');
      if (typeof token!=='string'||!safeEqual(sha256(token),consent.token_hash)||
          !(await scopedObserver(c,envelope.orderId,token))) throw fail('SESSION_TOKEN_INVALID',401);
      const device=(await c.query(
        'SELECT public_key_pem FROM disha_session_evidence_devices WHERE order_id=$1 AND device_id=$2',
        [envelope.orderId,envelope.deviceId])).rows[0];
      if (!device) throw fail('DEVICE_NOT_ENROLLED',403);
      const signature=Buffer.from(req.get('x-disha-receipt-signature'),'base64url');
      if (!crypto.verify('sha256',Buffer.from(message),crypto.createPublicKey(device.public_key_pem),signature))
        throw fail('DEVICE_SIGNATURE_INVALID',401);
      const session=await getSession(envelope.orderId);
      if (!session || session.status!=='PENDING' || now>=Number(session.expiresAt))
        throw fail('SESSION_EXPIRED',410);
      const parsed=matchSharedReceiptText(raw,envelope.mimeType,
        rupeesToPaise(String(session.challengeAmount)));
      const reference=parsed.reference;
      await c.query(
        'INSERT INTO disha_session_shared_receipts(order_id,device_id,source_sha256,mime_type,source_bytes,observed_at,reference,text_matched) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [envelope.orderId,envelope.deviceId,envelope.sha256,envelope.mimeType,raw,
          envelope.postedAt,reference,parsed.matched]);
      await c.query('COMMIT');tx=false;
      return res.status(202).set('Cache-Control','no-store').json({
        success:true,state:'SHARED_RECEIPT_CAPTURED',
        contentMatched:parsed.matched,reason:parsed.reason||null
      });
    } catch(e) {
      if(tx)await c.query('ROLLBACK').catch(()=>{});
      if(e.code==='23505')return respondError(res,fail('SHARED_RECEIPT_REPLAY',409));
      return respondError(res,e);
    } finally {c.release();}
  });

  // Only the checkout bearer can retrieve original receipt bytes.
  router.get('/shared-receipt/:orderId',async(req,res)=>{
    const pool=getPool();
    if(!pool)return respondError(res,fail('POSTGRES_REQUIRED',503));
    try{
      const session=await getSession(req.params.orderId);
      if(!session||!safeEqual(session.sessionId,req.query.token)||
          session.status!=='PENDING'||Date.now()>=Number(session.expiresAt))
        throw fail('SESSION_TOKEN_INVALID',401);
      const row=(await pool.query(
        'SELECT r.mime_type,r.source_bytes,r.source_sha256,r.text_matched,r.reference '+
        'FROM disha_session_shared_receipts r JOIN disha_session_evidence_consents c ON c.order_id=r.order_id '+
        'WHERE r.order_id=$1 AND c.revoked_at IS NULL AND c.expires_at>$2',
        [req.params.orderId,Date.now()])).rows[0];
      if(!row)return res.set('Cache-Control','no-store').json({success:true,state:'NOT_RECEIVED'});
      return res.set('Cache-Control','no-store').json({success:true,state:'RECEIVED',
        mimeType:row.mime_type,sourceSha256:row.source_sha256,
        originalBase64:Buffer.from(row.source_bytes).toString('base64'),
        textMatched:row.text_matched,reference:row.reference});
    } catch(e){return respondError(res,e);}
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
      if (!session || session.status !== 'PENDING' ||
          Date.now() >= Number(session.expiresAt) ||
          (!safeEqual(session.sessionId,b.token) &&
           !(await scopedObserver(c,b.evidence.orderId,b.token))) ||
          !safeEqual(sha256(b.token || ''), consent.token_hash))
        throw fail('SESSION_TOKEN_INVALID',401);
      const observed = b.evidence.protocol === 'DISHA-DEBIT-UTR-OBSERVATION-V1';
      const boundPackage=consent.source_package||session.observationPackage;
      if (observed !== Boolean(boundPackage) ||
          (observed && b.evidence.packageName !== boundPackage &&
            !['com.google.android.apps.messaging','com.android.mms'].includes(b.evidence.packageName)) ||
          (!observed && !allowedPackages.has(b.evidence.packageName))) {
        throw fail('EVIDENCE_FIELDS_INVALID');
      }
      const publicKey = crypto.createPublicKey(device.public_key_pem);
      const eventHash = verifyDeviceEvidence(b.evidence, b.signature, publicKey,
        observed ? ALLOWED_PACKAGES : allowedPackages);
      let decision = evaluateEvidence(b.evidence, consent);
      if (decision.accepted && b.evidence.transactionRef) {
        // Serialize reference reuse checks across concurrent checkouts.
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[b.evidence.transactionRef]);
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
      if (observed) await c.query(
        'UPDATE disha_session_evidence_events SET reference_kind=$2 WHERE event_hash=$1',
        [eventHash, b.evidence.referenceKind]);
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
        ...(observed && decision.state === 'SIGNAL_MATCHED' ? {
          observationState:'DEBIT_UTR_OBSERVED', referenceKind:b.evidence.referenceKind
        } : {}),
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
      if (!session || (!safeEqual(session.sessionId,b.token) &&
          !(await scopedObserver(pool,b.orderId,b.token)))) throw fail('SESSION_TOKEN_INVALID',401);
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

async function readDebitEvidenceReceipt(pool, id, session, now = Date.now()) {
  if (String(session.status).toUpperCase() !== 'PENDING' || !(now < Number(session.expiresAt))) return {};
  const amountPaise = rupeesToPaise(String(session.challengeAmount));
  const payee = String(session.vpaAddress || '').trim().toLowerCase();
  const {rows} = await pool.query(
    "SELECT e.event_hash,e.package_name,e.transaction_ref,e.reference_kind,e.amount_paise,e.payee_vpa,e.posted_at,e.decision_state,d.public_key_pem "+
    'FROM disha_session_evidence_events e JOIN disha_session_evidence_consents c ON c.order_id=e.order_id '+
    'JOIN disha_session_evidence_devices d ON d.order_id=e.order_id AND d.device_id=e.device_id '+
    'WHERE e.order_id=$1 AND c.revoked_at IS NULL AND c.expires_at>$2 '+
    "AND e.reference_kind IN ('UTR','RRN') AND e.posted_at>=c.consented_at AND e.posted_at<c.expires_at "+
    'ORDER BY e.posted_at DESC LIMIT 41',[id,now]);
  if (!rows.length) return {};
  const references = new Set(rows.map(row => row.transaction_ref));
  if (references.size !== 1 || !rows.every(row =>
    row.decision_state === 'SIGNAL_MATCHED' &&
    row.amount_paise === amountPaise &&
    String(row.payee_vpa).toLowerCase() === payee &&
    /^\d{12}$/.test(row.transaction_ref) &&
    /^[a-f0-9]{64}$/.test(row.event_hash)
  )) return {receiptError:'CONFLICTING_OR_INVALID_EVIDENCE'};
  // Different authorized notification sources may describe the SAME debit.
  // Device provenance must still be independently pinned for every source.
  if (!rows.every(row => isIndependentlyPinnedObserverKey(row.public_key_pem)))
    return {receiptError: (process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256 || '').trim()
      ? 'DEVICE_PROVENANCE_UNTRUSTED' : 'TRUSTED_DEVICE_NOT_CONFIGURED'};
  const sources = [...new Set(rows.map(row => row.package_name))];
  const shared = (await pool.query(
    'SELECT reference,text_matched,mime_type,source_sha256 FROM disha_session_shared_receipts WHERE order_id=$1',
    [id])).rows[0];
  const smsSources = new Set(['com.google.android.apps.messaging','com.android.mms']);
  const hasPaymentAlert = sources.some(source => !smsSources.has(source));
  const hasSms = sources.some(source => smsSources.has(source));
  const row = rows[0];
  const sharedMatched = shared?.text_matched === true && shared.reference === row.transaction_ref;
  const threeProofMatched = hasPaymentAlert && hasSms && sharedMatched;
  return {debitEvidenceReceipt:{orderId:id,state:threeProofMatched?
    'CHECKOUT_DEBIT_OBSERVED':'DEBIT_EVIDENCE_OBSERVED',
    proofStatus:{paymentNotification:hasPaymentAlert?'MATCHED':'PENDING',
      debitSms:hasSms?'MATCHED':'PENDING',
      sharedReceipt:sharedMatched?'MATCHED':shared?'RECEIVED':'PENDING'},
    source:row.package_name,sourceTrust:row.package_name==='com.google.android.apps.messaging'||
      row.package_name==='com.android.mms'?'SMS_NOTIFICATION_SENDER_UNVERIFIED':'PAYER_APP_NOTIFICATION_UNVERIFIED',
    amountPaise,reference:row.transaction_ref,referenceKind:row.reference_kind,
    observedAt:Number(row.posted_at),receiptReference:row.event_hash,sources,
    observedSources:rows.map(event => ({packageName:event.package_name,
      referenceKind:event.reference_kind,observedAt:Number(event.posted_at),
      receiptReference:event.event_hash}))}};
}

module.exports = { readDebitEvidenceReceipt, ALLOWED_PACKAGES, canonicalEvidence, verifyDeviceEvidence,
  evaluateEvidence, aggregateSessionDecision, initializeSessionEvidenceSchema, createSessionEvidenceRouter,
  isIndependentlyPinnedObserverKey, canonicalSharedReceipt, matchSharedReceiptText };
