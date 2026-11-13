# Phase 2 — API contracts

## n8n webhook (native)

`POST /webhook/verify-payment` requires n8n Webhook Header Auth and server-only access. The workflow calls local `http://127.0.0.1:8000/v1/intent/evaluate` with its own worker header-auth credential.

**Never call n8n from an untrusted mobile client with an embedded shared secret.** A tenant-scoped merchant proxy should own these credentials and generate the `submission_id`.

Example request (illustrative UUIDs, **no screenshot required**):

```json
{
  "merchant_id": "demo",
  "session_id": "00000000-0000-4000-8000-000000000001",
  "submission_id": "00000000-0000-4000-8000-000000000002",
  "time_in_app_ms": 8400,
  "target_package": "com.google.android.apps.nbu.paisa.user",
  "claimed_utr": "123456789012",
  "retry_count": 0,
  "screenshot_consent": false
}
```

To analyze an explicitly supplied screenshot, add `screenshot_base64` (JPEG/PNG, max 2 MiB after decode) and `screenshot_consent: true`. Do not send screenshots of other applications without platform-supported consent and legitimate user authority. If OCR fails, the request fails safely; it does not settle.

Illustrative response:

```json
{
  "decision": "PENDING_RECONCILIATION",
  "queue_status": "OPEN",
  "risk_score": 0,
  "risk_flags": ["no_image_supplied"],
  "can_confirm_payment": false,
  "ledger_entries_created": 0,
  "awaits_authoritative_bank_reconciliation": true
}
```

Actual scores can differ. **Any** risk score leads to holding for bank verification, including 0 and 100.

## Worker routes

- `POST /v1/intent/evaluate`: server-authenticated, merchant-and-session-bound; writes immutable submission and holding queue, not ledger.
- `GET /v1/reconciliation/queue/summary`: server-authenticated aggregate totals; queried hourly by 04.
- `GET /v1/reconciliation/queue?merchant_id=demo`: server-authenticated, first 100 open reviews; do not expose global worker key to merchant clients.
- Existing `POST /v1/statements/preview`: parses untrusted CSV **for review only**; never settles accounts.
- Existing `POST /v1/provider-events`: mock event transport; never marks PAID.

Potential client evidence fields (e.g. target_package) are low-trust even when submitted by an authenticated server. API key alone does not supply full merchant tenant isolation.

## 04 hourly flow

The Schedule Trigger calls `/v1/reconciliation/queue/summary` once per hour. This only observes count changes. **It does not automatically import a bank statement or credit a ledger.** Genuine settlement requires an authorized bank feed, bank event dedupe, beneficiary/amount/currency matching, reversal handling and a balanced ledger transaction, none of which is implemented in this phase.
