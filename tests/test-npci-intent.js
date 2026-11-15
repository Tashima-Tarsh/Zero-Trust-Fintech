const assert = require('assert');
const {
  NPCI_RESPONSE_CODES,
  sanitizeTransactionNote,
  sanitizeTxnRef,
  buildNPCIIntentUri,
  parseNPCIIntentResponse,
  parseUTRTimestamp
} = require('../npci-intent');

console.log('🧪 Starting NPCI UPI Intent Handshake & Security Tests...\n');

// 1. Transaction Note (tn) Specification Tests
console.log('--- 1. Testing Transaction Note (tn) Rules ---');

// Normal note
const note1 = sanitizeTransactionNote('Order_8A3B12', 'Grocery Bill');
assert.strictEqual(note1, 'Order_8A3B12 - Grocery Bill');
assert(note1.length <= 80, 'Must be <= 80 chars');

// Character sanitization
const note2 = sanitizeTransactionNote('Order_99', 'Rice & Wheat = 50% Off? #Deal');
assert.strictEqual(note2, 'Order_99 - Rice Wheat 50 Off Deal');
assert(!note2.includes('&') && !note2.includes('=') && !note2.includes('?'), 'Query-breaking characters must be stripped');

// Length enforcement (80 chars max)
const veryLongDescription = 'Super Long Merchant Order Description That Exceeds The Maximum Permissible Eighty Characters Constraint Imposed By National Payments Corporation of India';
const note3 = sanitizeTransactionNote('Order_12345', veryLongDescription);
assert(note3.length <= 80, `Length must be <= 80, got: ${note3.length}`);
assert(note3.startsWith('Order_12345'), 'Must preserve order identifier');
console.log(`✅ Transaction Note capped at ${note3.length} chars: "${note3}"`);

// 2. Transaction Reference (tr) Specification Tests
console.log('\n--- 2. Testing Transaction Reference (tr) Rules ---');
const longTxnRef = 'TXN_1731567600_VERY_LONG_REFERENCE_THAT_EXCEEDS_THIRTY_FIVE_CHARACTERS';
const cleanTr = sanitizeTxnRef(longTxnRef);
assert.strictEqual(cleanTr.length, 35, 'tr must be capped at 35 characters');
assert(/^[A-Za-z0-9_-]+$/.test(cleanTr), 'tr must only contain safe alphanumeric/underscore/hyphen characters');
console.log(`✅ Transaction Reference capped at 35 chars: "${cleanTr}"`);

// 3. NPCI Intent Deep Link Construction Tests
console.log('\n--- 3. Testing buildNPCIIntentUri ---');
const uri = buildNPCIIntentUri({
  pa: 'merchant@okaxis',
  pn: 'Ramesh Provision Stores',
  am: 1000.37,
  orderId: 'Order_831C904E',
  description: 'Monthly Kirana Order',
  mc: '5411'
});

console.log('Generated Intent URI:', uri);
assert(uri.startsWith('upi://pay?'), 'Must start with upi://pay?');
const urlObj = new URL(uri);
assert.strictEqual(urlObj.searchParams.get('pa'), 'merchant@okaxis');
assert.strictEqual(urlObj.searchParams.get('pn'), 'Ramesh Provision Stores');
assert.strictEqual(urlObj.searchParams.get('am'), '1000.37');
assert.strictEqual(urlObj.searchParams.get('cu'), 'INR');
assert.strictEqual(urlObj.searchParams.get('mc'), '5411');
assert.strictEqual(urlObj.searchParams.get('tn'), 'Order_831C904E - Monthly Kirana Order');
assert(urlObj.searchParams.get('tn').length <= 80, 'tn <= 80 chars');
assert(urlObj.searchParams.get('tr').length <= 35, 'tr <= 35 chars');

// Validation error checks
assert.throws(() => {
  buildNPCIIntentUri({ pa: 'invalid_vpa_without_at', pn: 'Test' });
}, /Payee Address \(pa\) must be a valid VPA/);

// 4. NPCI Intent Response Parsing & Code Mapping Tests
console.log('\n--- 4. Testing parseNPCIIntentResponse ---');

// Official NPCI Intent Callback Success
const callbackSuccess = 'Status=SUCCESS&txnId=311400000123&txnRef=TXN_123&responseCode=00';
const parsedSuccess = parseNPCIIntentResponse(callbackSuccess);
assert.strictEqual(parsedSuccess.isSuccess, true);
assert.strictEqual(parsedSuccess.txnId, '311400000123');
assert.strictEqual(parsedSuccess.responseCode, '00');
assert.strictEqual(parsedSuccess.codeInfo.action, 'MARK_AS_PAID');
console.log('✅ Success callback mapped to responseCode 00: MARK_AS_PAID');

// Official NPCI Intent Callback Failure (Insufficient balance: 07)
const callbackInsufficient = 'Status=FAILURE&txnId=311400000124&txnRef=TXN_124&responseCode=07';
const parsedInsufficient = parseNPCIIntentResponse(callbackInsufficient);
assert.strictEqual(parsedInsufficient.isSuccess, false);
assert.strictEqual(parsedInsufficient.codeInfo.action, 'PROMPT_RETRY');
assert.strictEqual(parsedInsufficient.codeInfo.description, 'Insufficient account balance');
console.log('✅ Failure callback mapped to responseCode 07: PROMPT_RETRY (Insufficient balance)');

// Risk Engine Blocked (60)
const callbackRisk = 'Status=FAILURE&txnId=311400000125&txnRef=TXN_125&responseCode=60';
const parsedRisk = parseNPCIIntentResponse(callbackRisk);
assert.strictEqual(parsedRisk.codeInfo.status, 'BLOCKED');
assert.strictEqual(parsedRisk.codeInfo.action, 'CONTACT_SUPPORT');
console.log('✅ Risk blocked mapped to responseCode 60: CONTACT_SUPPORT');

// Raw Shared Receipt Parsing (PhonePe text)
const rawSharedReceipt = `Paid ₹1,000.37 to Ramesh Provision Stores
UPI Transaction ID: 631902888999
Order: Order_831C904E
Google Pay Ref: 631902888999`;

const parsedReceipt = parseNPCIIntentResponse(rawSharedReceipt);
assert.strictEqual(parsedReceipt.isSuccess, true);
assert.strictEqual(parsedReceipt.txnId, '631902888999');
assert.strictEqual(parsedReceipt.amount, 1000.37);
assert.strictEqual(parsedReceipt.orderId, 'Order_831C904E');
console.log('✅ Unstructured receipt parsed: UTR 631902888999, Amount ₹1,000.37, Order_831C904E');

// 5. UTR Timestamp / Freshness Tests
console.log('\n--- 5. Testing UTR Timestamp Parsing ---');
const testUtr = '241115123045'; // 2024-11-15 12:30:45
const parsedTime = parseUTRTimestamp(testUtr);
assert(parsedTime !== null, 'Must parse valid YYMMDDHHMMSS timestamp');
const dateObj = new Date(parsedTime);
assert.strictEqual(dateObj.getFullYear(), 2024);
console.log(`✅ UTR Timestamp parsed: ${dateObj.toISOString()}`);

console.log('\n🎉 ALL NPCI INTENT HANDSHAKE TESTS PASSED (100% GREEN)!');
