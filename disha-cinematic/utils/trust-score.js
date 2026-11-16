'use strict';

const WEIGHTS = {
  payee: 25,
  layout: 20,
  integrity: 20,
  behavior: 20,
  utr: 10,
  reputation: 5
};

const TIERS = { HIGH: 70, MEDIUM: 55 };

const EDITOR_HINTS = /photoshop|canva|picsart|snapseed|lightroom|gimp|pixlr|remini|facetune|illustrator|fotor|meitu|airbrush|beautyplus|procreate|ibispaint|autodesk|affinity|paint|editor|retouch|splice|mix|collage|sticker|text editor/i;
const AI_HINTS = /midjourney|dall-e|dalle|stable diffusion|synthid|c2pa|generative|ai-generated|synthesia|runway|leonardo|adobe firefly|bing image|google imagen/i;
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

function scoreEvidence(session, ev, hist = {}, opts = {}) {
  const now = opts.now || Date.now();
  const grace = opts.graceMs == null ? 60 * 1000 : opts.graceMs;
  const reasons = [];
  const gate = (code, msg) => ({ tier: 'REJECT', score: 0, gate: code, reasons: [msg] });

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

  if (!ev.payeeVpa || norm(ev.payeeVpa) !== norm(session.payeeVpa)) {
    return gate('PAYEE_MISMATCH', 'Payee VPA does not match order payee.');
  }

  let integ = 1;
  if (ev.exifSoftware && EDITOR_HINTS.test(ev.exifSoftware)) integ -= 1;
  if (ev.exifSoftware && AI_HINTS.test(ev.exifSoftware)) integ -= 1;
  if (ev.editArtifacts) integ -= 0.5;
  if (ev.looksLikeScreenshot === false) integ -= 0.5;
  if (integ <= 0) return gate('INTEGRITY_FAILED', 'Receipt shows signs of editing or synthetic generation.');

  let score = 0;
  const add = (key, frac, why) => {
    const pts = Math.round(WEIGHTS[key] * Math.max(0, Math.min(1, frac)));
    score += pts;
    reasons.push(`${key}: ${pts}/${WEIGHTS[key]} (${why})`);
  };

  add('payee', 1, 'VPA matches order payee');
  add('layout', ev.layoutFieldsFound && ev.layoutFieldsExpected
    ? ev.layoutFieldsFound / ev.layoutFieldsExpected : 0, 'expected receipt fields present');
  add('integrity', Math.max(0, integ), 'no editor/AI traces, screenshot-shaped');

  let beh = 0;
  if (opts.sameDevice !== false) beh += 0.5;
  if ((hist.attemptsThisSession || 0) <= 1) beh += 0.25;
  if (typeof ev.submittedAt === 'number' && ev.submittedAt - session.createdAt < 5 * 60 * 1000) beh += 0.25;
  add('behavior', beh, 'same device, single attempt, prompt submission');

  add('utr', 1, 'valid 12-digit UTR');
  add('reputation', Math.min(1, (hist.priorConfirmed || 0) / 3), 'prior confirmed payments');

  const tier = score >= TIERS.HIGH ? 'HIGH' : score >= TIERS.MEDIUM ? 'MEDIUM' : 'LOW';
  return { tier, score, gate: null, reasons };
}

function suggestAction(result, amount) {
  if (result.tier === 'HIGH') return 'RELEASE_AND_RECONCILE';
  return 'DO_NOT_RELEASE';
}

module.exports = { scoreEvidence, suggestAction, WEIGHTS, TIERS };
