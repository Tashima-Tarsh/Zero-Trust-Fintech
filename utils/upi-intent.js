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
 *
 * NPCI UPI Linking Spec v1.6 compliance:
 * - mode: 04=intent (P2P), 05=secure-intent (P2M)
 * - orgid: 000000 for merchant-created intents/QR
 * - sign: optional, passthrough only (PSP-generated via SHA256+RSA512)
 * - tid: PSP-generated transaction ID (optional, from acquiring bank)
 * - mid/msid/mtid: merchant IDs (optional, from acquiring bank)
 * - mam: minimum amount for editable amount flows
 * - url: optional invoice/order URL (must be https)
 */

const crypto = require('crypto');

const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const MC_RE = /^\d{4}$/;
const TR_RE = /^[A-Za-z0-9]{1,35}$/; // P2M reference: alphanumeric, max 35
const MODE_RE = /^(00|01|02|03|04|05|06|07|08|15)$/; // NPCI mode codes
const ORGID_RE = /^\d{6}$/; // 6-digit orgid
const TID_RE = /^.{1,20}$/; // PSP-generated, max 20
const MID_RE = /^.{1,20}$/; // Merchant ID, max 20
const MSID_RE = /^.{1,20}$/; // Store ID, max 20
const MTID_RE = /^.{1,20}$/; // Terminal ID, max 20

function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(/[^A-Za-z0-9 .\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function formatAmount(am, maxAmount) {
  const n = Number(am);
  if (!Number.isFinite(n) || n <= 0) throw new Error('am must be a positive number');
  if (n > maxAmount) throw new Error('am exceeds configured max ' + maxAmount);
  const paise = n * 100;
  if (paise < 1 || Math.abs(paise - Math.round(paise)) > 1e-7)
    throw new Error('am must be at least one paisa and use at most two decimal places');
  return (Math.round(paise) / 100).toFixed(2);
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
 * @param {string} [o.url]         optional P2M invoice URL (<= 255 chars, https)
 * @param {string} [o.sign]        optional PSP-signed value, passthrough only
 * @param {number} [o.maxAmount]   default 100000
 * @param {number} [o.tnMax]       default 50
 * @param {string} [o.tid]         optional PSP-generated transaction ID (max 20)
 * @param {string} [o.mid]         optional Merchant ID (max 20)
 * @param {string} [o.msid]        optional Store ID (max 20)
 * @param {string} [o.mtid]        optional Terminal ID (max 20)
 * @param {string} [o.mam]         optional minimum amount (for editable amount)
 * @param {string} [o.mode]        optional override mode (default: 04 for P2P, 05 for P2M)
 */
function buildUpiUri(o) {
  const kind = o.kind;
  if (kind !== 'P2P' && kind !== 'P2M') throw new Error("kind must be 'P2P' or 'P2M'");

  const parts = [];
  
  // Reject malformed or absent receiving account before opening a bank app:
  // an invalid pa otherwise produces an app-side error before UPI PIN.
  const payee = String(o.pa || '').trim();
  if (!VPA_RE.test(payee)) throw new Error('A valid receiving UPI ID is required');
  parts.push('pa=' + payee);

  const pn = cleanText(o.pn, 40) || 'Payee';
  parts.push('pn=' + encodeURIComponent(pn));

  // am is sent for BOTH P2P and P2M so the unique-paise challenge amount is prefilled.
  parts.push('am=' + formatAmount(o.am, o.maxAmount || 100000));
  parts.push('cu=INR');

  const tn = cleanText(o.tn, o.tnMax || 50);
  if (tn) parts.push('tn=' + encodeURIComponent(tn));

  if (kind === 'P2P') {
    if (o.mc || o.tr || o.url || o.sign || o.tid || o.mid || o.msid || o.mtid || o.mam) {
      throw new Error('P2P must not carry mc/tr/url/sign/tid/mid/msid/mtid/mam: put the order id in tn instead');
    }
    // P2P defaults per NPCI spec
    parts.push('mode=04');        // 04 = Intent (push payment)
    parts.push('orgid=000000');   // merchant-created intent
  } else {
    // P2M validation
    if (!MC_RE.test(String(o.mc || ''))) {
      throw new Error('P2M requires the shop\'s real 4-digit mc (from the bank merchant QR)');
    }
    if (!TR_RE.test(String(o.tr || ''))) {
      throw new Error('P2M requires tr: alphanumeric, max 35 chars, unique per order');
    }
    parts.push('tr=' + o.tr);
    parts.push('mc=' + o.mc);

    // NPCI mode/orgid for P2M
    const mode = o.mode || '05';  // 05 = Secure Intent (P2M preferred by top PSPs)
    if (!MODE_RE.test(mode)) throw new Error('Invalid mode: must be 2-digit NPCI code');
    parts.push('mode=' + mode);

    const orgid = o.orgid || '000000';
    if (!ORGID_RE.test(String(orgid))) throw new Error('orgid must be 6 digits');
    parts.push('orgid=' + orgid);

    // Optional P2M params
    if (o.tid) {
      if (!TID_RE.test(String(o.tid))) throw new Error('tid max 20 chars');
      parts.push('tid=' + encodeURIComponent(String(o.tid)));
    }
    if (o.mid) {
      if (!MID_RE.test(String(o.mid))) throw new Error('mid max 20 chars');
      parts.push('mid=' + encodeURIComponent(String(o.mid)));
    }
    if (o.msid) {
      if (!MSID_RE.test(String(o.msid))) throw new Error('msid max 20 chars');
      parts.push('msid=' + encodeURIComponent(String(o.msid)));
    }
    if (o.mtid) {
      if (!MTID_RE.test(String(o.mtid))) throw new Error('mtid max 20 chars');
      parts.push('mtid=' + encodeURIComponent(String(o.mtid)));
    }
    if (o.mam) {
      const numMam = Number(o.mam);
      if (!isNaN(numMam) && numMam > 0) parts.push('mam=' + numMam.toFixed(2));
    }
    if (o.url) {
      const urlStr = String(o.url).trim();
      if (!/^https?:\/\//i.test(urlStr)) throw new Error('url must be http or https');
      parts.push('url=' + encodeURIComponent(urlStr.substring(0, 255)));
    }
    // sign is passthrough only — PSP generates via SHA256+RSA512
    if (o.sign) parts.push('sign=' + encodeURIComponent(String(o.sign)));
  }

  return 'upi://pay?' + parts.join('&');
}

/**
 * Per-app launch links from a upi://pay URI.
 * Android uses package-targeted Chrome Intent URLs.
 * iOS uses custom URL schemes.
 * Test on real devices — app schemes change.
 */
function appLinks(upiUri) {
  const q = upiUri.replace(/^upi:\/\/pay\?/, '');
  const android = (pkg) => `intent://pay?${q}#Intent;scheme=upi;package=${pkg};end`;
  
  return {
    generic: upiUri,
    android: {
      // Primary UPI apps (NPCI-verified)
      gpay: android('com.google.android.apps.nbu.paisa.user'),
      phonepe: android('com.phonepe.app'),
      paytm: android('net.one97.paytm'),
      bhim: android('in.org.npci.upiapp'),
      // Banking apps (major banks with UPI)
      axis: android('com.axis.mobile'),
      hdfc: android('com.snapwork.hdfcbank'),
      icici: android('com.icici.imobile'),
      sbi: android('com.sbi.yono'),
      kotak: android('com.kotak.mbk'),
      idfc: android('com.idfcfirstbank.mobile'),
      yes: android('com.yesbank.mobile'),
      indusind: android('com.indusind.mobile'),
      federal: android('com.federalbank.mobile'),
      rbl: android('com.rblbank.mobile'),
      // Fintech apps
      cred: android('com.cred.app'),
      amazon: android('in.amazon.mShop.android.shopping'),
      whatsapp: android('com.whatsapp'),
    },
    ios: {
      gpay: 'gpay://upi/pay?' + q,
      phonepe: 'phonepe://upi/pay?' + q,
      paytm: 'paytmmp://pay?' + q,
      bhim: 'bhim://pay?' + q,
      cred: 'credpay://upi/pay?' + q,
      amazon: 'amazon://upi/pay?' + q,
    }
  };
}

/**
 * Fallback chain for Android Chrome Intent — ensures an app opens
 * even if the primary choice isn't installed.
 * Order: GPay → PhonePe → Paytm → BHIM → Axis → HDFC → ICICI → SBI → generic
 */
function buildFallbackChain(upiUri) {
  const q = upiUri.replace(/^upi:\/\/pay\?/, '');
  const chain = [
    'com.google.android.apps.nbu.paisa.user',
    'com.phonepe.app',
    'net.one97.paytm',
    'in.org.npci.upiapp',
    'com.axis.mobile',
    'com.snapwork.hdfcbank',
    'com.icici.imobile',
    'com.sbi.yono',
  ];
  return chain.map(pkg => `intent://pay?${q}#Intent;scheme=upi;package=${pkg};end`).join(';');
}

/**
 * Android Chrome Intent with full fallback chain and browser fallback URL.
 * Uses S.browser_fallback_package for chain, S.browser_fallback_url for web fallback.
 */
function appTapLaunchUri(upiUri, userAgent, checkoutFallbackHref, app) {
  const valid = upiUri; // already validated
  const q = valid.replace(/^upi:\/\/pay\?/, '');
  
  const packages = {
    gpay: 'com.google.android.apps.nbu.paisa.user',
    phonepe: 'com.phonepe.app',
    paytm: 'net.one97.paytm',
    bhim: 'in.org.npci.upiapp',
    axis: 'com.axis.mobile',
    hdfc: 'com.snapwork.hdfcbank',
    icici: 'com.icici.imobile',
    sbi: 'com.sbi.yono',
  };
  
  const pkg = packages[app];
  if (!pkg) throw new Error('Unsupported UPI app');
  
  // Targeted intent works on ALL Android browsers except WebView
  const ua = String(userAgent || '');
  const isAndroid = /Android/i.test(ua);
  const isWebView = /(?:;|\s)wv(?:\)|;|\s)|\bVersion\/4\.0\b/i.test(ua);
  if (!isAndroid || isWebView) return valid;
  
  const fallbackUrl = (() => {
    try {
      const page = new URL(checkoutFallbackHref);
      if (page.protocol !== 'https:' && page.protocol !== 'http:') return '';
      page.hash = '';
      page.searchParams.set('upi_intent_fallback', '1');
      return page.href;
    } catch (_) { return ''; }
  })();
  
  const fallbackChain = Object.values(packages).join(';');
  
  return 'intent://pay?' + q +
    '#Intent;scheme=upi;action=android.intent.action.VIEW;package=' + pkg + ';' +
    (fallbackUrl ? 'S.browser_fallback_url=' + encodeURIComponent(fallbackUrl) + ';' : '') +
    'S.browser_fallback_package=' + encodeURIComponent(fallbackChain) + ';end';
}

/**
 * QR Tap Launch — generic for non-Chrome, targeted for Chrome Android.
 * Returns targeted intent with fallback chain on Chrome Android.
 */
function qrTapLaunchUri(upiUri, userAgent, checkoutFallbackHref) {
  const valid = upiUri;
  const q = valid.replace(/^upi:\/\/pay\?/, '');
  
  const ua = String(userAgent || '');
  const isChromeAndroid = /Android/i.test(ua) && /Chrome\/\d+/i.test(ua);
  const isWebView = /(?:;|\s)wv(?:\)|;|\s)|\bVersion\/4\.0\b/i.test(ua);
  
  if (!isChromeAndroid || isWebView) return valid;
  
  const fallbackUrl = (() => {
    try {
      const page = new URL(checkoutFallbackHref);
      if (page.protocol !== 'https:' && page.protocol !== 'http:') return '';
      page.hash = '';
      page.searchParams.set('upi_intent_fallback', '1');
      return page.href;
    } catch (_) { return ''; }
  })();
  
  const fallbackChain = [
    'com.google.android.apps.nbu.paisa.user',
    'com.phonepe.app',
    'net.one97.paytm',
    'in.org.npci.upiapp',
    'com.axis.mobile',
    'com.snapwork.hdfcbank',
    'com.icici.imobile',
    'com.sbi.yono',
  ].join(';');
  
  return 'intent://pay?' + q +
    '#Intent;scheme=upi;action=android.intent.action.VIEW;' +
    (fallbackUrl ? 'S.browser_fallback_url=' + encodeURIComponent(fallbackUrl) + ';' : '') +
    'S.browser_fallback_package=' + encodeURIComponent(fallbackChain) + ';end';
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

/**
 * Sign a UPI intent string with merchant's private key (SHA256+RSA512).
 * Returns base64-encoded signature. Use ONLY if you have the private key.
 * The intent string passed MUST NOT include '&sign='.
 * 
 * @param {string} intentString  e.g., 'upi://pay?pa=...&pn=...&am=...&mode=05&orgid=000000'
 * @param {string} privateKeyPem  PEM-encoded RSA private key (PKCS#1 or PKCS#8)
 * @returns {string} base64 signature
 */
function signUpiIntent(intentString, privateKeyPem) {
  const sign = crypto.createSign('SHA256');
  sign.update(intentString);
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

/**
 * Verify a signed UPI intent (for testing/validation).
 * @param {string} intentString  without '&sign='
 * @param {string} signature  base64 signature
 * @param {string} publicKeyPem  PEM-encoded RSA public key
 * @returns {boolean}
 */
function verifyUpiIntent(intentString, signature, publicKeyPem) {
  const verify = crypto.createVerify('SHA256');
  verify.update(intentString);
  verify.end();
  return verify.verify(publicKeyPem, signature, 'base64');
}

module.exports = {
  buildUpiUri,
  appLinks,
  appTapLaunchUri,
  qrTapLaunchUri,
  buildFallbackChain,
  generateChallengeAmount,
  signUpiIntent,
  verifyUpiIntent,
  VPA_RE,
  MC_RE,
  TR_RE,
  MODE_RE,
  ORGID_RE,
};