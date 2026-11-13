# Forensic UPI Intent Engine

Defense-oriented prototype that separates **payment initiation**, **forensic triage**, **bank reconciliation**, and **financial accounting**.

## Included
- PostgreSQL schema for merchant-scoped VPA leasing, session lifecycle, bank event inbox and immutable financial ledger.
- Redis for fail-closed API rate limiting (internal network).
- FastAPI Python worker with server-side authentication, session assignment and read-only forensic/statement analysis.
- Four n8n importable JSON workflows: session links, intent triage, passive VPA health, bank-statement preview.
- ELA and conservative OCR helpers, attestation-report validator and consent-based behavioral aggregate scoring.
- React Native source and Android bridge stubs for UPI deep-link handoff, lifecycle timing and **explicitly consented own-window** snapshot. No silent third-party payment-app screen capture.
- PWA fallback with generated UPI intent and QR.

## Quick start
1. `cp .env.example .env` and replace all example secrets; never commit `.env`.
2. `docker compose -f infra/docker-compose.yml --env-file .env up --build -d` from this folder.
3. Local worker: `http://127.0.0.1:8000/health`; local n8n: `http://127.0.0.1:5678`.
4. Import `backend/workflows/01_*.json` through `04_*.json`. Configure n8n Webhook Header Auth, and outbound HTTP Header Auth named `Worker API Key` with `Authorization: Bearer <WORKER_API_KEY>` before activating.
5. Demo seed provides 1,000 **fictional, inactive** VPAs (`sandbox0001@demo` etc.). Real merchant-owned VPAs must be imported through an authorized administrative process and explicitly enabled; no real VPAs are included.
6. Tests: `python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt && python -m pytest backend/tests -q`; structure `python scripts/validate_structure.py`.

## Payment trust model
A mobile app returning to the merchant screen, a plausible UTR, matching payment screenshot, JPEG ELA result or certificate hash are **signals**, not settlement evidence. A provider webhook must be authenticated and reconciled with bank-side credited-funds evidence. The included adapter is a **mock**: it cannot settle sessions or write ledger entries. Raw images and third-party screen content are not captured automatically.

## Production blockers
Requires authorized bank/PSP integration, credential storage/rotation, ledger posting tied to reconciled credits, settlement/reversal handling, tested provider signature semantics, tenant-scoped server credentials, native iOS/Android build integration, risk-rule calibration, end-to-end privacy/consent and regulatory review, security testing, observable reconciliation, and load testing. Do not use as a live payment acceptance system.

See [architecture](docs/architecture.md), [fraud matrix](docs/fraud_matrix.md) and [API specification](docs/api_spec.md).
