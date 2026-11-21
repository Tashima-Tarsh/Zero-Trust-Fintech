'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { canonicalEvidence } = require('../../../../financial/session-evidence');
const { createSessionLab, PACKAGE } = require('./server');

async function main() {
  const lab = await createSessionLab();
  const server = lab.app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    async function post(path, body, token) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['x-csrf-token'] = token;
      const response = await fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
      return [response.status, await response.json()];
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceId = crypto.randomUUID();
    async function enroll() {
      const [created, { orderId, token }] = await post('/lab/session', {});
      assert.equal(created, 201);
      const [status, lease] = await post('/api/session-evidence/authorize', {
        orderId, token, deviceId, consent: true, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
      }, token);
      assert.equal(status, 201, JSON.stringify(lease));
      return { token, orderId, nonce: lease.nonce };
    }
    const event = (lease, fields = {}) => ({
      protocol: 'DISHA-SESSION-EVIDENCE-V1', eventId: crypto.randomUUID(),
      orderId: lease.orderId, nonce: lease.nonce, deviceId, packageName: PACKAGE,
      postedAt: Date.now(), amountPaise: '100', payeeVpa: 'fixture@invalid',
      transactionRef: '000000000001', status: 'SUCCESS', ...fields
    });
    const sign = bytes => crypto.sign('sha256', Buffer.from(bytes), privateKey).toString('base64url');
    const submit = (lease, evidence, signature = sign(JSON.stringify(evidence))) =>
      post('/api/session-evidence/event', { token: lease.token, evidence, signature });
    const expect = async (promise, status, reason) => {
      const [code, reply] = await promise;
      assert.equal(code, status, JSON.stringify(reply));
      assert.equal(reply.error || reply.decisionState, reason, JSON.stringify(reply));
      return reply;
    };
    const lease = await enroll();
    const matching = event(lease);
    assert.throws(() => canonicalEvidence(matching), /EVIDENCE_FIELDS_INVALID/);
    assert.equal(canonicalEvidence(matching, new Set([PACKAGE])), JSON.stringify(matching));
    await expect(submit(lease, event(lease, { packageName: 'com.android.shell' })), 422, 'EVIDENCE_FIELDS_INVALID');
    await expect(submit(lease, event(lease, { amountPaise: 'invalid' })), 422, 'EVIDENCE_FIELDS_INVALID');
    await expect(submit(lease, matching, sign('other payload')), 401, 'DEVICE_SIGNATURE_INVALID');
    await expect(submit(lease, event(lease, { amountPaise: '101', transactionRef: '000000000002' })), 409, 'AMOUNT_MISMATCH');
    await expect(submit(lease, event(lease, { payeeVpa: 'other@invalid', transactionRef: '000000000003' })), 409, 'PAYEE_MISMATCH');
    const accepted = await expect(submit(lease, matching), 202, 'SIGNAL_MATCHED');
    assert.equal(accepted.paymentVerified, false);
    assert.equal(accepted.debitVerified, false);
    await expect(submit(lease, matching), 409, 'EVIDENCE_REPLAY_BLOCKED');
    const second = await enroll();
    await expect(submit(second, event(second)), 409, 'TRANSACTION_REFERENCE_REPLAY');
    const [revokedStatus, revoked] = await post('/api/session-evidence/revoke', {
      orderId: lease.orderId, token: lease.token
    }, lease.token);
    assert.equal(revokedStatus, 200);
    assert.equal(revoked.revoked, true);
    await expect(submit(lease, event(lease)), 410, 'SESSION_EXPIRED');
    await lab.pool.query('UPDATE disha_session_evidence_consents SET expires_at=$2 WHERE order_id=$1',
      [second.orderId, Date.now() - 1]);
    await expect(submit(second, event(second)), 410, 'SESSION_EXPIRED');
    console.log('SESSION_OBSERVATION_HTTP_PASS: package, fields, signature, binding, replay, revoke, expiry, unverified flags');
  } finally {
    server.close();
    await lab.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
