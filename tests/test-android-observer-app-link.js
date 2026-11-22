'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = fs.readFileSync(path.join(root, 'tests/android/credential-holder-fixture/app/src/broker/AndroidManifest.xml'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'tests/android/credential-holder-fixture/app/src/main/java/ai/disha/credentialfixture/PlatformObservationBrokerPolicy.kt'), 'utf8');
const checkout = fs.readFileSync(path.join(root, 'public/cosmic-checkout.js'), 'utf8');
const observation = fs.readFileSync(path.join(root, 'tests/android/credential-holder-fixture/app/src/main/java/ai/disha/credentialfixture/SessionObservation.kt'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const links = JSON.parse(fs.readFileSync(path.join(root, 'public/.well-known/assetlinks.json'), 'utf8'));

assert.match(manifest, /android:autoVerify="true"/);
assert.match(manifest, /android:scheme="https"/);
assert.match(manifest, /android:host="disha8-2\.thenitishkr\.in"/);
assert.match(manifest, /android:pathPrefix="\/android\/observer\/"/);
assert.match(policy, /https:\/\/disha8-2\\\.thenitishkr\\\.in\/android\/observer/);
assert.match(checkout, /https:\/\/disha8-2\.thenitishkr\.in\/android\/observer\//);
assert.doesNotMatch(checkout, /intent:\/\/pair\//);
// Production CSRF middleware requires X-CSRF-Token for every scoped event POST.
assert.match(observation, /post\("\/api\/session-evidence\/event",[\s\S]*?lease\.token,\s*lease\.origin\)/);
assert.match(server, /app\.get\('\/android\/observer\/:ticket\(\[A-Za-z0-9_-\]\{43\}\)'/);
assert.match(server, /'Referrer-Policy':'no-referrer'/);
assert.equal(links.length, 1);
assert.equal(links[0].target.namespace, 'android_app');
assert.equal(links[0].target.package_name, 'ai.disha.credentialfixture');
assert.match(links[0].target.sha256_cert_fingerprints[0], /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
console.log('PASS: broker HTTPS App Link, strict fallback, and test signing identity contract');
