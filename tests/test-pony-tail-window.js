'use strict';
/** Actual Pony-tail policy boundaries, including adversarial clock inputs. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {T_MIN_MS,T_MAX_MS,evaluateTemporalGate}=require('../utils/pony-tail-window');
assert.equal(T_MIN_MS,15000);
assert.equal(T_MAX_MS,180000);
const createdAt=1_000_000,expiresAt=createdAt+T_MAX_MS;
const g=t=>evaluateTemporalGate({createdAt,expiresAt},createdAt+t);
for(const [delta,state] of [
  [-1000,'CLOCK_SKEW'],[-1,'CLOCK_SKEW'],
  [0,'WAITING'],[14_999,'WAITING'],
  [15_000,'OBSERVATION_WINDOW'],
  [15_001,'OBSERVATION_WINDOW'],
  [179_999,'OBSERVATION_WINDOW'],
  [180_000,'OBSERVATION_WINDOW'],
  [180_001,'EXPIRED'],
  [500_000,'EXPIRED']
])assert.equal(g(delta).state,state,'Boundary '+delta);
assert.equal(g(14_999).remainingMs,1);
assert.equal(evaluateTemporalGate({createdAt,expiresAt:createdAt+60_000},
  createdAt+60_001).state,'EXPIRED','Order expiry overrides 180s maximum');
assert.equal(evaluateTemporalGate({createdAt:0,expiresAt},createdAt).state,'INVALID_SESSION_CLOCK');
assert.equal(evaluateTemporalGate({createdAt:5000,expiresAt:4000},5001).state,'INVALID_SESSION_CLOCK');
assert.equal(evaluateTemporalGate({createdAt,expiresAt},NaN).state,'INVALID_SESSION_CLOCK');
assert.equal(evaluateTemporalGate({createdAt,expiresAt},Infinity).state,'INVALID_SESSION_CLOCK');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
assert.equal((server.match(/evaluateTemporalGate\(session,now\)/g)||[]).length,3,
  'Legacy verify, CFC and Web Share must call the same temporal policy');
assert.doesNotMatch(server,/covers 99\.7%/i,'Do not invent empirical success rates');
assert.doesNotMatch(server,/db\.bindUtrToOrder\(/,
  'Untrusted public claims must never reserve authoritative bank references');
assert.match(server,/observeClaim\(db\.pgPool,session\.orderId,cleanUtr,'CFC'\)/);
console.log('PONY_TAIL_MATHEMATICAL_BOUNDARIES_PASS: 15s/180s inclusivity, late, early, expiration and adversarial clock; no false credit claims.');
