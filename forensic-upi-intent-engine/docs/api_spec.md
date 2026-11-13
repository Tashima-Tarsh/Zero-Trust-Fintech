# Server-side API and n8n payloads

All `/v1/*` worker routes require `Authorization: Bearer <WORKER_API_KEY>` unless expressly documented otherwise. Worker credentials must only exist in **merchant servers or n8n**, never public browsers or React Native bundles. This is a shared internal key scaffold, not tenant-grade access control.

## POST /v1/sessions
```json
{"merchant_id":"demo","merchant_reference":"order-42","amount_paise":50000,"currency":"INR","note":"Order 42"}
```
Returns `id, vpa, status:PENDING, expires_at`. `409` when no merchant-approved VPA is available. Duplicate merchant/reference returns the same session only if amount and note match.

## POST /v1/forensics/score
```json
{"elapsed_ms":800,"retry_count":4,"utr":"123456789012","image_ela_score":18.2}
```
Returns advisory risk flags, `risk_score` and `can_confirm_payment:false`.

## GET /v1/vpas/canary?merchant_id=demo
Reports enabled/healthy/leased VPA counts and stale checks only. **Does not transmit money**, probe bank apps, or validate account ownership.

## POST /v1/statements/preview
```json
{"csv_text":"date,description,reference,credit,amount,currency\n2026-11-14,Example,123456789012,500.00,,INR"}
```
Returns normalized candidate credit rows. Input is untrusted until imported from an authenticated bank source; **never** settles automatically.

## POST /v1/provider-events
Mock adapter: raw JSON event; headers `X-Provider-Timestamp` (Unix seconds), `X-Provider-Signature`: `sha256=<hex HMAC-SHA256(secret, timestamp + '.' + raw body)>`. Replay protection and exact amount, VPA, reference checks are enabled. A SUCCESS claim produces `awaiting_bank_reconciliation`, **not PAID**. Actual PSP-specific signature scheme and credit verification must replace this adapter for live use.

## n8n workflows
- `01_link_generator.json`: POST `forensic-upi/create-session`
- `02_intent_verifier.json`: POST `forensic-upi/score`
- `03_canary_tester.json`: authenticated POST `forensic-upi/vpa-health` for passive VPA counts
- `04_statement_parser.json`: authenticated POST `forensic-upi/statement-preview` for review-only CSV parsing

The webhooks need configured Header Auth credentials. HTTP Request nodes need server-side `Worker API Key` (header-auth credentials). Workflow JSON is deliberately inactive by default.
