'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const merchant=read('premium-dashboard.js'),owner=read('platform-console.js'),checkout=read('cosmic-checkout.js');
for(const pattern of [/<strong>'\+esc\(o\.id\)/,/<p>'\+esc\(o\.id\)/,/<h2>Payment '\+esc\(o\.id\)/,/<td>'\+esc\(j\.journal_id\)/,/<td>'\+esc\(j\.order_id\)/])assert.doesNotMatch(merchant,pattern,'Merchant SaaS must not expose database IDs');
for(const pattern of [/<td>'\+esc\(t\.id\)/,/<td>'\+esc\(j\.journal_id\)/,/<td>'\+esc\(v\.order_id\)/,/<td>'\+esc\(e\.order_id\)/])assert.doesNotMatch(owner,pattern,'Owner SaaS must not expose database IDs');
assert.match(merchant,/data-order-id/,'Preserve internal identifiers for protected row actions');
assert.match(owner,/dataset\.tenant/,'Preserve internal identifiers for tenant action requests');
assert.match(checkout,/get\('receiptPaymentRef'\)\.textContent=session\.serviceNumber\|\|'—'/,'Service ID must not masquerade as payer transaction reference');
assert.match(checkout,/get\('receiptUtr'\)\.textContent=record\.utr/,'Real UTR comes from confirmed ledger state');
assert.doesNotMatch(checkout,/Payment reference: '\+session\.orderId/,'Do not share internal order ID as payment reference');
for(const name of ['checkout.html','merchant-checkout.html']){
 const html=read(name);
 assert.match(html,/<span>Service ID<\/span><strong id="receiptPaymentRef"/);
 assert.match(html,/<span>UTR \/ Bank reference<\/span><strong id="receiptUtr"/);
 assert.match(html,/id="receiptPayerTxnRow" hidden/,'No fabricated payer-app reference');
}
console.log('NO_RAW_ID_UI_PASS: SaaS and receipt avoid displaying internal DB identifiers');