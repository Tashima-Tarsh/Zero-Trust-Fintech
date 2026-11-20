'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const manifest = read('android/upi-host/src/main/AndroidManifest.xml');
const gradle = read('android/settings.gradle');
const host = read('android/upi-host/src/main/java/in/disha/upihost/UpiResultHostActivity.java');
const checkout = read('public/cosmic-checkout.js');
const server = read('financial/session-upi-result.js');
const main = read('server.js');

assert.match(manifest, /android\.permission\.INTERNET/);
assert.doesNotMatch(manifest, /NotificationListenerService|BIND_NOTIFICATION_LISTENER_SERVICE|ACCESSIBILITY|CAMERA|RECORD_AUDIO|READ_CONTACTS|ACCESS_FINE_LOCATION/);
assert.match(gradle, /include\(":upi-host"\)/);
assert.doesNotMatch(gradle, /include\([^)]*session-evidence/);
assert.match(host, /ActivityResultContracts\.StartActivityForResult/);
assert.match(host, /\/api\/session-evidence\/upi-result/);
assert.match(checkout, /nativeHostIntentUri\('gpay'\)/);
assert.match(checkout, /package=in\.disha\.upihost/);
assert.match(server, /DISHA-UPI-RESULT-V1/);
assert.match(server, /paymentStateChanged:false/);
assert.match(main, /createSessionUpiResultRouter/);

console.log('PASS: Android UPI host has no special permissions/listener and is wired to signed session EBIT endpoint');
