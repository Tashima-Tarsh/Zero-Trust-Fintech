# Native host setup — client device attestation

## Schema choice

The native database/schema.sql is a simplified alternative schema using a string
session ID. The Python worker uses UUID sessions and requires
infra/postgres/init.sql, with the full event ledger and registry.

Do **not** combine both schemas in one database.

## Local runtime

Install PostgreSQL, Redis, Python 3.12 or a supported newer version, and n8n.
For a fresh worker database, provision the database and run
infra/postgres/init.sql once. This init script also creates a separate n8n
database; do not re-run it on populated volumes.

For existing worker databases, back up the data, review
database/migrations/003_client_device_attestation.sql and apply it as a
controlled upgrade. Run the Phase 2 diagnostic migration only on legacy
databases where those records are missing.

~~~bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
python -m uvicorn worker.app:app --app-dir backend --host 127.0.0.1 --port 8000
~~~

Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, WORKER_API_KEY, and
CLIENT_ATTESTATION_MAX_SKEW_SECONDS in the worker's secure environment.

Run the unit and static checks with:

~~~bash
python -m pytest backend/tests -q
python scripts/validate_structure.py
python scripts/validate_phase1.py
python scripts/validate_phase2.py
~~~

## n8n

Import n8n-workflows/04_attestation_notifications.json, configure the internal
worker HTTP Header Auth credential and CLIENT_ATTESTATION_NOTIFY_URL, then
activate only after the target endpoint is reachable. On the Docker private
network the worker hostname is worker; use the correct reachable HTTPS
address when running n8n on a different host.

Private signing keys must remain on the enrolled user devices.
