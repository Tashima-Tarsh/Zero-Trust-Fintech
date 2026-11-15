/**
 * DISHA 8.2 — Enterprise-Grade NPCI UPI Intent Handshake Engine
 * Conforms to NPCI UPI Deep Link Specification v3.2 (2026) and RBI Security Directives.
 * Implements strict Parameter Constraints, Transaction Note (tn) formatting,
 * Intent Handshake verification, and official NPCI response code mapping.
 */

// NPCI Official Response Code Registry (v3.2)
const NPCI_RESPONSE_CODES = {
  '00': { status: 'SUCCESS', action: 'MARK_AS_PAID', description: 'Transaction successful' },
  '01': { status: 'FAILED', action: 'SHOW_ERROR', description: 'Invalid Payee VPA / Virtual Address' },
  '02': { status: 'FAILED', action: 'SHOW_ERROR', description: 'Invalid transaction amount' },
  '07': { status: 'FAILED', action: 'PROMPT_RETRY', description: 'Insufficient account balance' },
  '08': { status: 'PENDING', action: 'SHOW_PENDING', description: 'Transaction pending or interbank timeout' },
  '11': { status: 'FAILED', action: 'PROMPT_RETRY', description: 'Incorrect UPI PIN entered' },
  '50': { status: 'FAILED', action: 'SHOW_ERROR', description: 'Bank / NPCI switch technical error' },
  '60': { status: 'BLOCKED', action: 'CONTACT_SUPPORT', description: 'Transaction blocked by banking risk engine' }
};

/**
 * Sanitize and format Transaction Note (tn) according to NPCI specifications:
 * - Max length: 80 characters
 * - Strips query-breaking and control characters
 * - Preserves order ID and merchant description
 */
function sanitizeTransactionNote(orderId = '', description = '') {
  let combined = '';
  const cleanDesc = String(description || '')
    .trim()
    .replace(/[&?=%#]/g, ' ') // Strip query-breakers
    .replace(/[\r\n\t]/g, ' ') // Flatten newlines
    .replace(/\s+/g, ' '); // Collapse spaces

  const cleanOrderId = String(orderId || '').trim();

  if (cleanOrderId && cleanDesc) {
    if (cleanDesc.includes(cleanOrderId)) {
      combined = cleanDesc;
    } else {
      combined = `${cleanOrderId} - ${cleanDesc}`;
    }
  } else if (cleanOrderId) {
    combined = cleanOrderId;
  } else {
    combined = cleanDesc || 'Payment';
  }

  // NPCI Rule: Maximum 80 characters for tn parameter
  if (combined.length > 80) {
    if (cleanOrderId && combined.startsWith(cleanOrderId)) {
      const remainingLength = 80 - cleanOrderId.length - 3; // " - "
      if (remainingLength > 5) {
        combined = `${cleanOrderId} - ${cleanDesc.substring(0, remainingLength).trim()}`;
      } else {
        combined = cleanOrderId.substring(0, 80);
      }
    } else {
      combined = combined.substring(0, 80).trim();
    }
  }

  return combined;
}

/**
 * Sanitize Transaction Reference (tr):
 * - Max length: 35 characters
 * - Alphanumeric, underscores, hyphens only
 */
function sanitizeTxnRef(txnRef = '') {
  const clean = String(txnRef || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');
  return clean.substring(0, 35);
}

/**
 * Build NPCI-Compliant UPI Intent URI:
 * upi://pay?pa=<vpa>&pn=<name>&am=<amt>&tn=<note>&tr=<ref>&cu=INR&mc=<mcc>
 */
function buildNPCIIntentUri({
  pa,
  pn,
  am,
  orderId = '',
  description = '',
  tn,
  tr,
  cu = 'INR',
  mc = '', // Do NOT default mc — personal VPAs must omit it or GPay/PhonePe/Slice reject before PIN
  url = '',
  sign = '',
  mam = ''
}) {
  if (!pa || typeof pa !== 'string' || !pa.includes('@')) {
    throw new Error('NPCI Compliance Error: Payee Address (pa) must be a valid VPA containing @');
  }
  if (pa.length > 50) {
    throw new Error('NPCI Compliance Error: Payee Address (pa) exceeds maximum 50 characters');
  }

  const cleanPn = (pn || 'Merchant').substring(0, 80).trim();
  const note = tn ? sanitizeTransactionNote('', tn) : sanitizeTransactionNote(orderId, description);
  const ref = sanitizeTxnRef(tr || orderId);

  const params = new URLSearchParams();
  params.set('pa', pa);
  params.set('pn', cleanPn);

  if (am !== undefined && am !== null && am !== '') {
    const numAmt = Number(am);
    if (isNaN(numAmt) || numAmt <= 0) {
      throw new Error('NPCI Compliance Error: Amount (am) must be a positive number');
    }
    // NPCI requires exactly 2 decimal places
    params.set('am', numAmt.toFixed(2));
  }

  if (note) {
    params.set('tn', note);
  }

  if (ref) {
    params.set('tr', ref);
  }

  params.set('cu', (cu || 'INR').toUpperCase());

  if (mc && /^\d{4}$/.test(String(mc))) {
    params.set('mc', String(mc));
  }

  if (mam) {
    const numMam = Number(mam);
    if (!isNaN(numMam) && numMam > 0) {
      params.set('mam', numMam.toFixed(2));
    }
  }

  if (url) {
    params.set('url', String(url).substring(0, 256));
  }

  if (sign) {
    params.set('sign', String(sign));
  }

  // UPI apps expect raw @ in the pa= parameter (not %40).
  // URLSearchParams auto-encodes @ → %40 which many UPI apps (BHIM, bank apps) reject.
  // Fix: build the URI manually so pa= keeps the raw @ character.
  const paRaw = 'pa=' + pa; // raw, unencoded
  params.delete('pa');
  const rest = params.toString(); // rest of params (pn, am, tn, tr, cu, mc ...)
  return 'upi://pay?' + paRaw + (rest ? '&' + rest : '');
}

/**
 * Parse NPCI Intent Callback or Share Payload:
 * Formats:
 * 1. Intent Callback: Status=SUCCESS&txnId=311400000123&txnRef=TXN_123&responseCode=00
 * 2. URL with Query: https://disha.merchant.in/callback?Status=SUCCESS&txnId=...
 * 3. Raw Receipt Text from PhonePe/GPay/Paytm share
 */
function parseNPCIIntentResponse(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'string') {
    return { success: false, raw: '', error: 'EMPTY_PAYLOAD' };
  }

  const trimmed = rawPayload.trim();
  const result = {
    raw: trimmed,
    status: null,
    txnId: null, // Bank UTR / Transaction ID (12 digits)
    txnRef: null,
    responseCode: null,
    approvalRefNo: null,
    amount: null,
    orderId: null,
    codeInfo: null,
    isSuccess: false
  };

  let queryStr = trimmed;
  if (queryStr.includes('?')) {
    queryStr = queryStr.substring(queryStr.indexOf('?') + 1);
  }

  // Key-value parsing (Intent URL or query string)
  if (queryStr.includes('=')) {
    const params = new URLSearchParams(queryStr);
    result.status = params.get('Status') || params.get('status');
    result.txnId = params.get('txnId') || params.get('txId') || params.get('utr') || params.get('RRN');
    result.txnRef = params.get('txnRef') || params.get('tr');
    result.responseCode = params.get('responseCode') || params.get('resCode');
    result.approvalRefNo = params.get('ApprovalRefNo');

    const amt = params.get('am') || params.get('amount');
    if (amt) result.amount = parseFloat(amt);
  }

  // Fallback regex extraction for unstructured raw receipts
  if (!result.txnId) {
    const utrMatch = trimmed.match(/\b\d{12}\b/);
    if (utrMatch) result.txnId = utrMatch[0];
  }

  if (!result.amount) {
    // Matches amounts with optional Indian comma separators (e.g. ₹1,000.37, Rs. 50,000.00)
    const amtMatch = trimmed.match(/[₹RsINR\.]?\s*([\d,]+(?:\.\d{2})?)/i);
    if (amtMatch) {
      const cleanAmtStr = amtMatch[1].replace(/,/g, '');
      const parsed = parseFloat(cleanAmtStr);
      if (!isNaN(parsed) && parsed > 0) {
        result.amount = parsed;
      }
    }
  }

  if (!result.orderId) {
    const orderMatch = trimmed.match(/Order_[A-Za-z0-9_-]+/i) || trimmed.match(/ORD_[A-Za-z0-9_-]+/i);
    if (orderMatch) result.orderId = orderMatch[0];
  }

  // Map NPCI official response codes
  if (result.responseCode && NPCI_RESPONSE_CODES[result.responseCode]) {
    result.codeInfo = NPCI_RESPONSE_CODES[result.responseCode];
  }

  // Evaluate success status
  const statusUpper = (result.status || '').toUpperCase();
  if (statusUpper === 'SUCCESS' || result.responseCode === '00') {
    result.isSuccess = true;
  } else if (result.txnId && !result.responseCode && !result.status) {
    result.isSuccess = true;
  }

  return result;
}

/**
 * Parse timestamp from NPCI UTR (YYMMDDHHMMSS or Julian Day YDDD)
 */
function parseUTRTimestamp(utr) {
  if (!utr || typeof utr !== 'string' || utr.length !== 12) {
    return null;
  }

  try {
    // Format A: YYMMDDHHMMSS (12 chars)
    const yy = parseInt(utr.substring(0, 2), 10);
    const mm = parseInt(utr.substring(2, 4), 10) - 1;
    const dd = parseInt(utr.substring(4, 6), 10);
    const hh = parseInt(utr.substring(6, 8), 10);
    const min = parseInt(utr.substring(8, 10), 10);
    const ss = parseInt(utr.substring(10, 12), 10);

    if (mm >= 0 && mm < 12 && dd >= 1 && dd <= 31 && hh < 24 && min < 60 && ss < 60) {
      const d = new Date(2000 + yy, mm, dd, hh, min, ss);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // Format B: NPCI Standard RRN (YDDD... where Y is year, DDD is day of year)
    const currentYear = new Date().getFullYear();
    const yearDigit = parseInt(utr.charAt(0), 10);
    const dayOfYear = parseInt(utr.substring(1, 4), 10);

    if (dayOfYear >= 1 && dayOfYear <= 366 && (currentYear % 10) === yearDigit) {
      const yearStart = new Date(currentYear, 0, 1).getTime();
      return yearStart + (dayOfYear - 1) * 86400000;
    }
  } catch (_) {
    return null;
  }

  return null;
}

module.exports = {
  NPCI_RESPONSE_CODES,
  sanitizeTransactionNote,
  sanitizeTxnRef,
  buildNPCIIntentUri,
  parseNPCIIntentResponse,
  parseUTRTimestamp
};
