# Zero-Trust-Fintech — Forensic UPI Intent Engine

Defense-oriented prototype that separates **payment initiation**, **forensic triage**, **bank reconciliation**, and **financial accounting**.

## Phase 1 — Operational Foundation (native, no Docker)

The requested Phase 1 files are maintained in these **separate, native-host** paths:

- [`database/schema.sql`](database/schema.sql) — rotating VPA pool, forensic payment session with `telemetry_data`, `extracted_status`, `fraud_flags`, `updated_at`, and append-only ledger constraints.
- [`database/seed_vpas.sql`](database/seed_vpas.sql) — SQL template with the five example IDs **commented out**; the actual 1,000 verified merchant VPAs have **not** been supplied or imported.
- [`python-forensics/ela_analysis.py`](python-forensics/ela_analysis.py) — `calculate_ela(image_path)` and a CLI compatible with the supplied usage, using in-memory JPEG recompression and returning advisory (not conclusive) scores.
- [`n8n-workflows/01_link_generator.json`](n8n-workflows/01_link_generator.json) — importable inactive, header-authenticated webhook; delegates **atomic** VPA leasing to the existing worker to avoid races from separate SQL steps. In a native deployment the worker URL is `http://127.0.0.1:8000/v1/sessions`.
- [`docs/phase1_bare_metal.md`](docs/phase1_bare_metal.md) — Ubuntu/macOS native PostgreSQL, Node/n8n, Python and systemd instructions.

**Do not point the existing FastAPI worker at `database/schema.sql`.** It uses the different merchant-scoped schema under `infra/postgres/init.sql`. They are alternative Phase 1 and engine schemas and are not interchangeable. The new link generator works only when the backend worker and its corresponding `infra/` database have been started and configured. The native database and n8n can be installed separately without enabling any collection flow.

**Financial truth:** ELA, OCR, app switching, telemetry and screenshots do not verify UPI credit. A signed mock callback alone is also insufficient. Real settlement requires an authenticated bank/PSP data source plus reconciliation. The bare-metal ledger rejects mutation by ordinary triggers but is **not** a full production-grade balanced accounting system.

### Quick Phase 1 checks

```bash
psql -h 127.0.0.1 -U forensic_user -d forensic_db -v ON_ERROR_STOP=1 -f database/schema.sql
psql -h 127.0.0.1 -U forensic_user -d forensic_db -v ON_ERROR_STOP=1 -f database/seed_vpas.sql
python3 -m venv .venv
.venv/bin/python -m pip install -r python-forensics/requirements.txt
.venv/bin/python python-forensics/ela_analysis.py path/to/example.jpg
```

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
