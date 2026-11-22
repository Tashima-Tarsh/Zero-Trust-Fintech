'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {
 canonicalCapsule,verifySignedCapsule,issuedTicket,inspectPayment,receiptIntegrity
}=require('../financial/proofbridge');

const now=Date.now(),nonce='a'.repeat(40),secret='p'.repeat(64);
const session={
 orderId:'ORD_PROOFBRIDGE_1234',sessionId:'b'.repeat(48),status:'PENDING',
 createdAt:now-1000,expiresAt:now+180000,challengeAmount:500,
 merchantType:'PERSONAL',vpaAddress:'receiver@oksbi'
};
const uri='upi://pay?pa=receiver@oksbi&pn=Receiver&am=500.00&cu=INR&tn=Test';
assert.equal(inspectPayment(session,uri).amountPaise,'50000');
const personal=inspectPayment(session,uri);
assert.equal(personal.paymentType,'P2P');
assert.equal(personal.merchantCategory,'');
assert.equal(personal.merchantReference,'');
const ticket=issuedTicket(personal,nonce,now+90000,secret);
assert.equal(ticket.ticket.paymentType,'P2P');
assert.equal(ticket.ticket.paymentUriHash.length,64);
assert.equal(issuedTicket(inspectPayment(session,uri),nonce,now+90000,secret).signature,ticket.signature);
assert.notEqual(issuedTicket(inspectPayment(session,uri),nonce,now+90000,'q'.repeat(64)).signature,ticket.signature);
assert.throws(()=>inspectPayment(session,uri.replace('receiver@oksbi','attacker@oksbi')),/PAYMENT_PAYLOAD_TAMPERED/);
assert.throws(()=>inspectPayment(session,uri.replace('500.00','501.00')),/PAYMENT_PAYLOAD_TAMPERED/);
assert.throws(()=>inspectPayment(session,uri+'&pa=attacker@oksbi'),/PAYMENT_PAYLOAD_TAMPERED/);
assert.throws(()=>inspectPayment(session,uri+'&mc=1234&tr=ABC123'),/PAYMENT_KIND_MISMATCH/);
assert.throws(()=>inspectPayment({...session,status:'SUCCESS'},uri),/ORDER_INACTIVE/);
assert.throws(()=>inspectPayment({...session,expiresAt:now-1},uri),/ORDER_INACTIVE/);

const kp=crypto.generateKeyPairSync('ed25519');
const capsule={
 protocol:'DISHA-PROOF-CAPSULE-V2',issuerId:'experimental-test-issuer',
 orderId:session.orderId,nonce,utr:'123456789012',
 amountPaise:'50000',payeeVpa:'receiver@oksbi',paymentType:'P2P',merchantCategory:'',merchantReference:'',outcome:'SUCCESS_CLAIM',
 paidAt:now,ticketHash:ticket.ticketHash
};
const bytes=Buffer.from(canonicalCapsule(capsule));
const signed=crypto.sign(null,bytes,kp.privateKey).toString('base64url');
assert.equal(verifySignedCapsule(capsule,signed,kp.publicKey).length,64);
assert.throws(()=>verifySignedCapsule({...capsule,utr:'123456789013'},signed,kp.publicKey),/PROOF_SIGNATURE_INVALID/);
assert.throws(()=>verifySignedCapsule({...capsule,amountPaise:'100'},signed,kp.publicKey),/PROOF_SIGNATURE_INVALID/);
assert.throws(()=>verifySignedCapsule({...capsule,payeeVpa:'attacker@oksbi'},signed,kp.publicKey),/PROOF_SIGNATURE_INVALID/);
assert.throws(()=>verifySignedCapsule(capsule,signed,crypto.generateKeyPairSync('ed25519').publicKey),/PROOF_SIGNATURE_INVALID/);
assert.throws(()=>canonicalCapsule({...capsule,extra:'ignored'}),/PROOF_FIELDS_INVALID/);
assert.throws(()=>canonicalCapsule({...capsule,utr:'TEST123'}),/PROOF_FIELDS_INVALID/);
const confirmedDebit={...capsule,protocol:'DISHA-PROOF-CAPSULE-V4',
 payerTransactionId:'PAYERAPP-REAL-TX-012345',outcome:'DEBIT_CONFIRMED'};
const debitSignature=crypto.sign(null,Buffer.from(canonicalCapsule(confirmedDebit)),kp.privateKey).toString('base64url');
assert.equal(verifySignedCapsule(confirmedDebit,debitSignature,kp.publicKey).length,64,
 'Payer debit proof must carry a valid issuer signature');
assert.throws(()=>verifySignedCapsule({...confirmedDebit,utr:'123456789013'},debitSignature,kp.publicKey),
 /PROOF_SIGNATURE_INVALID/,'UTR must be cryptographically bound');
assert.throws(()=>verifySignedCapsule({...confirmedDebit,payerTransactionId:'PAYERAPP-CHANGED'},debitSignature,kp.publicKey),
 /PROOF_SIGNATURE_INVALID/,'Actual payer transaction ID must be cryptographically bound');
assert.throws(()=>canonicalCapsule({...confirmedDebit,outcome:'SUCCESS_CLAIM'}),/PROOF_OUTCOME_INVALID/,
 'A claim cannot be upgraded into confirmed debit by changing status');
assert.throws(()=>canonicalCapsule({...confirmedDebit,protocol:'DISHA-PROOF-CAPSULE-V3'}),/PROOF_OUTCOME_INVALID/);
assert.throws(()=>canonicalCapsule({...confirmedDebit,payerTransactionId:'\u0000danger'}),/PAYER_TRANSACTION_ID_INVALID/);
assert.throws(()=>canonicalCapsule({...confirmedDebit,payerTransactionId:''}),/PAYER_TRANSACTION_ID_INVALID/);
assert.throws(()=>verifySignedCapsule({...confirmedDebit,orderId:'ORD_DIFFERENT'},debitSignature,kp.publicKey),/PROOF_SIGNATURE_INVALID/);
const debitClaim={...confirmedDebit,protocol:'DISHA-PROOF-CAPSULE-V3',outcome:'SUCCESS_CLAIM'};
assert.doesNotThrow(()=>canonicalCapsule(debitClaim),'V3 issuer-signed observation still supported but not confirmed');


const bound={
 order_id:session.orderId,nonce,amount_paise:'50000',payee_vpa:'receiver@oksbi',
 ticket_hash:ticket.ticketHash,consented_at:now-1000,expires_at:now+90000,
 payment_type:'P2P',merchant_category:'',merchant_reference:''
};
assert.equal(receiptIntegrity(capsule,bound),true);
assert.throws(()=>canonicalCapsule({...capsule,paymentType:'P2M'}),/PROOF_FIELDS_INVALID/);
assert.throws(()=>receiptIntegrity({...capsule,paymentType:'P2M',merchantCategory:'5411',merchantReference:'INV500'},bound),/PROOF_ORDER_MISMATCH/);
const merchantUri='upi://pay?pa=business@ypbiz&pn=Business&am=500.00&cu=INR&mc=5411&tr=INV500';
const merchantSession={...session,merchantType:'P2M',vpaAddress:'business@ypbiz'};
const merchant=inspectPayment(merchantSession,merchantUri);
assert.equal(merchant.paymentType,'P2M');
assert.equal(merchant.merchantCategory,'5411');
assert.equal(merchant.merchantReference,'INV500');
const merchantTicket=issuedTicket(merchant,nonce,now+90000,secret);
assert.equal(merchantTicket.ticket.paymentType,'P2M');
assert.equal(merchantTicket.ticket.merchantCategory,'5411');
assert.equal(merchantTicket.ticket.merchantReference,'INV500');
assert.notEqual(merchantTicket.ticketHash,ticket.ticketHash);
assert.throws(()=>inspectPayment(merchantSession,merchantUri+'&mc=5411'),/PAYMENT_KIND_MISMATCH/);
assert.throws(()=>inspectPayment(merchantSession,merchantUri+'&tr=INV500'),/PAYMENT_KIND_MISMATCH/);
assert.throws(()=>inspectPayment(merchantSession,merchantUri.replace('mc=5411','mc=0000')),/PAYMENT_KIND_MISMATCH/);
const merchantProof={...capsule,payeeVpa:merchant.payeeVpa,paymentType:'P2M',
 merchantCategory:merchant.merchantCategory,merchantReference:merchant.merchantReference,
 ticketHash:merchantTicket.ticketHash};
const merchantBound={...bound,payee_vpa:merchant.payeeVpa,payment_type:'P2M',
 merchant_category:'5411',merchant_reference:'INV500',ticket_hash:merchantTicket.ticketHash};
assert.equal(receiptIntegrity(merchantProof,merchantBound),true);
assert.throws(()=>receiptIntegrity({...merchantProof,merchantReference:'INV501'},merchantBound),/PROOF_ORDER_MISMATCH/);
assert.throws(()=>receiptIntegrity({...merchantProof,merchantCategory:'9999'},merchantBound),/PROOF_ORDER_MISMATCH/);
const merchantSignature=crypto.sign(null,Buffer.from(canonicalCapsule(merchantProof)),kp.privateKey).toString('base64url');
assert.equal(verifySignedCapsule(merchantProof,merchantSignature,kp.publicKey).length,64);
assert.throws(()=>verifySignedCapsule({...merchantProof,merchantCategory:'9999'},merchantSignature,kp.publicKey),/PROOF_SIGNATURE_INVALID/);
assert.throws(()=>receiptIntegrity({...capsule,nonce:'c'.repeat(40)},bound),/PROOF_ORDER_MISMATCH/);
assert.throws(()=>receiptIntegrity({...capsule,paidAt:now-40000},bound),/PROOF_TIME_INVALID/);
assert.throws(()=>receiptIntegrity({...capsule,paidAt:now+160000},bound),/PROOF_TIME_INVALID/);

// The experimental issuer signed a CLAIM, not a real bank credit.
const source=fs.readFileSync(path.join(__dirname,'../financial/proofbridge.js'),'utf8');
assert.doesNotMatch(source,/UPDATE sessions SET status='SUCCESS'|INSERT INTO transactions|INSERT INTO ledger_entries|INSERT INTO utr_order_bindings/);
assert.match(source,/paymentVerified:false/,'Experimental issuer signature must never verify a bank debit');
assert.match(source,/const confirmedDebit=false/,'Signed V4 capsule is a claim, not independent bank evidence');
assert.match(source,/ISSUER_DEBIT_CLAIM_UNVERIFIED/,'Legacy falsely verified rows must be downgraded');
assert.match(source,/payerDebitVerified:confirmedDebit/,'Confirmed debit is distinct from unverified claim');
assert.match(source,/UTR_OBSERVED_UNVERIFIED/);
const html=fs.readFileSync(path.join(__dirname,'../public/checkout.html'),'utf8');
const checkout=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
assert.match(html,/id="proofbridgeConsent"/);
assert.match(html,/id="proofbridgeProceed"/);
assert.match(checkout,/proofbridgeEnabled&&!proofbridgeReady/);
assert.match(checkout,/data\.upiUri\)!==session\.upiUri/);
console.log('PROOFBRIDGE_PASS: ticket binding, tampered URI, issuer signature, replay prerequisites, zero-install QR consent gate, no ledger promotion');
