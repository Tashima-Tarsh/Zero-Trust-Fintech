#!/usr/bin/env node
'use strict';
// Production contract: single first-party payment UI, real-order data,
// preserved WebAuthn and no settlement based on a browser return.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const server=read('server.js'),edge=read('public/_worker.js');
const generic=read('public/checkout.html');
const merchant=read('public/merchant-checkout.html');
const script=read('public/cosmic-checkout.js');
const model=read('public/cosmic-checkout-model.js');
assert.ok(server.indexOf("app.get(['/checkout', '/checkout/', '/pay', '/pay/']")>=0);
assert.ok(server.indexOf("app.get(['/checkout', '/checkout/', '/pay', '/pay/']")<server.indexOf('app.use(express.static('));
assert.match(server,/res\.sendFile\(path\.join\(__dirname, 'public', 'checkout\.html'\)\)/);
assert.match(edge,/\["\/checkout", "\/checkout\/", "\/pay", "\/pay\/"\]/);
assert.match(server,/new WebSocketServer\(\{ server, path: '\/ws' \}\)/);
assert.match(server,/generateRegistrationOptions/);
assert.match(server,/expectedRPID: RP_ID/);
for(const html of [generic,merchant]){
 assert.match(html,/\/vendor\/simplewebauthn\.umd\.js/);
 assert.match(html,/\/one-touch-vault\.js/);
 assert.match(html,/\/cosmic-checkout\.js/);
 assert.match(html,/src="\/assets\/disha-8-2-wordmark-cropped\.png"/);
 assert.match(html,/id="btnOneTouch"/);
 assert.match(html,/data-stage="methods"[^>]*hidden/);
 assert.match(html,/data-stage="qr"[^>]*hidden/);
 assert.match(html,/data-stage="checking"[^>]*hidden/);
 assert.match(html,/data-stage="receipt"[^>]*hidden/);
 assert.doesNotMatch(html,/WebAuthn Secured UPI Checkout|NPCI Clearing|WhatsApp|T\+0 Settlement/);
}
for(const [name,src] of [['cosmic-checkout.js',script],['cosmic-checkout-model.js',model]])
 new vm.Script(src,{filename:name});
assert.match(script,/vault\.authorize\(orderId\(\)\)/);
assert.match(script,/vault\.beginHandoff\(orderId\(\),vaultSessionId,session\.token\)/);
assert.match(script,/\?token=/);
assert.match(script,/\/api\/ledger\//);
assert.match(script,/model\.isSettled\(/);
console.log('COSMIC_PRODUCTION_CHECKOUT_PASS: unified secure checkout, browser JS syntax and ledger-confirmed receipt');
