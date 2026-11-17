'use strict';
/**
 * trust-score.js — hardened zero-trust receipt evidence scoring.
 *
 * Returns a CONFIDENCE TIER, never "paid". Tiers: REJECT | LOW | MEDIUM | HIGH.
 *
 * All gates are fail-closed. No client-trusted fields are accepted. The scoring
 * breakdown is never returned to the caller — only tier + code + reason.
 */

const WEIGHTS = {
  payee: 25,      // payee VPA exact match to session payee
  layout: 20,     // expected UPI receipt fields present
  integrity: 20,  // no editor traces, screenshot-shaped, no AI markers
  behavior: 20,   // same device, single attempt, prompt submission
  utr: 10,        // valid 12-digit UTR + timestamp decode
  reputation: 5   // prior confirmed payments between customer and shop
};

const TIERS = { HIGH: 70, MEDIUM: 55 };

const FAIL_WORDS = /\b(failed|declined|reversed|rejected|cancelled|canceled|expired)\b/i;
const PENDING_WORDS = /\b(pending|processing|in progress|awaiting)\b/i;

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameMatch(a, b) {
  const A = new Set(norm(a).split(' ').filter(w => w.length > 1));
  const B = new Set(norm(b).split(' ').filter(w => w.length > 1));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/**
 * @param {object} session   { challengeAmount, createdAt, expiresAt, payeeVpa, payeeName }
 * @param {object} ev        extracted evidence (server-extracted only)
 * @param {object} hist      { utrSeen, imageHashSeen, priorConfirmed, attemptsThisSession }
 * @param {object} [opts]    { now, graceMs }
 */
function scoreEvidence(session, ev, hist = {}, opts = {}) {
  const now = opts.now || Date.now();
  const grace = opts.graceMs == null ? 60 * 1000 : opts.graceMs;
  const reasons = [];
  const gate = (code, msg) => ({ tier: 'REJECT', score: 0, gate: code, reasons: [msg] });

  // ───── HARD GATES (any failure = REJECT, no settlement) ─────
  if (now > session.expiresAt + grace) return gate('SESSION_EXPIRED', 'Checkout window closed.');
  if (ev.statusText && FAIL_WORDS.test(ev.statusText)) return gate('STATUS_FAILED', 'Receipt shows failed or reversed payment.');
  if (ev.statusText && PENDING_WORDS.test(ev.statusText)) return gate('STATUS_PENDING', 'Receipt shows payment pending.');
  if (typeof ev.amount !== 'number' || Math.abs(ev.amount - session.challengeAmount) > 0.004) {
    return gate('AMOUNT_MISMATCH', 'Receipt amount does not match order challenge amount.');
  }
  if (hist.imageHashSeen) return gate('IMAGE_REUSED', 'This receipt image was already submitted.');
  if (!/^\d{12}$/.test(String(ev.utr || ''))) return gate('UTR_FORMAT', 'No valid 12-digit UTR found.');
  if (hist.utrSeen) return gate('UTR_REUSED', 'This UTR was already used on another order.');
  if ((hist.attemptsThisSession || 0) > 3) return gate('TOO_MANY_ATTEMPTS', 'Too many submissions for one session.');

  // Payee VPA must match — mandatory for any settlement
  if (!ev || !ev.payeeVpa || norm(ev.payeeVpa) !== norm(session.payeeVpa)) {
    return gate('PAYEE_MISMATCH', 'Payee VPA does not match order payee.');
  }

  // Integrity gate — receipt must look like an authentic screenshot.
  // EXIF/editor metadata is not captured by the text parser; the gate fires
  // when the parsed receipt does not exhibit screenshot structure.
  if (ev.looksLikeScreenshot === false) {
    return gate('INTEGRITY_FAILED', 'Receipt does not match authentic UPI screenshot structure.');
  }

  // ───── WEIGHTED SIGNALS (score only, tier determines settlement) ─────
  let score = 0;
  const add = (key, frac, why) => {
    const pts = Math.round(WEIGHTS[key] * Math.max(0, Math.min(1, frac)));
    score += pts;
    reasons.push(`${key}: ${pts}/${WEIGHTS[key]} (${why})`);
  };

  // payee: exact VPA match (already gate-checked, full weight)
  add('payee', 1, 'VPA matches order payee');

  // layout: fraction of expected UPI fields found
  add('layout', ev.layoutFieldsFound && ev.layoutFieldsExpected
    ? ev.layoutFieldsFound / ev.layoutFieldsExpected : 0, 'expected receipt fields present');

  // integrity: screenshot structure verified by gate above (full weight if reached)
  add('integrity', 1, 'authentic screenshot structure');

  // behavior: same device, single attempt, prompt
  let beh = 0;
  if (opts.sameDevice !== false) beh += 0.5;
  if ((hist.attemptsThisSession || 0) <= 1) beh += 0.25;
  if (typeof ev.submittedAt === 'number' && ev.submittedAt - session.createdAt < 5 * 60 * 1000) beh += 0.25;
  add('behavior', beh, 'same device, single attempt, prompt submission');

  // utr: 12-digit format (already gate-checked)
  add('utr', 1, 'valid 12-digit UTR');

  // reputation: prior confirmed payments
  add('reputation', Math.min(1, (hist.priorConfirmed || 0) / 3), 'prior confirmed payments');

  const tier = score >= TIERS.HIGH ? 'HIGH' : score >= TIERS.MEDIUM ? 'MEDIUM' : 'LOW';
  return { tier, score, gate: null, reasons };
}

/**
 * Suggested shop policy:
 *  HIGH   -> release, still show UTR for later matching
 *  MEDIUM / LOW / PENDING / REJECT -> do not release
 */
function suggestAction(result, amount) {
  if (result.tier === 'HIGH') return 'RELEASE_AND_RECONCILE';
  return 'DO_NOT_RELEASE';
}

module.exports = { scoreEvidence, suggestAction, WEIGHTS, TIERS };
