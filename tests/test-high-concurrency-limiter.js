'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert.match(server,/const wsHitsSweep = setInterval\(/);
assert.match(server,/wsHitsSweep\.unref\?\.\(\)/);
assert.match(server,/const sweep = setInterval\(/);
assert.doesNotMatch(server,/Array\.from\(wsConnectionHits\.keys\(\)\)/,
 'WebSocket admission must not scan all client IPs');
assert.doesNotMatch(server,/for \(const \[k, arr\] of fallbackHits\.entries\(\)\)/,
 'Checkout rate limiting must not scan all IPs on every request');
assert.equal((server.match(/maskedUtr: maskUtr\(payload\.utr\)/g)||[]).length,1);
console.log('CHECKOUT_100K_PREP_PASS: per-IP connection admission and request fallback do not globally scan IPs');
