# DISHA Seller Evidence Webhook — Staging Pilot

Implemented by reusing **PR #138**'s timed signed provider response and PostgreSQL replay transaction. The user-supplied `payer-evidence-delivery.cjs` concept contributed: HMAC-SHA256, stable `eventId`, durable outbox, scheduled retries, source-dependent classification. Its second challenge table is intentionally **not** copied.

## End-to-end

1. Payer's eligible payment app returns a signed checkout-specific message to Chrome. No DISHA app is installed.
2. Existing DISHA `/api/upi-app-evidence/timed/accept` verifies the provider signature, order, amount, payee, and 120s reference.
3. PostgreSQL atomically (a) marks the reference used, (b) consumes the provider transaction ID, and (c) inserts seller delivery event into `disha_payer_evidence_outbox`.
4. The optional DISHA server worker leases due events with `FOR UPDATE SKIP LOCKED`, HMAC-signs `timestamp.body` and POSTs the exact event body to a **server-configured** HTTPS seller endpoint.
5. The seller validates timestamp and HMAC using its shared secret and de-duplicates `eventId`. A 2xx response marks delivery; failures schedule exponential retry. The same `eventId` persists across retries.

`GOOGLE_PAY_REPORTED_SUCCESS` means provider-reported success, **not bank-debit verified**. Payer banking information is not available from this bridge.

## Safe single-order staging setup

Seller routing is intentionally limited to **one explicitly configured order ID** until the project has an authoritative seller-to-order registry. Never route all P2P orders to a global seller URL.

Set server-controlled env variables, not browser-supplied:

```bash
DISHA_SELLER_EVIDENCE_PILOT=1
DISHA_SELLER_EVIDENCE_PILOT_ORDER_ID=YOUR_AUTHORIZED_TEST_ORDER_ID
DISHA_SELLER_EVIDENCE_WEBHOOK_URL=https://your-staging-seller.example/webhooks/disha
DISHA_SELLER_EVIDENCE_WEBHOOK_SECRET=AT_LEAST_32_RANDOM_BYTES_SECRET
```

These are placeholders: use your own staging webhook and a random secret. No destination URL or HMAC secret should be obtained from the payer's checkout request, Chrome response, notification, or unsigned external input.

Without `DISHA_SELLER_EVIDENCE_PILOT=1`, the outbox integration is inert and the existing PR #138 provider return continues unchanged.

## Seller verification

Given HTTP request headers:

```
x-disha-event-id: <uuid>
x-disha-timestamp: <Unix seconds>
x-disha-signature: sha256=<hex>
```

Compute `HMAC_SHA256(secret, timestamp + "." + rawRequestBody)` and compare using a constant-time primitive. Reject requests whose timestamp is outside a small allowable skew (e.g. five minutes). Store processed `eventId` with a UNIQUE constraint for idempotency. Return 2xx only after the seller durably commits its event processing.

## Source labels

- `GOOGLE_PAY` → `GOOGLE_PAY_REPORTED_SUCCESS` (currently wired to verified timed provider response only)
- `ANDROID_SMS_NOTIFICATION` → `DEBIT_NOTIFICATION_OBSERVED` (event schema defined; **no live notification adapter wired**)
- `ANDROID_PAYMENT_NOTIFICATION` → `DEBIT_NOTIFICATION_OBSERVED` (event schema defined; **no live notification adapter wired**)
- `PAYER_PROVIDER` → `PAYER_DEBIT_CONFIRMED` (reserved for separately authenticated payer-bank/PSP evidence; **no live provider adapter wired**)

The user-supplied `payer-evidence-delivery.cjs` had an import `../../financial/session-evidence`, which is not available in this checkout repository. Thus that module was not copied verbatim and its notification tests are not evidence of deployed notification capture.

## Still missing

- Independent live eligible UPI payment-app signed response and genuine trusted provider public keys
- PostgreSQL-backed staging run with actual seller 2xx, timeout, retries, concurrent workers and crash/restart; automated fake tests are not a staging deployment
- Authoritative multi-seller routing with tenant isolation and seller registration
- Authentic signed payer-account debit adapter if the result needs to assert bank debit rather than GPay-reported success
- Formal production security review (webhook endpoint registration, SSRF and DNS rebinding, lifecycle and cancellation, encryption and retention policy)

Production is untouched: stacked draft PR for isolated code review and tests.
