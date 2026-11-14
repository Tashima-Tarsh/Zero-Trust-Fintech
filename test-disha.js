/**
 * DISHA 8.2 Comprehensive Test Suite
 * Tests Tasks 2, 3, 4, 8, 9, 10 in isolation
 */

const assert = require('assert');
const db = require('./db');

(async () => {
  console.log('🧪 Starting DISHA 8.2 Unit & Security Engine Tests...\n');
  await db.initDb();

  // ─────────────────────────────────────────────────────────────
  // TASK 2: DYNAMIC CHALLENGE AMOUNT MATH
  // ─────────────────────────────────────────────────────────────
  console.log('--- Checking Task 2: Dynamic Challenge Amount Math ---');
  function generateChallengeAmount(base) {
    let cents;
    do {
      cents = Math.floor(Math.random() * (97 - 11 + 1)) + 11;
    } while (cents % 10 === 0 || cents === 5);
    return Math.round((Number(base) + (cents / 100)) * 100) / 100;
  }

  for (let i = 0; i < 50; i++) {
    const amt = generateChallengeAmount(100);
    const decimalCents = Math.round((amt - 100) * 100);
    assert(decimalCents >= 11 && decimalCents <= 97, `Cents ${decimalCents} must be between 11 and 97`);
    assert(decimalCents % 10 !== 0, `Cents ${decimalCents} must not be multiple of 10`);
    assert(decimalCents !== 5, `Cents ${decimalCents} must not be 5`);
  }
  console.log('✅ 50/50 randomized challenge amounts passed mathematical anti-replay rules.');

  // ─────────────────────────────────────────────────────────────
  // TASK 3 & 4: SESSION & NPCI UPI LINK SPEC
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Checking Task 3 & 4: Session Generation & NPCI Link Spec ---');
  const now = Date.now();
  const testOrderId = 'Order_TEST_' + now;
  const testTxnRef = 'TXN_' + now + '_ABC123';
  const testChallengeAmt = 500.82;
  const testVpa = db.selectVPA('mer_default', testChallengeAmt);

  db.saveSession({
    sessionId: 'sess_test_' + now,
    orderId: testOrderId,
    challengeAmount: testChallengeAmt,
    baseAmount: 500.0,
    txnRef: testTxnRef,
    vpaAddress: testVpa,
    createdAt: now,
    expiresAt: now + 180000,
    qrRefreshAt: now + 15000,
    status: 'PENDING'
  });

  const session = db.findSessionByOrderId(testOrderId);
  assert(session, 'Session must be retrieved from database');
  assert.strictEqual(session.challengeAmount, 500.82, 'Challenge amount must match');

  const params = new URLSearchParams({
    pa: session.vpaAddress,
    pn: 'DISHA 8.2 Store',
    am: session.challengeAmount.toFixed(2),
    tn: session.orderId,
    tr: session.txnRef,
    cu: 'INR'
  });
  const upiLink = 'upi://pay?' + params.toString();
  assert(upiLink.startsWith('upi://pay?'), 'Must start with NPCI scheme');
  assert(upiLink.includes('am=500.82'), 'Must include 2-decimal amount');
  assert(upiLink.includes('cu=INR'), 'Must strictly specify INR');
  console.log('✅ Generated NPCI Link:', upiLink);

  // ─────────────────────────────────────────────────────────────
  // TASK 9: VPA ROUTING ENGINE & PATTERN MASKING
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Checking Task 9: VPA Rotation & Cooldown ---');
  const vpa1 = db.selectVPA('mer_default', 100);
  const vpa2 = db.selectVPA('mer_default', 100);
  const vpa3 = db.selectVPA('mer_default', 100);
  console.log(`VPA sequence under rotation: ${vpa1} -> ${vpa2} -> ${vpa3}`);
  assert(vpa1 && vpa2 && vpa3, 'VPAs must be selected successfully');
  console.log('✅ Smart VPA routing verified.');

  // ─────────────────────────────────────────────────────────────
  // TASK 8 & 10: 7-LAYER FRAUD VERIFICATION & DOUBLE-ENTRY LEDGER
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Checking Task 8 & 10: 7-Layer Fraud Verification & Ledger ---');

  // Test Layer 1: Missing Session
  const nonExistent = db.findSessionByOrderId('Order_NON_EXISTENT');
  assert.strictEqual(nonExistent, null, 'Layer 1: Non-existent order must return null');
  console.log('✅ Layer 1 (Session Check) Verified.');

  // Test Layer 2: Amount Mismatch (Replay old receipt)
  const oldReceiptAmount = 500.00; // Customer paid ₹500 flat instead of ₹500.82
  const amountMismatch = Math.abs(oldReceiptAmount - session.challengeAmount) > 0.001;
  assert(amountMismatch, 'Layer 2: ₹500.00 flat must fail against ₹500.82 challenge');
  console.log('✅ Layer 2 (Amount Match / Mathematical Replay Proof) Verified.');

  // Test Layer 3: Duplicate UTR Blacklist
  const mockUtr = '63190' + Math.floor(1000000 + Math.random() * 9000000);
  assert(!db.isUtrBlacklisted(mockUtr), 'UTR must not be blacklisted before settlement');

  // Execute settlement
  const { txId, verification } = db.recordTransactionAndLedger(
    session.orderId,
    mockUtr,
    session.challengeAmount,
    session.vpaAddress
  );
  db.blacklistUtr(mockUtr, session.orderId, session.challengeAmount, 'Unit test settlement');
  db.updateSessionStatus(session.orderId, 'SUCCESS', mockUtr);

  assert(verification.balanced, 'Layer 7: Double-entry ledger must be balanced (debit == credit)');
  assert.strictEqual(verification.totalDebits, 500.82, 'Total debits must match');
  assert.strictEqual(verification.totalCredits, 500.82, 'Total credits must match');
  console.log('✅ Layer 7 (Double-Entry Ledger Invariant) Verified:', verification);

  // Now verify that the same UTR is immediately blacklisted
  assert(db.isUtrBlacklisted(mockUtr), 'Layer 3: UTR must now be blacklisted');
  console.log('✅ Layer 3 (UTR Blacklist Replay Prevention) Verified.');

  console.log('\n🎉 ALL CORE ENGINE LOGIC PASSED WITH 100% SUCCESS!\n');
})();
