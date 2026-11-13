# Phase 1 — Operational Foundation (without Docker)

This is an **additive** native-host setup to accompany the original Phase 1 outline. Existing `infra/`, `backend/`, `mobile-app/`, `web-fallback/`, and Docker configs have not been replaced.

## Layout (new files)

```text
forensic-upi-intent-engine/
├── config/
│   ├── database.js
│   ├── n8n_config.json
│   └── systemd/forensic-n8n.service
├── database/
│   ├── schema.sql
│   └── seed_vpas.sql
├── n8n-workflows/
│   ├── 01_link_generator.json
│   ├── 02_intent_verifier.json
│   ├── 03_canary_tester.json
│   └── 04_statement_parser.json
├── python-forensics/
│   ├── requirements.txt
│   ├── ela_analysis.py
│   └── ocr_extractor.py
└── mobile-app/  # existing code, unchanged
```

## Step A — Native PostgreSQL (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
sudo -u postgres psql
```

Inside `psql` (replace the illustrative password with a unique strong secret):

```sql
CREATE DATABASE forensic_db;
CREATE USER forensic_user WITH PASSWORD 'REPLACE_WITH_RANDOM_SECRET';
GRANT ALL PRIVILEGES ON DATABASE forensic_db TO forensic_user;
\connect forensic_db
GRANT USAGE, CREATE ON SCHEMA public TO forensic_user;
\q
```

Apply the **exact Phase 1 schema** supplied in the plan:

```bash
export PGPASSWORD='REPLACE_WITH_RANDOM_SECRET'
psql -h 127.0.0.1 -U forensic_user -d forensic_db -v ON_ERROR_STOP=1 -f database/schema.sql
psql -h 127.0.0.1 -U forensic_user -d forensic_db -v ON_ERROR_STOP=1 -f database/seed_vpas.sql
unset PGPASSWORD
```

The `seed_vpas.sql` file is a safe blank template: no real VPAs were provided. Insert your own **verified, authorized** 1,000 IDs in the documented `INSERT ... ON CONFLICT` form. Do not insert `your_real_id_1@oksbi` placeholders or mark fake accounts as real.

**Compatibility limitation:** This user-supplied Phase 1 SQL schema is preserved literally, but it is *not compatible* with the richer, merchant-scoped FastAPI worker schema in `infra/postgres/init.sql`. Run Phase 1 setup on a **separate empty** `forensic_db`; use the `infra/` schema for the existing worker, not both in the same database. SQL here is a scaffold rather than a production-grade immutable financial ledger.

On macOS, `brew install postgresql`, followed by the Homebrew service and equivalent role/database creation, is the native alternative. systemd commands in this guide apply to Linux.

## Step B — Native Node.js and n8n

Install a supported current Node.js LTS using your trusted OS/package-manager channel and confirm your installed n8n version supports that runtime. Then:

```bash
sudo npm install -g n8n
n8n --version
```

**Never use example admin passwords in production.** n8n uses its own supported owner/user-management setup. Legacy `N8N_BASIC_AUTH_*` settings in the pasted proposal should not be relied upon as the sole protection. Do not expose its editor or webhook endpoints to the public internet without TLS, authorization, and a reverse proxy.

`config/n8n_config.json` documents the intended values. **n8n does not automatically read this JSON file**: provide real values as process environment variables. For a host install, set these privately in `/etc/forensic-upi-intent-engine/n8n.env` (restrict to root and the service account):

```dotenv
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=127.0.0.1
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=forensic_db
DB_POSTGRESDB_USER=forensic_user
DB_POSTGRESDB_PASSWORD=REPLACE_WITH_RANDOM_SECRET
N8N_ENCRYPTION_KEY=REPLACE_WITH_32_PLUS_RANDOM_CHARACTERS
N8N_HOST=127.0.0.1
N8N_PORT=5678
N8N_PROTOCOL=http
```

Create the unprivileged account and directories on Ubuntu:

```bash
sudo useradd --system --home-dir /var/lib/forensic-n8n --shell /usr/sbin/nologin forensic
sudo install -d -m 750 /etc/forensic-upi-intent-engine
sudo install -m 640 -o root -g forensic /dev/null /etc/forensic-upi-intent-engine/n8n.env
# Edit the environment file securely, never store real secrets in Git.
sudo install -d -m 755 /opt/forensic-upi-intent-engine
# Copy or clone this project into /opt/forensic-upi-intent-engine as appropriate.
sudo install -m 644 config/systemd/forensic-n8n.service /etc/systemd/system/forensic-n8n.service
sudo systemctl daemon-reload
sudo systemctl enable --now forensic-n8n
sudo systemctl status forensic-n8n
```

Make sure `/etc/forensic-upi-intent-engine/n8n.env` is populated **before** enabling the service. `n8n start` can also run in a terminal for a manual smoke test. Use `journalctl -u forensic-n8n -f` for errors.

**n8n workflows:** `n8n-workflows/*.json` are byte-for-byte copies of the existing `backend/workflows/*.json`. They remain inactive until all webhook Header Auth and outbound worker API credentials are configured. Running n8n by itself does not start the Python worker; those workflows also require a reachable worker and their `http://worker:8000` URLs must be changed to the actual, secured native worker address before activation.

## Step C — Native Python forensics

```bash
sudo apt-get install -y python3 python3-pip python3-venv tesseract-ocr
python3 -m venv .venv
.venv/bin/python -m pip install -r python-forensics/requirements.txt
.venv/bin/python -m compileall -q python-forensics
```

These are **libraries, not n8n Code-node modules**: run forensic scripts as isolated worker processes and call them through authenticated APIs rather than assuming n8n can import Python modules.

## Step D — Verification checklist

- [ ] PostgreSQL service is active and `forensic_user` can connect to `forensic_db`.
- [ ] `SELECT to_regclass('public.upi_vpa_pool'), to_regclass('public.payment_sessions'), to_regclass('public.financial_ledger');` returns three tables.
- [ ] The count of **genuine verified merchant-owned** VPAs is 1,000 (currently zero until supplied).
- [ ] `systemctl is-active forensic-n8n` reports `active`; port 5678 is reachable through your intended access controls.
- [ ] The Python virtualenv compiles/imports the ELA/OCR modules and Tesseract is installed.
- [ ] Worker/database schema and all n8n endpoint URLs are separately configured and integration-tested before activating workflows.

**No claim of completed host installation, real VPA import, bank reconciliation, or production readiness is made by committing these files.**
