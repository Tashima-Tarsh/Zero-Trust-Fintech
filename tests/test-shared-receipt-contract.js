'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {canonicalSharedReceipt,matchSharedReceiptText}=require('../financial/session-evidence');
const bytes=Buffer.from('Paid ₹10.00\nPayee: fixture@invalid\nUTR: 616953768534');
const envelope={protocol:'DISHA-SHARED-RECEIPT-V1',orderId:'ORDER_123456',
 nonce:'a'.repeat(40),deviceId:'device_123456',mimeType:'text/plain',
 postedAt:1763758800000,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
 byteLength:bytes.length};
assert.equal(canonicalSharedReceipt({...envelope}),JSON.stringify(envelope));
assert.throws(()=>canonicalSharedReceipt({...envelope,unexpected:'yes'}),/SHARED_RECEIPT_FIELDS_INVALID/);
assert.throws(()=>canonicalSharedReceipt({...envelope,byteLength:512001}),/SHARED_RECEIPT_FIELDS_INVALID/);
assert.deepEqual(matchSharedReceiptText(bytes,'text/plain','1000'),{
 matched:true,reference:'616953768534',reason:null
});
assert.equal(matchSharedReceiptText(bytes,'image/png','1000').matched,false);
assert.equal(matchSharedReceiptText(bytes,'text/plain','2000').reason,'AMOUNT_MISMATCH');
assert.equal(matchSharedReceiptText(Buffer.from('₹10.00\n123456789012'),'text/plain','1000').matched,false);
assert.equal(matchSharedReceiptText(Buffer.from('₹10.00\nUTR: 616953768534\nRRN: 999999999999'),'text/plain','1000').matched,false);
console.log('PASS: canonical receipt envelope, labelled UTR, amount check and non-text safety');
