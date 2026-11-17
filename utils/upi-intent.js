'use strict';
/**
 * upi-intent.js — P2P and P2M UPI intent URI builders for a self-hosted,
 * non-custodial checkout. Replaces buildNPCIIntentUri() in npci-intent.js.
 *
 * P2P: personal VPA. Params: pa, pn, am, cu, tn. Never sends mc/tr.
 * P2M: merchant VPA issued by the shop's own bank. Needs the shop's real
 *      4-digit mc (copy it from the bank's merchant QR) and a tr.
 *
 * Important: this code cannot make a VPA a merchant. If you send P2M params
 * for a VPA that is not merchant-registered, the app or bank may decline it
 * before PIN. `sign` can only be passed through if a PSP signed the intent;
 * you cannot generate it yourself.
 */

const crypto = require('crypto');

const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const MC_RE = /^\d{4}$/;
const TR_RE = /^[A-Za-z0-9]{1,35}$/; // P2M reference: alphanumeric, max 35

function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(/[^A-Za-z0-9 .\-]/g, ' ') // conservative: letters, digits, space . -
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function formatAmount(am, maxAmount) {
  const n = Number(am);
  if (!Number.isFinite(n) || n <= 0) throw new Error('am must be a positive number');
  if (n > maxAmount) throw new Error('am exceeds configured max ' + maxAmount);
  return n.toFixed(2);
}

/**
 * @param {object} o
 * @param {'P2P'|'P2M'} o.kind
 * @param {string} o.pa            payee VPA
 * @param {string} o.pn            payee display name
 * @param {number|string} o.am     amount in rupees
 * @param {string} [o.tn]          note (default max 50 chars; configurable)
 * @param {string} [o.mc]          REQUIRED for P2M, forbidden for P2P
 * @param {string} [o.tr]          REQUIRED for P2M, forbidden for P2P
 * @param {string} [o.url]         optional P2M invoice URL (<= 255 chars)
 * @param {string} [o.sign]        optional PSP-signed value, passthrough only
 * @param {number} [o.maxAmount]   default 100000
 * @param {number} [o.tnMax]       default 50
 */
function buildUpiUri(o) {
  const kind = o.kind;
  if (kind !== 'P2P' && kind !== 'P2M') throw new Error("kind must be 'P2P' or 'P2M'");

  const parts = [];
  const pa = encodeURIComponent(o.pa || '');
  parts.push('pa=' + pa);
  const pn = cleanText(o.pn, 40) || 'Payee';
  parts.push('pn=' + encodeURIComponent(pn));

  // am is sent for BOTH P2P and P2M so the unique-paise challenge amount is prefilled.
  parts.push('am=' + formatAmount(o.am, o.maxAmount || 100000));
  parts.push('cu=INR');

  const tn = cleanText(o.tn, o.tnMax || 50);
  if (tn) parts.push('tn=' + encodeURIComponent(tn));

  if (kind === 'P2P') {
    if (o.mc || o.tr || o.url || o.sign) {
      throw new Error('P2P must not carry mc/tr/url/sign: put the order id in tn instead');
    }
  } else {
    if (!MC_RE.test(String(o.mc || ''))) {
      throw new Error('P2M requires the shop\'s real 4-digit mc (from the bank merchant QR)');
    }
    if (!TR_RE.test(String(o.tr || ''))) {
      throw new Error('P2M requires tr: alphanumeric, max 35 chars, unique per order');
    }
    parts.push('tr=' + o.tr);
    parts.push('mc=' + o.mc);
    if (o.mode) parts.push('mode=' + String(o.mode).substring(0, 2));
    if (o.orgid) parts.push('orgid=' + encodeURIComponent(String(o.orgid).substring(0, 6)));
    if (o.tid) parts.push('tid=' + encodeURIComponent(String(o.tid).substring(0, 20)));
    if (o.mid) parts.push('mid=' + encodeURIComponent(String(o.mid).substring(0, 20)));
    if (o.msid) parts.push('msid=' + encodeURIComponent(String(o.msid).substring(0, 20)));
    if (o.mtid) parts.push('mtid=' + encodeURIComponent(String(o.mtid).substring(0, 20)));
    if (o.mam) {
      const numMam = Number(o.mam);
      if (!isNaN(numMam) && numMam > 0) parts.push('mam=' + numMam.toFixed(2));
    }
    if (o.url) parts.push('url=' + encodeURIComponent(String(o.url).substring(0, 255)));
    if (o.sign) parts.push('sign=' + encodeURIComponent(String(o.sign)));
  }

  return 'upi://pay?' + parts.join('&');
}

/**
 * Per-app launch links from a upi://pay URI. iOS has no reliable generic
 * upi:// handling; Android can use the generic link or a package-targeted
 * intent. Test these on real devices: app schemes change.
 */
function appLinks(upiUri) {
  const q = upiUri.replace(/^upi:\/\/pay\?/, '');
  const android = (pkg) => `intent://pay?${q}#Intent;scheme=upi;package=${pkg};end`;
  return {
    generic: upiUri,
    android: {
      gpay: android('com.google.android.apps.nbu.paisa.user'),
      phonepe: android('com.phonepe.app'),
      paytm: android('net.one97.paytm')
    },
    ios: {
      gpay: 'gpay://upi/pay?' + q,
      phonepe: 'phonepe://pay?' + q,
      paytm: 'paytmmp://pay?' + q
    }
  };
}

/**
 * Unique-paise challenge. Uses crypto.randomInt and avoids cents already in
 * use by ACTIVE sessions with the same base amount, so two live orders never
 * share an exact amount. Cents 11–99 except multiples of 5 and 10.
 * @param {number} baseAmount
 * @param {Set<number>} activeAmounts  challenge amounts of live sessions
 */
function generateChallengeAmount(baseAmount, activeAmounts = new Set()) {
  const baseCents = Math.round(Number(baseAmount) * 100);
  if (!Number.isFinite(baseCents) || baseCents <= 0) throw new Error('bad base amount');
  const free = [];
  for (let c = 11; c <= 99; c++) {
    if (c % 10 === 0 || c % 5 === 0) continue;
    const amt = Number(((baseCents + c) / 100).toFixed(2));
    if (!activeAmounts.has(amt)) free.push(c);
  }
  if (free.length === 0) throw new Error('no free challenge amount: too many live sessions for this base');
  const cents = free[crypto.randomInt(0, free.length)];
  return Number(((baseCents + cents) / 100).toFixed(2));
}

module.exports = { buildUpiUri, appLinks, generateChallengeAmount, VPA_RE };
