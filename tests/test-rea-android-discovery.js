'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const ps=fs.readFileSync(path.join(root,'experiments/rea-android/setup-and-observe.ps1'),'utf8');
const doc=fs.readFileSync(path.join(root,'experiments/rea-android/README.md'),'utf8');
test('REA installer is user-level and checks supported Node versions',()=>{
 assert.match(ps,/rea-agents','setup/);
 assert.match(ps,/NodeCompatible/);
 assert.match(ps,/22\.23\.4\+/);
 assert.match(ps,/24\.22\.1\+/);
});
test('Android census observes both discovered handlers without payment initiation',()=>{
 assert.match(ps,/org\.chromium\.intent\.action\.PAY/);
 assert.match(ps,/com\.google\.android\.gms\.pay\.PAY/);
 assert.match(ps,/query-activities/);
 assert.doesNotMatch(ps,/startActivityForResult|am','start|emu','sms','send|pm','grant|su\s+-c/);
});
test('scope explicitly separates known evidence from claimed PSP bank events',()=>{
 assert.match(doc,/No observed browser-accessible Google Pay India UPI transaction response/);
 assert.match(doc,/not zero-install/i);
 assert.match(doc,/Source-to-discovery gates/);
 assert.match(doc,/do not attempt to access private PSP communications/i);
});
