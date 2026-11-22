'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public/cosmic-checkout.js'), 'utf8');
const {lookupBankSender} = require('../financial/bank-sms-header-registry');

test('P2P session issuer caps payment window at 90 seconds on authoritative server', () => {
 assert.match(server, /const expiresAt = now \+ \(90 \* 1000\)/);
 assert.match(server, /await db\.saveSession\(session\)/);
});
test('P2P checkout does not render receiving VPA in payment identity or copy handoff',()=>{
 assert.match(client, /Receiving UPI ID hidden/);
 assert.match(client, /Receiving UPI ID copied securely/);
 assert.doesNotMatch(client, /get\('copiedPayee'\)\.textContent=payee/);
 assert.doesNotMatch(client, /get\('copiedPayee'\)\.textContent=proofbridgeAuthorized\.ticket\.payeeVpa/);
});
test('expired checkout locks the pay button, copy button and I Paid evidence check',()=>{
 assert.match(client, /if\(remaining===0\) \{/);
 assert.match(client, /pay\.setAttribute\('aria-disabled','true'\)/);
 assert.match(client, /copy\.disabled=true/);
 assert.match(client, /debit\.disabled=true/);
 assert.match(client, /if\(!session\?\.orderId\|\|!session\?\.token\|\|expired\(\)\)return/);
});
test('bank sender alone never confirms a debit',()=>{
 const match=lookupBankSender('AD-SBIUPI-S');
 assert.equal(match.matched,true);
 assert.equal(match.paymentVerified,false);
 assert.equal(match.debitVerified,false);
});
test('customer pressing I Paid cannot write ledger or mark payment verified',()=>{
 assert.match(server, /Observation-only P2P payer debit evidence\. Never mutate checkout status or ledger/);
 assert.match(client, /No authenticated debit evidence is available/);
});
