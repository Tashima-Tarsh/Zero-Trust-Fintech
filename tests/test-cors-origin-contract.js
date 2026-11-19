'use strict';
// Protect the multi-origin checkout configuration without allowing unknown origins.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert.match(source,/origin && ALLOWED_ORIGINS\.length > 0 && !ALLOWED_ORIGINS\.includes\(origin\)/);
assert.doesNotMatch(source,/ALLOWED_ORIGINS\[0\]/,'A second configured origin must not be rejected');
assert.match(source,/X-CSRF-Token, X-XSRF-Token/,'Allowed cross-origin checkout must permit its own CSRF header');
console.log('CORS_ORIGIN_CONTRACT_PASS: all configured origins supported; unknown origins still denied');
