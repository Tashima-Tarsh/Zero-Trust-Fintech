'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { canonicalEvidence, readDebitEvidenceReceipt } = require('../../../../financial/session-evidence');
const { createSessionLab, PACKAGE } = require('./server');

async function main() {
  console.log('Synthetic HTTP test vectors. No live notification or debit.');
  const lab = await createSessionLab({ report: response => console.log(JSON.stringify(response)) });
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
    async function enroll(binding = {}) {
      const [created, { orderId, token }] = await post('/lab/session', binding);
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
    // Production-style cross-app pairing: checkout bearer never reaches Android.
    // The observer receives a separate 60-second scoped token, and the ticket
    // may be redeemed exactly once. All observations here remain synthetic.
    const [createdPairOrder,pairOrder]=await post('/lab/session',{});
    assert.equal(createdPairOrder,201);
    const [pairIssued,pair]=await post('/api/session-evidence/pairing/issue',{
      orderId:pairOrder.orderId,token:pairOrder.token
    },pairOrder.token);
    assert.equal(pairIssued,201,JSON.stringify(pair));
    assert.match(pair.ticket,/^[A-Za-z0-9_-]{43}$/);
    assert.ok(pair.expiresAt>Date.now() && pair.expiresAt<=Date.now()+60000);
    const [redeemCode,redeemed]=await post('/api/session-evidence/pairing/redeem',{ticket:pair.ticket});
    assert.equal(redeemCode,200,JSON.stringify(redeemed));
    assert.equal(redeemed.orderId,pairOrder.orderId);
    assert.notEqual(redeemed.observerToken,pairOrder.token,'Android must not obtain checkout bearer');
    assert.equal((await post('/api/session-evidence/pairing/redeem',{ticket:pair.ticket}))[0],409,
      'one-time ticket cannot be replayed');
    const pairedSource='com.google.android.apps.nbu.paisa.user';
    const [pairAuthCode,pairLease]=await post('/api/session-evidence/authorize',{
      orderId:redeemed.orderId,token:redeemed.observerToken,deviceId,consent:true,
      sourcePackage:pairedSource,publicKeyPem:publicKey.export({type:'spki',format:'pem'})
    },redeemed.observerToken);
    assert.equal(pairAuthCode,201,JSON.stringify(pairLease));
    assert.deepEqual(pairLease.allowedPackages,[pairedSource]);
    const pairedEvent={
      protocol:'DISHA-DEBIT-UTR-OBSERVATION-V1',eventId:crypto.randomUUID(),
      orderId:pairOrder.orderId,nonce:pairLease.nonce,deviceId,packageName:pairedSource,
      postedAt:Date.now(),amountPaise:'100',payeeVpa:'fixture@invalid',
      transactionRef:'000000000190',status:'SUCCESS',referenceKind:'RRN'
    };
    const [pairEventStatus,pairEventResponse]=await post('/api/session-evidence/event',{
      token:redeemed.observerToken,evidence:pairedEvent,
      signature:sign(canonicalEvidence(pairedEvent))
    });
    assert.equal(pairEventStatus,202,JSON.stringify(pairEventResponse));
    assert.equal(pairEventResponse.observationState,'DEBIT_UTR_OBSERVED');
    assert.equal(pairEventResponse.paymentVerified,false);
    assert.equal(pairEventResponse.debitVerified,false);
    const scopedStatus=await fetch(origin+'/api/session-evidence/status/'+
      encodeURIComponent(pairOrder.orderId)+'?token='+encodeURIComponent(redeemed.observerToken));
    assert.equal(scopedStatus.status,401,'observer token must not access checkout status');
    await lab.pool.query(
      'UPDATE disha_android_observation_pairings SET expires_at=$2 WHERE order_id=$1',
      [pairOrder.orderId,Date.now()-1]);
    const expiredScopedEvent={...pairedEvent,eventId:crypto.randomUUID(),transactionRef:'000000000191'};
    const [expiredScopedStatus,expiredScopedBody]=await post('/api/session-evidence/event',{
      token:redeemed.observerToken,evidence:expiredScopedEvent,
      signature:sign(canonicalEvidence(expiredScopedEvent))
    });
    assert.equal(expiredScopedStatus,401,JSON.stringify(expiredScopedBody),
      'expired observer capability cannot submit new events');
    const [badPairStatus]=await post('/api/session-evidence/pairing/issue',{
      orderId:pairOrder.orderId,token:'bad'
    },'bad');
    assert.equal(badPairStatus,401);
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
    const sourcePackage = 'com.google.android.apps.nbu.paisa.user';
    const binding = { sourcePackage, amountPaise: '100', payeeVpa: 'fixture@invalid' };
    const real = await enroll(binding);
    const observed = (lease, fields = {}) => event(lease, {
      protocol: 'DISHA-DEBIT-UTR-OBSERVATION-V1', packageName: sourcePackage,
      transactionRef: '000000000101', referenceKind: 'RRN', ...fields
    });
    const reference = observed(real);
    assert.equal(canonicalEvidence(reference), JSON.stringify(reference));
    assert.equal(accepted.observationState, undefined);
    await expect(submit(real, event(real)), 422, 'EVIDENCE_FIELDS_INVALID');
    await expect(submit(real, observed(real, { packageName: 'com.phonepe.app' })), 422, 'EVIDENCE_FIELDS_INVALID');
    await expect(submit(real, observed(real, { referenceKind: 'TRANSACTION_ID' })), 422, 'EVIDENCE_FIELDS_INVALID');
    await expect(submit(real, observed(real, { transactionRef: null })), 422, 'EVIDENCE_FIELDS_INVALID');
    await expect(submit(real, observed(real, { referenceKind: 'UTR' }), sign(JSON.stringify(reference))),
      401, 'DEVICE_SIGNATURE_INVALID');
    await expect(submit(real, observed(real, { postedAt: 1000, transactionRef: '000000000102' })),
      409, 'SESSION_TIME_INVALID');
    await expect(submit(real, observed(real, { amountPaise: '101', transactionRef: '000000000103' })),
      409, 'AMOUNT_MISMATCH');
    await expect(submit(real, observed(real, { payeeVpa: 'other@invalid', transactionRef: '000000000104' })),
      409, 'PAYEE_MISMATCH');
    const received = await expect(submit(real, reference), 202, 'SIGNAL_MATCHED');
    assert.equal(received.observationState, 'DEBIT_UTR_OBSERVED');
    assert.equal(received.referenceKind, 'RRN');
    assert.equal(received.debitVerified, false);
    assert.equal(received.paymentVerified, false);
    const checkout = {status:'PENDING',expiresAt:Date.now()+60000,
      challengeAmount:'1.00',vpaAddress:'fixture@invalid'};
    // The primary test order deliberately holds several conflicting attempts.
    const conflict = await readDebitEvidenceReceipt(lab.pool, real.orderId, checkout);
    assert.equal(conflict.receiptError, 'CONFLICTING_OR_INVALID_EVIDENCE');
    const clean = await enroll(binding);
    await expect(submit(clean, observed(clean,{transactionRef:'000000000105'})), 202, 'SIGNAL_MATCHED');
    // Test-only synthetic pin: production does NOT trust checkout-enrolled keys.
    // The stronger receipt is intentionally unavailable without OEM/admin pin.
    assert.equal((await readDebitEvidenceReceipt(lab.pool, clean.orderId, checkout)).receiptError,
      'TRUSTED_DEVICE_NOT_CONFIGURED');
    const syntheticPin = crypto.createHash('sha256')
      .update(publicKey.export({type:'spki',format:'der'})).digest('hex');
    const previousPin=process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
    process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256=syntheticPin;
    const firstLookup = await readDebitEvidenceReceipt(lab.pool, clean.orderId, checkout);
    assert.deepEqual(await readDebitEvidenceReceipt(lab.pool, clean.orderId, checkout), firstLookup,
      'Read-only callbacks return the same receipt without side effects');
    assert.deepEqual(Object.keys(firstLookup.debitEvidenceReceipt).sort(),
      ['orderId','state','source','sourceTrust','amountPaise','reference','referenceKind','observedAt','receiptReference'].sort());
    assert.equal(firstLookup.debitEvidenceReceipt.reference,'000000000105');
    assert.equal(firstLookup.debitEvidenceReceipt.referenceKind,'RRN');
    assert.equal(firstLookup.debitEvidenceReceipt.sourceTrust,'PAYER_APP_NOTIFICATION_UNVERIFIED');
    const smsSource='com.google.android.apps.messaging';
    const smsLease=await enroll({sourcePackage:smsSource,amountPaise:'100',payeeVpa:'fixture@invalid'});
    const smsEvent=observed(smsLease,{packageName:smsSource,transactionRef:'000000000136'});
    await expect(submit(smsLease,smsEvent),202,'SIGNAL_MATCHED');
    const smsReceipt=await readDebitEvidenceReceipt(lab.pool,smsLease.orderId,checkout);
    assert.equal(smsReceipt.debitEvidenceReceipt?.source,smsSource);
    assert.equal(smsReceipt.debitEvidenceReceipt?.sourceTrust,'SMS_NOTIFICATION_SENDER_UNVERIFIED');
    assert.equal(smsReceipt.debitEvidenceReceipt?.reference,'000000000136');
    assert.equal(smsReceipt.debitEvidenceReceipt?.state,'DEBIT_EVIDENCE_OBSERVED');

    assert.deepEqual(await readDebitEvidenceReceipt(lab.pool, clean.orderId,{...checkout,expiresAt:0}),{});
    assert.deepEqual(await readDebitEvidenceReceipt(lab.pool, second.orderId,checkout),{});
    if (previousPin===undefined) delete process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256;
    else process.env.DISHA_UDEB_PINNED_DEVICE_KEY_SHA256=previousPin;
    await post('/api/session-evidence/revoke', {orderId:clean.orderId,token:clean.token},clean.token);
    assert.deepEqual(await readDebitEvidenceReceipt(lab.pool, clean.orderId,checkout),{});
    await expect(submit(real, observed(real)), 409, 'EVIDENCE_REPLAY_BLOCKED');
    const other = await enroll(binding);
    await expect(submit(other, observed(other)), 409, 'TRANSACTION_REFERENCE_REPLAY');
    await post('/api/session-evidence/revoke', { orderId: real.orderId, token: real.token }, real.token);
    await expect(submit(real, observed(real)), 410, 'SESSION_EXPIRED');
    console.log('DEBIT_UTR_OBSERVATION_HTTP_PASS (synthetic protocol vectors only)');
    console.log('SESSION_OBSERVATION_HTTP_PASS: package, fields, signature, binding, replay, revoke, expiry, unverified flags');
  } finally {
    server.close();
    await lab.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
