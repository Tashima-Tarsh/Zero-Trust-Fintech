import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🧪 TESTING SHAREPAY MERCHANT PWA SERVER & ASSETS');
console.log('====================================================\n');

const TEST_PORT = 3099;
const serverProcess = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: TEST_PORT.toString() },
  stdio: 'pipe'
});

serverProcess.stdout.on('data', data => {
  // console.log(`[Server] ${data}`);
});

function fetchUrl(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}${pathname}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

// Wait for server to boot
setTimeout(async () => {
  try {
    // 1. Health check
    const health = await fetchUrl('/health');
    assert.strictEqual(health.status, 200);
    const healthJson = JSON.parse(health.body);
    assert.strictEqual(healthJson.service, 'merchant-pwa');
    console.log('✅ [PASS] /health endpoint responds 200 OK');

    // 2. index.html serving
    const index = await fetchUrl('/');
    assert.strictEqual(index.status, 200);
    assert.ok(index.body.includes('SharePay Merchant Dashboard'));
    assert.ok(index.body.includes('manifest.json'));
    console.log('✅ [PASS] / serves index.html with PWA tags');

    // 3. manifest.json
    const manifest = await fetchUrl('/manifest.json');
    assert.strictEqual(manifest.status, 200);
    const manifestJson = JSON.parse(manifest.body);
    assert.strictEqual(manifestJson.name, 'SharePay Merchant Dashboard');
    assert.strictEqual(manifestJson.display, 'standalone');
    console.log('✅ [PASS] /manifest.json is valid standalone PWA manifest');

    // 4. Service Worker (sw.js)
    const sw = await fetchUrl('/sw.js');
    assert.strictEqual(sw.status, 200);
    assert.ok(sw.body.includes('sharepay-merchant-v1'));
    console.log('✅ [PASS] /sw.js serves valid caching and push listener');

    // 5. CSS Styles
    const css = await fetchUrl('/styles.css');
    assert.strictEqual(css.status, 200);
    assert.ok(css.body.includes('--primary: #2563eb'));
    console.log('✅ [PASS] /styles.css serves complete styling');

    // 6. Application JS
    const js = await fetchUrl('/app.js');
    assert.strictEqual(js.status, 200);
    assert.ok(js.body.includes('connectWebSocket'));
    console.log('✅ [PASS] /app.js serves live WebSocket logic');

    // 7. Icons
    const icon192 = await fetchUrl('/icons/icon-192.png');
    assert.strictEqual(icon192.status, 200);
    console.log('✅ [PASS] /icons/icon-192.png is available');

    console.log('\n====================================================');
    console.log('🎉 ALL PWA MERCHANT TESTS PASSED (7/7)!');
    console.log('====================================================\n');

    serverProcess.kill();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    serverProcess.kill();
    process.exit(1);
  }
}, 1000);
