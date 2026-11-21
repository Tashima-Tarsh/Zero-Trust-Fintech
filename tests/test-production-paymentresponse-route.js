'use strict';
// Static contract test: production experiment must remain GET-only, routed
// through Cloudflare's existing /api proxy, and excluded from financial mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'public', '_worker.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tests', 'browser', 'paymentresponse-lab.html'), 'utf8');
const lab = fs.readFileSync(path.join(root, 'tests', 'browser', 'paymentresponse-lab.js'), 'utf8');
assert.match(server, /app\.get\('\/api\/experiments\/paymentresponse',/);
assert.match(server, /app\.get\('\/api\/experiments\/paymentresponse-lab\.js',/);
assert.match(server, /'tests', 'browser', 'paymentresponse-lab\.html'/);
assert.match(server, /'tests', 'browser', 'paymentresponse-lab\.js'/);
assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
assert.match(html, /src="\.\/paymentresponse-lab\.js"/);
assert.match(html, /canMakePayment\(\)/);
assert.match(html, /addEventListener\('click'/);
assert.match(lab, /bankRrnProven:false,paymentVerified:false,debitVerified:false/);
console.log('PASS: isolated production-origin PaymentResponse route and script asset contract');
