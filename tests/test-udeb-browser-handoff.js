'use strict';
/**
 * UDEB transport regression: browser consumes only server-scoped device evidence.
 * No live financial transaction or synthetic receipt injection.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const checkout=fs.readFileSync(path.join(root,'public','cosmic-checkout.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const evidence=fs.readFileSync(path.join(root,'financial','session-evidence.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','checkout.html'),'utf8');
const tests=[
 ['browser JS parses',()=>assert.doesNotThrow(()=>new Function(checkout))],
 ['I Paid triggers monitoring',()=>assert.match(checkout,/debitButton\.addEventListener\('click',startDebitEvidenceMonitor\)/)],
 ['monitor only runs within active session',()=>assert.match(checkout,/session!==boundSession\|\|expired\(\)\|\|receiptShown/)],
 ['monitor stops on page exit',()=>assert.match(checkout,/addEventListener\('pagehide',stopDebitEvidenceMonitor\)/)],
 ['read-only receipt URL remains scoped to session',()=>assert.match(checkout,/\/api\/payer-debit-evidence\/['"]?\+encodeURIComponent\(boundSession\.orderId\)/)],
 ['receipt requires observation state',()=>assert.match(checkout,/receipt\.state==='DEBIT_EVIDENCE_OBSERVED'/)],
 ['receipt does not promote payment',()=>assert.match(checkout,/evidence\.paymentVerified===false&&evidence\.debitVerified===false/)],
 ['receipt must match exact amount',()=>assert.match(checkout,/receipt\.amountPaise===String\(Math\.round\(session\.amount\*100\)\)/)],
 ['receipt cannot be arbitrary reference',()=>assert.match(checkout,/receipt\.referenceKind\)\&\&/)],
 ['server evidence remains source bound',()=>assert.match(evidence,/verifyDeviceEvidence\(b\.evidence, b\.signature, publicKey/)],
 ['server requires pre-enrolled device',()=>assert.match(evidence,/DEVICE_NOT_ENROLLED/)],
 ['server keeps observation distinct from settled',()=>assert.match(evidence,/DEBIT_EVIDENCE_OBSERVED/)],
 ['checkout user requested evidence',()=>assert.match(html,/I Paid — Check Debit Evidence/)],
 ['monitor does not call settlement endpoint',()=>assert.ok(!/fetch\(['"]\/api\/settle/.test(checkout))]
];
for(const [name,fn] of tests){fn();console.log('PASS '+name)}
console.log('UDEB browser handoff: '+tests.length+'/'+tests.length+' source-contract checks PASS');
