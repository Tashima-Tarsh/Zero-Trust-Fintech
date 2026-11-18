#!/usr/bin/env node
/**
 * Source-level production checkout guards. These run without a live bank,
 * browser, or external network. The browser JavaScript is parsed, not run.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const checkout = fs.readFileSync(path.join(ROOT, 'public', 'checkout.html'), 'utf8');
const edge = fs.readFileSync(path.join(ROOT, 'public', '_worker.js'), 'utf8');

const canonical = server.indexOf("app.get(['/checkout', '/checkout/', '/pay', '/pay/']");
const staticMiddleware = server.indexOf("app.use(express.static(");
assert(canonical >= 0 && staticMiddleware >= 0 && canonical < staticMiddleware,
  'Canonical checkout must be served before express.static to prevent legacy /checkout/ index');
assert.match(server, /res\.sendFile\(path\.join\(__dirname, 'public', 'checkout\.html'\)\)/);
assert.match(edge, /\["\/checkout", "\/checkout\/", "\/pay", "\/pay\/"\]/);
assert.match(edge, /zero-trust-fintech-production\.up\.railway\.app/);
assert.match(checkout, /WebAuthn Secured UPI Checkout/);
assert.match(checkout, /\/vendor\/simplewebauthn\.umd\.js/);
assert.match(checkout, /SimpleWebAuthnBrowser\.startRegistration\(\{\s*optionsJSON: data\.publicKey/);
assert.match(checkout, /SimpleWebAuthnBrowser\.startAuthentication\(\{\s*optionsJSON: data\.publicKey/);
assert.match(checkout, /\/ws\?orderId=\$\{encodeURIComponent\(orderId\)\}&token=\$\{encodeURIComponent\(sessionToken\)\}/);
assert.match(server, /new WebSocketServer\(\{ server, path: '\/ws' \}\)/);
assert.match(server, /generateRegistrationOptions/);
assert.match(server, /expectedRPID: RP_ID/);

const scripts = [...checkout.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(code => code.trim());
assert(scripts.length > 0, 'Checkout inline logic should be present');
for (const [index, code] of scripts.entries()) {
  new vm.Script(code, { filename: 'public/checkout.html inline script ' + (index + 1) });
}
console.log('Canonical checkout, passkey contracts, WebSocket endpoint and inline JavaScript: OK');
