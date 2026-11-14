/**
 * DISHA 8.2 — Enterprise Gaming IP Whitelist Security Test Suite
 * Tests API key authentication, exact IP matching, CIDR subnet matching,
 * blocked attempt recording, audit logging, and admin management APIs.
 */

const assert = require('assert');

(async () => {
  console.log('🧪 Starting DISHA 8.2 — Enterprise Gaming IP Whitelist Tests...\n');

  const BASE_URL = 'http://localhost:3000';
  const SEED_API_KEY = 'gz_live_key_a1b2c3d4e5f60718293a4b5c6d7e8f90';

  // ─────────────────────────────────────────────────────────────
  // 1. MISSING & INVALID API KEY
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Testing Missing & Invalid API Key Authentication ---');

  // Test 1a: Missing API Key
  const res1a = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utr: '631902000001', amount: 100 })
  });
  assert.strictEqual(res1a.status, 401, 'Must return 401 when X-API-Key is missing');
  const json1a = await res1a.json();
  assert.strictEqual(json1a.error, 'MISSING_API_KEY');
  console.log('✅ Missing API Key rejected with 401 MISSING_API_KEY');

  // Test 1b: Invalid API Key
  const res1b = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'invalid_hacker_key_9999'
    },
    body: JSON.stringify({ utr: '631902000001', amount: 100 })
  });
  assert.strictEqual(res1b.status, 401, 'Must return 401 for invalid API key');
  const json1b = await res1b.json();
  assert.strictEqual(json1b.error, 'INVALID_API_KEY');
  console.log('✅ Invalid API Key rejected with 401 INVALID_API_KEY');

  // ─────────────────────────────────────────────────────────────
  // 2. UNAUTHORIZED IP REJECTION (403 FORBIDDEN)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Testing Unauthorized Hacker IP Interception ---');
  const hackerIP = '185.220.101.5'; // Known suspicious external IP

  const res2 = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': SEED_API_KEY,
      'X-Forwarded-For': hackerIP
    },
    body: JSON.stringify({ utr: '631902999999', amount: 500 })
  });

  assert.strictEqual(res2.status, 403, 'Must return 403 Forbidden for non-whitelisted IP');
  const json2 = await res2.json();
  assert.strictEqual(json2.error, 'IP_NOT_WHITELISTED');
  assert.strictEqual(json2.your_ip, hackerIP);
  console.log(`✅ Unauthorized request from ${hackerIP} blocked with 403 IP_NOT_WHITELISTED`);

  // Repeat request to verify attempt counter increment
  await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': SEED_API_KEY,
      'X-Forwarded-For': hackerIP
    },
    body: JSON.stringify({ utr: '631902999999', amount: 500 })
  });

  // Verify blocked attempt was logged
  const blockedRes = await fetch(`${BASE_URL}/api/admin/blocked-attempts`);
  const blockedJson = await blockedRes.json();
  const hackerAttempt = blockedJson.blocked_attempts.find(b => b.ip_address === hackerIP);
  assert(hackerAttempt, 'Hacker attempt must be recorded in blocked_ip_attempts');
  assert(hackerAttempt.attempt_count >= 2, 'Attempt counter must increment on repeat violations');
  console.log(`✅ Blocked IP attempt logged: ${hackerAttempt.ip_address} | Count: ${hackerAttempt.attempt_count} attempts`);

  // ─────────────────────────────────────────────────────────────
  // 3. AUTHORIZED EXACT IP MATCH (200 OK)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Testing Authorized Game Server Exact IP Match ---');
  const authorizedGameServerIP = '52.84.123.45'; // AWS Mumbai Game Server 1
  const testUtr1 = '631902' + Math.floor(100000 + Math.random() * 900000);

  const res3 = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': SEED_API_KEY,
      'X-Forwarded-For': authorizedGameServerIP
    },
    body: JSON.stringify({ utr: testUtr1, amount: 250.00 })
  });

  assert.strictEqual(res3.status, 200, 'Must allow whitelisted exact IP');
  const json3 = await res3.json();
  assert.strictEqual(json3.success, true);
  assert.strictEqual(json3.status, 'VERIFIED');
  assert.strictEqual(json3.clientIP, authorizedGameServerIP);
  assert(json3.ledgerVerification && json3.ledgerVerification.balanced);
  console.log(`✅ Game payment verified for AWS Mumbai (${authorizedGameServerIP}): UTR ${json3.utr} | Ledger Tx: ${json3.ledgerTxId}`);

  // ─────────────────────────────────────────────────────────────
  // 4. AUTHORIZED CIDR RANGE MATCH (200 OK)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Authorized Subnet CIDR Match (103.21.58.0/24) ---');
  const subnetGameServerIP = '103.21.58.142'; // Inside 103.21.58.0/24 DigitalOcean cluster
  const testUtr2 = '631902' + Math.floor(100000 + Math.random() * 900000);

  const res4 = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': SEED_API_KEY,
      'X-Forwarded-For': subnetGameServerIP
    },
    body: JSON.stringify({ utr: testUtr2, amount: 999.00 })
  });

  assert.strictEqual(res4.status, 200, 'Must allow IP falling inside whitelisted CIDR range');
  const json4 = await res4.json();
  assert.strictEqual(json4.success, true);
  assert.strictEqual(json4.status, 'VERIFIED');
  assert.strictEqual(json4.clientIP, subnetGameServerIP);
  console.log(`✅ Subnet IP (${subnetGameServerIP}) successfully verified against CIDR 103.21.58.0/24`);

  // ─────────────────────────────────────────────────────────────
  // 5. AUDIT TRAIL & LOGGING VERIFICATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Testing API Audit Trail Logging ---');
  const logRes = await fetch(`${BASE_URL}/api/admin/access-logs`);
  const logJson = await logRes.json();
  assert(logJson.success && logJson.logs.length >= 2, 'API access log must capture successful calls');
  const recentLog = logJson.logs[0];
  console.log(`✅ Audit Log Entry: ${recentLog.method} ${recentLog.endpoint} from ${recentLog.ip_address} (Status: ${recentLog.status_code})`);

  // ─────────────────────────────────────────────────────────────
  // 6. ADMIN MANAGEMENT API (CRUD FOR ENTERPRISE TENANTS)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Testing Admin Management APIs ---');

  // 6a: Create new gaming enterprise tenant
  const compRes = await fetch(`${BASE_URL}/api/admin/companies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_name: 'Epic Battle Royale Studios',
      contact_email: 'infrastructure@epicbattles.in'
    })
  });
  assert.strictEqual(compRes.status, 201);
  const compJson = await compRes.json();
  assert(compJson.api_key && compJson.api_secret);
  const newCompanyId = compJson.company.id;
  const newApiKey = compJson.api_key;
  console.log(`✅ Created company: ${compJson.company.company_name} | API Key: ${newApiKey.substring(0, 16)}...`);

  // 6b: Add IP to new company whitelist
  const addIpRes = await fetch(`${BASE_URL}/api/admin/companies/${newCompanyId}/ips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ip_address: '13.126.44.10',
      description: 'Primary Matchmaking Node'
    })
  });
  assert.strictEqual(addIpRes.status, 201);
  const addIpJson = await addIpRes.json();
  const addedIpId = addIpJson.whitelist_entry.id;
  console.log(`✅ Whitelisted IP: ${addIpJson.whitelist_entry.ip_address} for ${newCompanyId}`);

  // 6c: Add CIDR range
  const addCidrRes = await fetch(`${BASE_URL}/api/admin/companies/${newCompanyId}/ips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ip_range: '13.235.0.0/16',
      description: 'AWS Asia-Pacific (Mumbai) Fleet'
    })
  });
  assert.strictEqual(addCidrRes.status, 201);
  console.log('✅ Whitelisted CIDR range 13.235.0.0/16');

  // 6d: List company IPs
  const listIpsRes = await fetch(`${BASE_URL}/api/admin/companies/${newCompanyId}/ips`);
  const listIpsJson = await listIpsRes.json();
  assert.strictEqual(listIpsJson.total, 2);
  console.log(`✅ Listed ${listIpsJson.total} whitelisted entries for new tenant`);

  // 6e: Verify new company can authenticate from whitelisted IP
  const testUtr3 = '631902' + Math.floor(100000 + Math.random() * 900000);
  const testNewCo = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': newApiKey,
      'X-Forwarded-For': '13.126.44.10'
    },
    body: JSON.stringify({ utr: testUtr3, amount: 50.0 })
  });
  assert.strictEqual(testNewCo.status, 200, 'New tenant with whitelisted IP must succeed');
  console.log('✅ New tenant payment verified seamlessly');

  // 6f: Delete IP from whitelist
  const delRes = await fetch(`${BASE_URL}/api/admin/companies/${newCompanyId}/ips/${addedIpId}`, {
    method: 'DELETE'
  });
  assert.strictEqual(delRes.status, 200);
  console.log('✅ Successfully revoked IP from whitelist');

  // 6g: Verify revoked IP is now rejected
  const testUtr4 = '631902' + Math.floor(100000 + Math.random() * 900000);
  const testRevoked = await fetch(`${BASE_URL}/api/gaming/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': newApiKey,
      'X-Forwarded-For': '13.126.44.10'
    },
    body: JSON.stringify({ utr: testUtr4, amount: 50.0 })
  });
  assert.strictEqual(testRevoked.status, 403, 'Revoked IP must be immediately rejected');
  console.log('✅ Revoked IP immediately rejected with 403 Forbidden');

  console.log('\n🎉 ALL ENTERPRISE GAMING IP WHITELIST TESTS PASSED (100% GREEN)!');
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
