import { database } from './database.js';
import { extractReceiptData, verifyUtrFreshness } from './forensics.js';

/**
 * 5-Layer Zero-Trust Forensic Verification Pipeline
 */
export function executeVerificationPipeline({ rawReceipt, sessionToken, orderId, expectedAmount, clientNow = Date.now() }) {
  // Step 1: Extract receipt data across GPay, PhonePe, Paytm, BHIM, CRED
  const extracted = extractReceiptData(rawReceipt);
  const { utr, amount: parsedAmount, note } = extracted;

  if (!utr || parsedAmount === null) {
    database.recordRejection(orderId, utr, parsedAmount, rawReceipt, 'PARSE_ERROR', clientNow);
    return { success: false, reason: 'PARSE_ERROR', details: 'Could not extract valid 12-digit UTR or amount' };
  }

  // Step 2: Session and Order Resolution
  let order = null;
  if (orderId) {
    order = database.getOrder(orderId);
  } else if (sessionToken) {
    order = database.findActiveOrderBySession(sessionToken, clientNow);
  } else if (parsedAmount) {
    order = database.findActiveOrderByAmount(parsedAmount, clientNow);
  }

  if (!order) {
    database.recordRejection(null, utr, parsedAmount, rawReceipt, 'NO_MATCHING_ORDER', clientNow);
    return { success: false, reason: 'NO_MATCHING_ORDER', details: 'No active session or pending order matches receipt' };
  }

  // Step 3: Session Expiry Check (3-minute hard window)
  if (clientNow > order.expires_at || order.status !== 'PENDING') {
    const reason = order.status === 'SUCCESS' ? 'ORDER_ALREADY_SETTLED' : 'SESSION_EXPIRED';
    database.recordRejection(order.id, utr, parsedAmount, rawReceipt, reason, clientNow);
    return { success: false, reason, orderId: order.id, details: 'Order session window has expired' };
  }

  // Step 4: Amount Match (Challenge Amount - Paise Resolution)
  const amountDiff = Math.abs(parsedAmount - order.amount);
  if (amountDiff > 0.009) {
    database.recordRejection(order.id, utr, parsedAmount, rawReceipt, 'AMOUNT_MISMATCH', clientNow);
    return { 
      success: false, 
      reason: 'AMOUNT_MISMATCH', 
      orderId: order.id,
      details: { expected: order.amount, received: parsedAmount } 
    };
  }

  // Step 5: Transaction Note Match (Opportunistic if present in receipt)
  if (note && note !== order.id) {
    database.recordRejection(order.id, utr, parsedAmount, rawReceipt, 'NOTE_MISMATCH', clientNow);
    return { 
      success: false, 
      reason: 'NOTE_MISMATCH', 
      orderId: order.id, 
      details: { expected: order.id, received: note } 
    };
  }

  // Step 6: NPCI UTR Timestamp Freshness Check (YDDDHH Julian Day & Hour validation)
  const freshness = verifyUtrFreshness(utr, clientNow, 1);
  if (!freshness.valid) {
    database.recordRejection(order.id, utr, parsedAmount, rawReceipt, freshness.reason, clientNow);
    return { 
      success: false, 
      reason: freshness.reason, 
      orderId: order.id, 
      details: freshness.details || 'UTR timestamp is outside fresh sliding window' 
    };
  }

  // Step 7: Checkpoint Table Deduplication (Replay Protection)
  if (database.isUtrProcessed(utr)) {
    database.recordRejection(order.id, utr, parsedAmount, rawReceipt, 'UTR_ALREADY_USED', clientNow);
    return { success: false, reason: 'UTR_ALREADY_USED', orderId: order.id, details: 'UTR has already been settled previously' };
  }

  // ALL CHECKS PASSED: Commit atomically to database checkpoint
  database.recordSuccess(order.id, utr, parsedAmount, rawReceipt, clientNow);

  return {
    success: true,
    orderId: order.id,
    utr,
    amount: parsedAmount,
    verifiedAt: clientNow
  };
}
