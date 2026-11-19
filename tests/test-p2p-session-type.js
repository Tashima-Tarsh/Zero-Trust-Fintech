'use strict';
const assert=require('node:assert/strict');
const {buildUpiUri}=require('../utils/upi-intent');
const {resolvePaymentType,fromIssuedUri,normalize}=require('../financial/payment-session-type');
const p2p=buildUpiUri({kind:'P2P',pa:'personal@oksbi',pn:'Personal Receiver',am:'1.00',tn:'Direct payment'});
const p2m=buildUpiUri({kind:'P2M',pa:'shop@ypbiz',pn:'Registered Shop',am:'500.01',mc:'5411',tr:'PAY12345678'});
assert.equal(normalize('PERSONAL'),'P2P');
assert.equal(normalize('MERCHANT'),'P2M');
assert.equal(normalize('P2M'),'P2M');
assert.equal(fromIssuedUri(p2p),'P2P');
assert.equal(fromIssuedUri(p2m),'P2M');
assert.equal(fromIssuedUri('upi://pay?pa=personal@oksbi&am=1.00&cu=INR&mc=0000'),'P2P',
 'NPCI individual QR may explicitly carry MCC 0000');
assert.equal(resolvePaymentType({merchantType:'PERSONAL',upiUri:p2p,vpaAddress:'personal@oksbi',challengeAmount:'1.00'}),'P2P');
assert.equal(resolvePaymentType({paymentType:'P2P',upiUri:p2p,vpaAddress:'personal@oksbi',challengeAmount:'1.00'}),'P2P');
assert.equal(resolvePaymentType({paymentType:null,upiUri:p2p,vpaAddress:'personal@oksbi',challengeAmount:'1.00'}),'P2P',
 'Legacy untyped P2P session is derived from the original issued QR');
assert.equal(resolvePaymentType({paymentType:null,upiUri:p2m,vpaAddress:'shop@ypbiz',challengeAmount:500.01}),'P2M',
 'Legacy untyped merchant remains merchant');
assert.equal(resolvePaymentType({}),null,'Do not invent type for a legacy row without URI or classification');
assert.throws(()=>resolvePaymentType({paymentType:'P2P',upiUri:p2m}),/SESSION_PAYMENT_TYPE_URI_CONFLICT/,
 'Merchant QR can never be mislabeled P2P');
assert.throws(()=>resolvePaymentType({paymentType:'P2M',upiUri:p2p}),/SESSION_PAYMENT_TYPE_URI_CONFLICT/,
 'Personal QR can never become P2M by changing label');
assert.throws(()=>resolvePaymentType({upiUri:p2p,vpaAddress:'intruder@oksbi'}),/SESSION_PAYEE_URI_CONFLICT/);
assert.throws(()=>resolvePaymentType({upiUri:p2p,challengeAmount:'2.00'}),/SESSION_AMOUNT_URI_CONFLICT/);
for(const invalid of [
 'upi://pay?pa=personal@oksbi&am=1.00&cu=INR&tr=BAD',
 'upi://pay?pa=personal@oksbi&am=1.00&cu=INR&mc=5411',
 'upi://pay?pa=personal@oksbi&am=1.00&cu=INR&mc=0000&tr=SHOULDNOT',
 'upi://pay?pa=personal@oksbi&pa=attacker@upi&am=1.00&cu=INR',
 'upi://pay?pa=personal@oksbi&am=1.00&cu=INR&am=999.00',
 'upi://pay?pa=personal@oksbi&am=1.00&cu=INR&mc=5411&tr=PAY123&mc=5411',
 'upi://pay?pa=personal@oksbi&am=1.001&cu=INR',
 'upi://pay?pa=personal@oksbi&am=1.00&cu=USD'
])assert.throws(()=>resolvePaymentType({upiUri:invalid}),/SESSION_/);
assert.doesNotMatch(p2p,/(?:[?&])(mc|tr)=/,'P2P never manufactures merchant parameters');
assert.match(p2m,/[?&]mc=5411/);assert.match(p2m,/[?&]tr=PAY12345678/);
const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
const client=fs.readFileSync(path.join(root,'public/cosmic-checkout.js'),'utf8');
assert.match(client,/normalized!==requiredMode/,'Keep P2P/P2M front-end classification guard');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
assert.match(server,/P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH/,'Keep backend receiving-account type guard');
const sql=fs.readFileSync(path.join(root,'schema.sql'),'utf8');
assert.match(sql,/payment_type VARCHAR\(3\)/,'Persist payment identity in fresh schema');
console.log('P2P_SESSION_TYPE_PASS: bank URI classification, immutable P2P/P2M, legacy recovery, QR/payee/amount anti-swap');
