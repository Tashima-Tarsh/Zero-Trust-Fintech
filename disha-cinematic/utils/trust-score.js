'use strict';
/**
 * trust-score.js — grades customer-shared payment-screenshot evidence.
 *
 * It returns a CONFIDENCE TIER, never "paid". The shop decides, ideally
 * after matching the UTR in its own bank app or SMS. Pure function: OCR and
 * image-metadata extraction happen elsewhere and are passed in.
 *
 * Tiers: REJECT (hard gate failed) | LOW | MEDIUM | HIGH | PENDING
 */

const WEIGHTS = {
  payee: 20,       // VPA exact, or name fuzzy-match
  time: 20,        // time shown on screenshot falls inside the session window
  layout: 15,      // expected fields/wording for the detected UPI app
  integrity: 15,   // no editor traces, plausible phone screen size
  behavior: 15,    // same device as QR page, one attempt, prompt submission
  utr: 5,          // 12-digit format (no timestamp decoding: UTR layout is not a public spec)
  reputation: 10   // earlier confirmed payments between this customer and shop
};

const TIERS = { HIGH: 80, MEDIUM: 55 };

const EDITOR_HINTS = /photoshop|canva|picsart|snapseed|lightroom|gimp|pixlr|fotor|remini|facetune|illustrator/i;
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
 * @param {object} ev        extracted evidence (see fields used below)
 * @param {object} hist      { utrSeen, imageHashSeen, priorConfirmed, attemptsThisSession }
 * @param {object} [opts]    { graceMs, now, sameDevice }
 */
function scoreEvidence(session, ev, hist = {}, opts = {}) {
  const now = opts.now || Date.now();
  const grace = opts.graceMs == null ? 60 * 1000 : opts.graceMs;
  const reasons = [];
  const gate = (code, msg) => ({ tier: 'REJECT', score: 0, gate: code, reasons: [msg] });

  // ---------- hard gates (any failure = REJECT) ----------
  if (now > session.expiresAt + grace) return gate('SESSION_EXPIRED', 'Submitted after the session window closed.');
  if (ev.statusText && FAIL_WORDS.test(ev.statusText)) return gate('STATUS_FAILED', 'Screenshot shows a failed or reversed payment.');
  if (typeof ev.amount !== 'number' || Math.abs(ev.amount - session.challengeAmount) > 0.004) {
    return gate('AMOUNT_MISMATCH', 'Amount on screenshot does not match this order to the paisa.');
  }
  if (hist.imageHashSeen) return gate('IMAGE_REUSED', 'This image (or a near copy) was already submitted.');
  if (!/^\d{12}$/.test(String(ev.utr || ''))) return gate('UTR_FORMAT', 'No valid 12-digit UTR found.');
  if (hist.utrSeen) return gate('UTR_REUSED', 'This UTR was already used on another order.');
  if ((hist.attemptsThisSession || 0) > 3) return gate('TOO_MANY_ATTEMPTS', 'Too many submissions for one session.');

  if (ev.statusText && PENDING_WORDS.test(ev.statusText)) {
    return { tier: 'PENDING', score: 0, gate: null, reasons: ['Screenshot shows the payment as pending: ask the shop to re-check later.'] };
  }

  // ---------- weighted signals ----------
  let score = 0;
  const add = (key, frac, why) => {
    const pts = Math.round(WEIGHTS[key] * Math.max(0, Math.min(1, frac)));
    score += pts;
    reasons.push(`${key}: ${pts}/${WEIGHTS[key]} (${why})`);
  };

  // payee: exact VPA beats name match
  if (ev.payeeVpa && norm(ev.payeeVpa) === norm(session.payeeVpa)) add('payee', 1, 'VPA matches');
  else add('payee', nameMatch(ev.payeeName, session.payeeName) * 0.8, 'name similarity only');

  // time shown on screenshot vs session window
  if (typeof ev.shownTime === 'number') {
    const ok = ev.shownTime >= session.createdAt - 60000 && ev.shownTime <= Math.min(now, session.expiresAt + grace);
    add('time', ok ? 1 : 0, ok ? 'inside session window' : 'outside session window');
  } else add('time', 0, 'no readable time');

  // layout: fraction of expected fields the OCR found for the detected app
  add('layout', ev.layoutFieldsFound && ev.layoutFieldsExpected
    ? ev.layoutFieldsFound / ev.layoutFieldsExpected : 0, 'expected fields present');

  // integrity
  let integ = 1;
  if (ev.exifSoftware && EDITOR_HINTS.test(ev.exifSoftware)) integ -= 1;
  if (ev.looksLikeScreenshot === false) integ -= 0.5;
  if (ev.editArtifacts) integ -= 0.5; // from your ELA/OCR-misalignment check, if any
  add('integrity', integ, 'no editor traces, screenshot-shaped');

  // behavior
  let beh = 0;
  if (opts.sameDevice) beh += 0.5;
  if ((hist.attemptsThisSession || 0) <= 1) beh += 0.25;
  if (typeof ev.submittedAt === 'number' && ev.submittedAt - session.createdAt < 5 * 60 * 1000) beh += 0.25;
  add('behavior', beh, 'same device, single attempt, prompt');

  add('utr', 1, '12-digit format');
  add('reputation', Math.min(1, (hist.priorConfirmed || 0) / 3), 'prior confirmed payments');

  const tier = score >= TIERS.HIGH ? 'HIGH' : score >= TIERS.MEDIUM ? 'MEDIUM' : 'LOW';
  return { tier, score, gate: null, reasons };
}

/**
 * Suggested shop policy (all values are the shop's to set):
 *  HIGH   + amount <= instantLimit  -> release, still show UTR for later matching
 *  HIGH   + amount  > instantLimit  -> release only after shop confirms in bank app
 *  MEDIUM                           -> shop confirms in bank app first
 *  LOW / PENDING / REJECT           -> do not release
 */
function suggestAction(result, amount, instantLimit = 500) {
  if (result.tier === 'HIGH') return amount <= instantLimit ? 'RELEASE_AND_RECONCILE' : 'SHOP_CONFIRM_FIRST';
  if (result.tier === 'MEDIUM') return 'SHOP_CONFIRM_FIRST';
  return 'DO_NOT_RELEASE';
}

module.exports = { scoreEvidence, suggestAction, WEIGHTS, TIERS };
