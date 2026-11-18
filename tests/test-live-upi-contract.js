'use strict';
/* End-to-end UPI intent construction contract, without a real bank transfer.
 * Covers premature pre-PIN declines caused by merchant-field confusion.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {buildUpiUri}=require('../utils/upi-intent');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const a=source.indexOf('function generateUPILink(session) {');
const b=source.indexOf('// REST API ENDPOINTS',a);
assert.ok(a>0&&b>a,'Server UPI builder not found');
const functionSrc=source.slice(a,source.indexOf('\n// ═════════',a));
const context={buildUpiUri,MERCHANT_NAME:'Real Payee',MERCHANT_UPI_ID:'owner@oksbi'};
vm.runInNewContext(functionSrc+'\nthis.build=generateUPILink;',context);
const session={vpaAddress:'owner@oksbi',merchantType:'PERSONAL',description:'DISHA checkout',challengeAmount:1,txnRef:'TXN_ABC123'};
const personal=new URL(context.build(session));
assert.equal(personal.searchParams.get('pa'),'owner@oksbi');
assert.equal(personal.searchParams.get('am'),'1.00');
assert.equal(personal.searchParams.get('tn'),'DISHA checkout','No fabricated payment note');
assert.equal(personal.searchParams.get('mc'),null,'Personal VPA must never carry merchant category');
assert.equal(personal.searchParams.get('tr'),null,'Personal transfer must not use fabricated merchant transaction ref');
const merchant=new URL(context.build({...session,vpaAddress:'company@ypbiz',merchantType:'MERCHANT',mcc:'4705',txnRef:'TXN_ABC123'}));
assert.equal(merchant.searchParams.get('mc'),'4705');
assert.equal(merchant.searchParams.get('tr'),'TXNABC123');
assert.equal(merchant.searchParams.get('pa'),'company@ypbiz');
assert.equal(merchant.searchParams.get('am'),'1.00');
assert.throws(()=>context.build({...session,merchantType:'MERCHANT',mcc:'0000'}),/BANK_VERIFIED_MCC_REQUIRED/);
assert.throws(()=>context.build({...session,merchantType:'MERCHANT',mcc:null}),/BANK_VERIFIED_MCC_REQUIRED/);
assert.throws(()=>context.build({...session,merchantType:'UNCLASSIFIED'}),/UNKNOWN_UPI_ACCOUNT_CLASSIFICATION/);
assert.match(source,/generateUPILink\(session\);\s*await db\.saveSession\(session\)/,'Must validate UPI before session saved');
assert.ok(source.includes('requestedVpa.toLowerCase() === primaryVpa'),"Public checkout may only use owner's receiving VPA");
assert.ok(!source.includes('Metadata Shield'),'Must not obscure commercial transactions');
console.log('P2P_P2M_INTENT_CONTRACT_PASS: consistent merchant classification, truthful notes, no pre-PIN malformed MCC.');
