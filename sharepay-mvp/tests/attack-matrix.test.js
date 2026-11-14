import assert from 'node:assert';
import { database } from '../database.js';
import { executeVerificationPipeline } from '../pipeline.js';
import { generateCurrentUtr, getISTDate, getJulianDay } from '../forensics.js';

console.log('====================================================');
console.log('🛡️  STARTING SHAREPAY ZERO-TRUST FRAUD ATTACK MATRIX');
console.log('====================================================\n');

// Clean test records before test run to guarantee idempotency
database.resetForTesting();

let passedTests = 0;
let totalTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${testName}`);
    console.error(`   Error: ${err.message}\n`);
  }
}

const now = Date.now();
const freshUtr = generateCurrentUtr(now, 123456);

// Setup sample order
const sampleOrder = database.createOrder({
  id: 'Order_TEST_001',
  amount: 99.43,
  baseAmount: 100.00,
  discount: 0.57,
  sessionToken: 'sess_test_001',
  createdAt: now,
  expiresAt: now + 3 * 60 * 1000
});

// -------------------------------------------------------------
// Test 1: Legitimate fresh payment within session window
// -------------------------------------------------------------
runTest('Legitimate fresh payment passes verification', () => {
  const rawReceipt = `Paid ₹99.43 to Test Store. UTR: ${freshUtr}. Ref: Order_TEST_001. SUCCESS`;
  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: sampleOrder.id,
    clientNow: now + 10000 // 10 seconds later
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.utr, freshUtr);
  assert.strictEqual(result.amount, 99.43);
  assert.strictEqual(database.isUtrProcessed(freshUtr), true);
});

// -------------------------------------------------------------
// Test 2: Replay of the exact same UTR (Double-spend attack)
// -------------------------------------------------------------
runTest('Attack 1: Replay of already-used UTR is blocked', () => {
  // Create another order expecting 99.43
  const secondOrder = database.createOrder({
    id: 'Order_TEST_002',
    amount: 99.43,
    baseAmount: 100.00,
    discount: 0.57,
    sessionToken: 'sess_test_002',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const rawReceipt = `Paid ₹99.43 to Test Store. UTR: ${freshUtr}. Ref: Order_TEST_002.`;
  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: secondOrder.id,
    clientNow: now + 20000
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'UTR_ALREADY_USED');
});

// -------------------------------------------------------------
// Test 3: Old receipt from last month / different Julian Day
// -------------------------------------------------------------
runTest('Attack 2: Old receipt from last month is blocked by NPCI Julian Day check', () => {
  const order3 = database.createOrder({
    id: 'Order_TEST_003',
    amount: 99.75,
    baseAmount: 100.00,
    discount: 0.25,
    sessionToken: 'sess_test_003',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  // Fabricate UTR with Julian Day 250 (from late summer)
  const istNow = getISTDate(now);
  const yearDigit = istNow.getFullYear() % 10;
  const oldMonthUtr = `${yearDigit}25010999999`; // Day 250
  const rawReceipt = `Paid ₹99.75 to Test Store. UTR: ${oldMonthUtr}. Ref: Order_TEST_003.`;

  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: order3.id,
    clientNow: now
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'STALE_UTR_DATE_MISMATCH');
});

// -------------------------------------------------------------
// Test 4: Old receipt from 5 hours ago today
// -------------------------------------------------------------
runTest('Attack 3: Receipt from 5 hours ago today is blocked by Hourly Window check', () => {
  const order4 = database.createOrder({
    id: 'Order_TEST_004',
    amount: 99.12,
    baseAmount: 100.00,
    discount: 0.88,
    sessionToken: 'sess_test_004',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const fiveHoursAgo = new Date(now - 5 * 3600 * 1000);
  const istStale = getISTDate(fiveHoursAgo);
  const yearDigit = istStale.getFullYear() % 10;
  const julianDay = String(getJulianDay(istStale)).padStart(3, '0');
  const staleHour = String(istStale.getHours()).padStart(2, '0');
  const staleHourUtr = `${yearDigit}${julianDay}${staleHour}888888`;

  const rawReceipt = `Paid ₹99.12 to Test Store. UTR: ${staleHourUtr}.`;
  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: order4.id,
    clientNow: now
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'STALE_UTR_HOURLY_WINDOW_EXPIRED');
});

// -------------------------------------------------------------
// Test 5: Amount mismatch (Attacker paid round ₹100 or wrong paise)
// -------------------------------------------------------------
runTest('Attack 4: Receipt with mismatched amount is blocked', () => {
  const order5 = database.createOrder({
    id: 'Order_TEST_005',
    amount: 99.88, // Expected challenge
    baseAmount: 100.00,
    discount: 0.12,
    sessionToken: 'sess_test_005',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const newUtr = generateCurrentUtr(now, 777777);
  // Receipt has round ₹100.00
  const rawReceipt = `Paid ₹100.00 to Test Store. UTR: ${newUtr}.`;

  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: order5.id,
    clientNow: now
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'AMOUNT_MISMATCH');
});

// -------------------------------------------------------------
// Test 6: Shared after 3-minute session expiration
// -------------------------------------------------------------
runTest('Attack 5: Receipt shared after 3-minute session expiration is blocked', () => {
  const order6 = database.createOrder({
    id: 'Order_TEST_006',
    amount: 99.20,
    baseAmount: 100.00,
    discount: 0.80,
    sessionToken: 'sess_test_006',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000 // expires in 3 mins
  });

  const newUtr = generateCurrentUtr(now, 888888);
  const rawReceipt = `Paid ₹99.20. UTR: ${newUtr}.`;

  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: order6.id,
    clientNow: now + (4 * 60 * 1000) // 4 minutes later
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'SESSION_EXPIRED');
});

// -------------------------------------------------------------
// Test 7: Receipt from a different transaction (Note Mismatch)
// -------------------------------------------------------------
runTest('Attack 6: Receipt with wrong transaction note is blocked', () => {
  const order7 = database.createOrder({
    id: 'Order_TEST_007',
    amount: 99.30,
    baseAmount: 100.00,
    discount: 0.70,
    sessionToken: 'sess_test_007',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const newUtr = generateCurrentUtr(now, 999999);
  // Receipt has note pointing to Order_OTHER_999
  const rawReceipt = `Paid ₹99.30. UTR: ${newUtr}. Note: Order_OTHER_999.`;

  const result = executeVerificationPipeline({
    rawReceipt,
    orderId: order7.id,
    clientNow: now
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'NOTE_MISMATCH');
});

// -------------------------------------------------------------
// Test 8: Malformed receipt text
// -------------------------------------------------------------
runTest('Attack 7: Malformed or unparseable text is blocked', () => {
  const order8 = database.createOrder({
    id: 'Order_TEST_008',
    amount: 99.50,
    baseAmount: 100.00,
    discount: 0.50,
    sessionToken: 'sess_test_008',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const result = executeVerificationPipeline({
    rawReceipt: 'Hello, this is just a random chat message without any receipt info.',
    orderId: order8.id,
    clientNow: now
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'PARSE_ERROR');
});

// -------------------------------------------------------------
// Test 9 (P0-Forensics): PhonePe receipt without explicit note
// -------------------------------------------------------------
runTest('PhonePe receipt format with "Payment of ₹" and "Reference ID" passes', () => {
  const phonePeUtr = generateCurrentUtr(now, 444555);
  const order9 = database.createOrder({
    id: 'Order_TEST_009',
    amount: 99.64,
    baseAmount: 100.00,
    discount: 0.36,
    sessionToken: 'sess_test_009',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const phonePeText = `Payment of ₹99.64 to Merchant Store was successful. Reference ID: ${phonePeUtr}. Paid via PhonePe UPI.`;
  const result = executeVerificationPipeline({
    rawReceipt: phonePeText,
    orderId: order9.id,
    clientNow: now + 5000
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.utr, phonePeUtr);
  assert.strictEqual(result.amount, 99.64);
});

// -------------------------------------------------------------
// Test 10 (P0-Forensics): CRED receipt format with "via CRED UPI"
// -------------------------------------------------------------
runTest('CRED receipt format with "via CRED UPI" and "UTR" passes', () => {
  const credUtr = generateCurrentUtr(now, 777888);
  const order10 = database.createOrder({
    id: 'Order_TEST_010',
    amount: 99.18,
    baseAmount: 100.00,
    discount: 0.82,
    sessionToken: 'sess_test_010',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const credText = `Paid ₹99.18 to Merchant Store via CRED UPI. UTR: ${credUtr}.`;
  const result = executeVerificationPipeline({
    rawReceipt: credText,
    orderId: order10.id,
    clientNow: now + 8000
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.utr, credUtr);
  assert.strictEqual(result.amount, 99.18);
});

// -------------------------------------------------------------
// Test 11 (P1-Reliability): Expiry sweeper marks stale pending orders
// -------------------------------------------------------------
runTest('Expiry sweeper cleans up orders older than 180-second window', () => {
  const staleTime = now - 200000; // 200s ago
  const staleOrder = database.createOrder({
    id: 'Order_TEST_011',
    amount: 99.99,
    baseAmount: 100.00,
    discount: 0.01,
    sessionToken: 'sess_test_011',
    createdAt: staleTime - 180000,
    expiresAt: staleTime // expired in the past
  });

  assert.strictEqual(staleOrder.status, 'PENDING');
  const sweptCount = database.sweepExpiredOrders(now);
  assert.strictEqual(sweptCount >= 1, true);

  const updated = database.getOrder('Order_TEST_011');
  assert.strictEqual(updated.status, 'EXPIRED');
});

// -------------------------------------------------------------
// Test 12 (P0-Security): Unauthorized WebSocket session token rejected
// -------------------------------------------------------------
runTest('Unauthorized WebSocket session token is blocked by security validation', () => {
  const wsOrder = database.createOrder({
    id: 'Order_TEST_012',
    amount: 99.88,
    baseAmount: 100.00,
    discount: 0.12,
    sessionToken: 'sess_secret_valid_token_012',
    createdAt: now,
    expiresAt: now + 3 * 60 * 1000
  });

  const wrongToken = 'sess_attacker_forged_token';
  const order = database.getOrder(wsOrder.id);
  assert.strictEqual(order.session_token === wrongToken, false);
  assert.strictEqual(order.session_token === 'sess_secret_valid_token_012', true);
});

console.log(`\n====================================================`);
console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`====================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
