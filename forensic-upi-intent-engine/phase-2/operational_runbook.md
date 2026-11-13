# Phase 2 — Native deployment checklist (without Docker)

## Prerequisites

Phase 1 PostgreSQL, Node/n8n, Python and a secure host environment. **Important:** `database/schema.sql` is the user-provided simplified native schema with string `session_id`; the existing FastAPI worker expects the richer UUID `infra/postgres/init.sql` schema. They are **not interchangeable**. Use a dedicated worker database initialized from `infra/postgres/init.sql`; do not run both schemas in the same database.

For a fresh worker database under a privileged developer/admin role, initialize the rich schema and then the Phase 2 migration. On PostgreSQL, `infra/postgres/init.sql` also creates a separate `n8n` DB; do not rerun if that database exists. Production migrations need a controlled migration manager and least-privileged role.

```bash
# From forensic-upi-intent-engine/ with a newly created, empty WORKER database:
psql -h 127.0.0.1 -U fintech -d fintech -v ON_ERROR_STOP=1 -f infra/postgres/init.sql
psql -h 127.0.0.1 -U fintech -d fintech -v ON_ERROR_STOP=1 -f database/migrations/002_phase2_reconciliation.sql
```

Install Python dependencies from `backend/requirements.txt`, and install the `tesseract-ocr` native binary for OCR. The worker is a distinct service from n8n:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
sudo install -m 644 config/systemd/forensic-worker.service /etc/systemd/system/forensic-worker.service
# Populate /etc/forensic-upi-intent-engine/worker.env securely:
# PGHOST=127.0.0.1
# PGPORT=5432
# PGUSER=fintech
# PGDATABASE=fintech
# PGPASSWORD=<strong-random-password>
# WORKER_API_KEY=<long-random-private-key>
# REDIS_URL=redis://127.0.0.1:6379/0
# PROVIDER_WEBHOOK_SECRET=<independent-mock-only-key>
sudo systemctl daemon-reload
sudo systemctl enable --now forensic-worker
curl http://127.0.0.1:8000/health
```

The service assumes the project lives at `/opt/forensic-upi-intent-engine` and a `forensic` service user exists from Phase 1. Configure Redis as a local service if `REDIS_URL` is enabled, and never expose the local worker port to the internet.

## Import n8n Phase 2

1. Import `n8n-workflows/02_intent_verifier.json` into your *native* n8n instance.
2. Set Header Auth for the incoming Webhook and outbound HTTP Request. Outbound header must be `Authorization: Bearer <WORKER_API_KEY>`, supplied only through server-held n8n credentials.
3. Import updated `n8n-workflows/04_statement_parser.json`; its hourly Schedule Trigger calls a read-only queue summary. Configure matching auth.
4. Leave both workflows inactive until DB migration, token validation, rate limiting, n8n execution-storage policy and network isolation are tested.
5. Call the webhook **through your authenticated merchant backend** with a known existing open `session_id` and unique UUID `submission_id`. The frontend must never hold n8n or worker credentials.

## Verification

```bash
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python scripts/validate_phase2.py
curl http://127.0.0.1:8000/health
```

Check that every test screenshot, including OCR `SUCCESS`, returns `PENDING_RECONCILIATION`. Verify the queue grows, replayed submission IDs do not multiply entries, a reused ID with different evidence is rejected, and no ledger row or `PAID` status is created by 02.

## Still required for real-world financial acceptance

An authorized bank/PSP reconciliation adapter, actual credited-funds evidence, real VPA onboarding, bank-side reference validation, settlement/reversal handling, merchant-specific server authentication, hardened image intake, monitoring/retention controls, load/concurrency tests, and independent security/compliance validation. There is no meaningful guarantee of **zero financial failure** from this prototype.
