# DISHA Timed Provider Return — 120-second signed response (research)

This integrates the user-provided `timed-payment-bridge.cjs`, `timed-payment-bridge.js` and synthetic tests with **the existing DISHA UPI app evidence verifier**, not a duplicate signature stack.

## Existing checkout integration

On the experimental P2P checkout, use `?timedprovider=1` instead of `?paymentrequest=1`. The existing optional PaymentRequest panel is reused. It remains subject to the prepayment authorization gate.

1. **Check method** sends a session-authenticated POST to `/api/upi-app-evidence/timed/prepare`. The server issues a random 128-bit `tr` that expires within 120 seconds (or session expiry, whichever comes first); PostgreSQL stores it.
2. Chrome `canMakePayment()` checks whether the installed app supports `https://tez.google.com/pay`. A false result does not trigger a payment.
3. **Pay** performs `PaymentRequest.show()` on the user click. This can initiate an actual payment on a device that has an eligible app. Do not run it using a real account unless that is intended.
4. On a participating app return, the checkout POSTs `transactionRef`, `methodName`, and the raw signed `tezResponse`, `signature`, `signatureKeyId` under its session token to `/api/upi-app-evidence/timed/accept`.
5. Existing `verifyUPIResponse` verifies signature and source-reported SUCCESS against the **server-stored session amount/payee and random 120-second ref**.
6. A PostgreSQL transaction locks the challenge row, inserts the transaction ID into the existing global app-evidence replay table, and marks the reference used. Concurrent duplicate submissions and attempts to reuse a txn ID on another order fail closed.

The returned state is `PROVIDER_REPORTED_SUCCESS`, **not `DEBIT_VERIFIED`**. No ledger, reconciliation or settlement state is updated.

## Source files

- `financial/timed-payment-bridge.js` — authenticated `/prepare` and `/accept` routes, durable PostgreSQL challenge store, one transaction to consume both reference and global provider txn id.
- `public/p2p-paymentrequest-probe.js` — modified existing opt-in P2P PaymentRequest UI for 120-second prepared challenge; no duplicate checkout view.
- `public/cosmic-checkout.js` and existing delivery mirrors — sends prepare/accept with checkout session token.
- `public/timed-payment-bridge.js` — standalone reusable browser adapter for custom integration tests.
- `tests/test-timed-payment-bridge.js` — server success/mismatch, replay, synthetic browser and SQL atomicity tests.
- `server.js` — mounts the endpoint behind existing `verifyLimiter`, initializes durable challenge table.

## Important constraints / test gates

- Existing generic P2P checkout does not invent merchant category code (`mc`) or claim all Google Pay India merchants are eligible. Provider-specific required method fields may require approved merchant configuration.
- The `https://tez.google.com/pay` instrument was **not eligible** on the user's Chrome 145 Android 17 AVD; no genuine provider signed callback has been observed.
- The signing key allowlist must contain **real, independently authenticated** Google Pay public keys, configured only on the server in `DISHA_GOOGLE_PAY_TRUSTED_PUBLIC_KEYS_JSON`. Never trust a public key sent by the browser or a self-signed fixture from a live device.
- Regression tests use ephemeral local P-256 test keys and memory fakes; only real PostgreSQL integration and eligible app callback can prove production readiness.
- `PROVIDER_REPORTED_SUCCESS` is a provider's signed report, not independent bank-debit attestation.
- Consent: `PaymentRequest.show()` only from user gesture. If no eligible app, never start payment; do not silently fall back to notification reading or auto-grant permissions.
- This branch is for code review and tests. Production remains unchanged until approval.

## Local test

```bash
npm ci
node tests/test-timed-payment-bridge.js
npm test
```

For live Android behavior, open the existing local checkout in Android Chrome with `?timedprovider=1` (and its normal checkout parameters), log in and complete the existing authorization. Check that the response data and signature reach the server while never marking independent bank debit as verified.
