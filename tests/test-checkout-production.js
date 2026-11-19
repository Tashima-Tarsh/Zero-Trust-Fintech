'use strict';
// The production checkout is a single QR-first UPI Intent path.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const server=read('server.js'),edge=read('public/_worker.js');
const js=read('public/cosmic-checkout.js'),model=read('public/cosmic-checkout-model.js');
const routes=["/checkout","/checkout/","/pay","/pay/"];
assert.ok(server.indexOf("app.get(['/checkout', '/checkout/', '/pay', '/pay/']")>=0);
assert.ok(server.indexOf("app.get(['/checkout', '/checkout/', '/pay', '/pay/']")<
 server.indexOf('app.use(express.static('));
assert.match(server,/res\.sendFile\(path\.join\(__dirname, 'public', 'checkout\.html'\)\)/);
for(const route of routes)assert.ok(edge.includes(route),'Cloudflare checkout route missing '+route);
for(const page of ['public/checkout.html','public/merchant-checkout.html']){
 const html=read(page);
 for(const id of ['qrTapToPay','paymentQr','payAmount','paymentKind',
  'paymentTrackingStatus','shareCheckout','receiptPaymentRef','receiptUtr','saveReceipt','shareReceipt'])
  assert.ok(html.includes('id="'+id+'"'),'Missing active checkout hook '+id);
 for(const id of [...js.matchAll(/get\('([A-Za-z][A-Za-z0-9]*)'\)\.addEventListener\(/g)].map(m=>m[1]))
  assert.ok(html.includes('id="'+id+'"'),'JS handler lacks DOM target '+id);
 assert.match(html,/data-stage="qr"/);
 assert.match(html,/data-stage="receipt"[^>]*hidden/);
 assert.doesNotMatch(html,/data-stage="methods"|data-stage="initial"|one-touch-vault\.js|simplewebauthn/);
 assert.match(html,/\/api\/runtime-assets\/cosmic-checkout\.js\?v=[A-Za-z0-9._-]+/);
}
for(const [name,s] of [['checkout',js],['model',model]])new vm.Script(s,{filename:name});
assert.match(js,/model\.qrTapLaunchUri\(/);
assert.match(js,/new window\.QRCode\(/);
assert.match(js,/pollLedger\(/);
assert.match(js,/model\.isSettled\(/);
assert.doesNotMatch(js,/vault\.|fetch\('\/api\/vault|\/api\/settlement\/confirm/);
console.log('COSMIC_PRODUCTION_CHECKOUT_PASS: single native UPI Intent QR; session-bound ledger receipt');
