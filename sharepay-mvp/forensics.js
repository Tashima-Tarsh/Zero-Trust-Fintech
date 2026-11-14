/**
 * SharePay Forensic Receipt Analyzer & NPCI UTR Decoder
 * 
 * Implements deterministic mathematical timestamp verification for Indian UPI UTRs
 * and multi-format regex extraction across Google Pay, PhonePe, Paytm, BHIM, and CRED.
 */

/**
 * Converts a UTC timestamp into IST (Indian Standard Time, UTC+5:30)
 */
export function getISTDate(timestamp = Date.now()) {
  const date = new Date(timestamp);
  // IST offset is +5.5 hours = +19,800,000 ms
  const utcMillis = date.getTime() + (date.getTimezoneOffset() * 60 * 1000);
  const istMillis = utcMillis + (5.5 * 60 * 60 * 1000);
  return new Date(istMillis);
}

/**
 * Computes the Julian Day of the year (1 - 366) in IST
 */
export function getJulianDay(istDate) {
  const startOfYear = new Date(istDate.getFullYear(), 0, 1);
  return Math.floor((istDate - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Decodes the timestamp encoded in a 12-digit NPCI UPI UTR (RRN).
 * Format: Y DDD HH NNNNNN
 * - Y: Last digit of year (e.g. 6 for 2026)
 * - DDD: Julian Day of the year (001 - 366)
 * - HH: Hour in IST (00 - 23)
 * - NNNNNN: 6-digit sequence
 */
export function decodeUtr(utr) {
  if (typeof utr !== 'string' || !/^\d{12}$/.test(utr)) {
    return null;
  }

  const yearDigit = parseInt(utr[0], 10);
  const julianDay = parseInt(utr.substring(1, 4), 10);
  const hour = parseInt(utr.substring(4, 6), 10);
  const sequence = utr.substring(6, 12);

  if (julianDay < 1 || julianDay > 366 || hour < 0 || hour > 23) {
    return null;
  }

  return {
    yearDigit,
    julianDay,
    hour,
    sequence,
    raw: utr
  };
}

/**
 * Verifies whether a UTR was generated freshly within the permitted sliding time window.
 * Blocks all receipts from yesterday, last month, or older hours today.
 */
export function verifyUtrFreshness(utr, nowTimestamp = Date.now(), maxHourSkew = 1) {
  const decoded = decodeUtr(utr);
  if (!decoded) {
    return { valid: false, reason: 'INVALID_UTR_FORMAT' };
  }

  const istNow = getISTDate(nowTimestamp);
  const currentYearDigit = istNow.getFullYear() % 10;
  const currentJulianDay = getJulianDay(istNow);
  const currentHour = istNow.getHours();

  // 1. Year digit match
  if (decoded.yearDigit !== currentYearDigit) {
    return { 
      valid: false, 
      reason: 'STALE_UTR_YEAR_MISMATCH', 
      details: { expectedYearDigit: currentYearDigit, utrYearDigit: decoded.yearDigit } 
    };
  }

  // 2. Julian day match (with allowance for midnight rollover within maxHourSkew)
  const isToday = decoded.julianDay === currentJulianDay;
  const isYesterday = (currentJulianDay - decoded.julianDay === 1) || 
                      (currentJulianDay === 1 && decoded.julianDay >= 365); // New year rollover

  if (!isToday && !isYesterday) {
    return { 
      valid: false, 
      reason: 'STALE_UTR_DATE_MISMATCH', 
      details: { expectedJulianDay: currentJulianDay, utrJulianDay: decoded.julianDay } 
    };
  }

  // 3. Hour window check
  let hourDiff;
  if (isToday) {
    hourDiff = currentHour - decoded.hour;
  } else {
    // Yesterday: e.g. UTR at 23h, current hour is 0h -> hourDiff = 1
    hourDiff = (currentHour + 24) - decoded.hour;
  }

  // Reject future timestamps or timestamps older than maxHourSkew
  if (hourDiff < 0) {
    return { valid: false, reason: 'FUTURE_UTR_TIMESTAMP', details: { hourDiff } };
  }
  if (hourDiff > maxHourSkew) {
    return { 
      valid: false, 
      reason: 'STALE_UTR_HOURLY_WINDOW_EXPIRED', 
      details: { currentHour, utrHour: decoded.hour, hourDiff } 
    };
  }

  return { valid: true, decoded };
}

/**
 * Extracts structured data from shared receipt text across various UPI apps
 */
export function extractReceiptData(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { utr: null, amount: null, note: null };
  }

  const text = rawText.trim();

  // 1. Extract UTR (12 digits)
  // Supports PhonePe ("Reference ID: ..."), Google Pay ("UPI transaction ID: ..."), 
  // Paytm ("UPI Ref: ..."), CRED ("UTR: ..."), BHIM ("RRN: ..."), and Bank SMS
  let utr = null;
  const labeledUtrMatch = text.match(/(?:UTR|Ref(?:erence)?\s*(?:No|Number|ID)?|UPI\s*(?:Transaction\s*ID|Ref\s*No)?|RRN|Txn\s*(?:ID|Ref|No)?|Payment\s*ID)[\s:=-]+([0-9]{12})\b/i);
  if (labeledUtrMatch) {
    utr = labeledUtrMatch[1];
  } else {
    const standaloneMatch = text.match(/\b\d{12}\b/);
    if (standaloneMatch) {
      utr = standaloneMatch[0];
    }
  }

  // 2. Extract Amount
  // Matches "₹ 100.37", "₹100.37", "Rs. 100.37", "Rs 100.37", "INR 100.37", "Paid 100.37", "Payment of ₹100.37"
  let amount = null;
  const amountMatch = text.match(/(?:(?:₹|Rs\.?|INR)\s*|paid\s+|payment\s+of\s+(?:₹|Rs\.?|INR)?\s*|amount\s*:?\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
                      text.match(/\b([0-9,]+\.[0-9]{2})\b/);
  if (amountMatch) {
    const cleanNum = amountMatch[1].replace(/,/g, '');
    amount = parseFloat(cleanNum);
  }

  // 3. Extract Transaction Note / Order ID
  // e.g. "Order_99X_7f3a" or "Note: Order_..." or "Remarks: Order_..."
  let note = null;
  const noteMatch = text.match(/\b(Order_[A-Za-z0-9_-]+)\b/i) ||
                    text.match(/(?:Note|Remarks?|Ref|For)[\s:=-]+([A-Za-z0-9_-]+)/i);
  if (noteMatch) {
    note = noteMatch[1];
  }

  return { utr, amount, note, raw: text };
}

/**
 * Generates a valid NPCI-compliant synthetic UTR for current time (used in tests and valid simulations)
 */
export function generateCurrentUtr(timestamp = Date.now(), sequence = Math.floor(Math.random() * 900000 + 100000)) {
  const istNow = getISTDate(timestamp);
  const yearDigit = istNow.getFullYear() % 10;
  const julianDay = String(getJulianDay(istNow)).padStart(3, '0');
  const hour = String(istNow.getHours()).padStart(2, '0');
  const seq = String(sequence).padStart(6, '0');
  return `${yearDigit}${julianDay}${hour}${seq}`;
}
