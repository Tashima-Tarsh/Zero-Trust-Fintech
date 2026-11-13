# Forensic UPI Engine

Monorepo starter for defensive UPI payment-session orchestration and forensic triage. Includes Docker Compose, PostgreSQL, n8n workflow exports, a Python FastAPI worker, a React Native source scaffold and a standalone web fallback prototype.

## Trust boundary

- **Client/browser:** creates a UPI intent and may submit optional, consent-based observations. It cannot attest that money moved.
- **n8n:** orchestration only. Webhooks must have n8n header-auth credentials configured before activation; worker calls require a server-side API key.
- **Worker/Postgres:** atomic, auditable VPA leases and payment sessions; independent forensic scoring.
- **Bank/PSP:** only an authenticated, authorized provider message with matching merchant reference, amount, VPA and currency may settle a payment. The demo callback adapter does **not** connect to any real PSP.

## Local development

1. Copy `.env.example` to `.env`; set strong distinct values for `POSTGRES_PASSWORD`, `WORKER_API_KEY`, `PROVIDER_WEBHOOK_SECRET`, `N8N_ENCRYPTION_KEY`. Never commit `.env`.
2. From this directory run `docker compose -f infra/docker-compose.yml --env-file .env up --build -d`.
3. Worker health: `http://127.0.0.1:8000/health`; n8n editor: `http://127.0.0.1:5678`.
4. Import `backend/workflows/*.json` into n8n. Set Header Auth on each Webhook; for HTTP Request nodes configure server-side header credentials named `Worker API Key` with header `Authorization: Bearer <WORKER_API_KEY>`. Keep workflows inactive until both credentials are configured.
5. Seed file inserts **1,000 inactive fictional** `sandboxNNNN@demo` VPAs. Replace with your **own verified/authorized** merchant VPAs and explicitly enable only those approved by your PSP. No real UPI payments can be accepted from demo seeds.
6. `python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt && python -m pytest backend/tests -q`.

## API contracts

- `POST /v1/sessions`: merchant-server only; `Authorization: Bearer <WORKER_API_KEY>`. JSON: `{"merchant_id":"demo","merchant_reference":"order-1","amount_paise":50000,"note":"Order 1"}`. Returns `session_id`, `vpa`, `expires_at`, `status=PENDING`; returns 409 if no eligible merchant-owned VPA is available. Idempotent per merchant/reference.
- `POST /v1/forensics/score`: server-authenticated risk signals, not a settlement decision.
- `GET /v1/sessions/{session_id}`: merchant-server only. Do not expose the worker API key in mobile/web apps.
- `POST /v1/provider-events`: HMAC SHA-256 `X-Provider-Signature` of `<X-Provider-Timestamp>.<raw-body>`. Timestamp is Unix seconds; 5-minute freshness. Provider credential is a **test adapter** and requires PSP-specific verification, source allow-listing, replay handling and actual credited-funds reconciliation in production.

## Structure

- `docs/`: architecture and fraud/mitigation matrix
- `infra/`: local Docker services and database initialization
- `backend/workflows/`: n8n importable orchestration
- `backend/python_nodes/`: standalone forensic helpers
- `backend/worker/`: authenticated HTTP worker
- `mobile-app/`: React Native source-only starter (native projects must be generated before build)
- `web-fallback/`: static browser intent/QR demo; never auto-confirms payment
- `.github/workflows/`: syntax and unit-test CI

## Production gate

Not production-ready. Implement a contractually authorized PSP/bank adapter, verify actual credit and chargeback/reversal semantics, enforce tenant isolation and idempotency under load, encrypt/limit retained telemetry and screenshots, add admin/merchant authentication and consent flows, configure TLS/WAF/network isolation, secrets rotation, signed webhook hardening, logs/metrics and a professional security review. Forensic image and UTR heuristics have false positives and are never conclusive payment evidence.

See `docs/architecture.md` and `docs/fraud_vectors.md`.
