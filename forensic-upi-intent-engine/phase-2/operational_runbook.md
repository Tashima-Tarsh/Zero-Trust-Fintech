# Phase 2 — device-integrity operational runbook

## New deployments

Use infra/postgres/init.sql for a new worker database. It includes
phase2_forensic_submissions and the client-attestation tables. The init script
also provisions the n8n database and must only run on a fresh environment.

## Existing deployments

1. Back up PostgreSQL and record the current application version.
2. Apply database/migrations/003_client_device_attestation.sql to the existing
   worker database after testing the upgrade on a copy.
3. Confirm that phase2_forensic_submissions permits the new integrity
   decision values. Earlier installations may need a separate constraint update.
4. Deploy the updated Python worker and configure its environment.
5. Register real user device public keys through a protected enrollment process.
6. Import and configure the new outbound n8n workflow; leave it inactive until
   HTTP connectivity and credentials have been verified.

## Checks

~~~bash
python -m pytest backend/tests -q
python scripts/validate_structure.py
python scripts/validate_phase1.py
python scripts/validate_phase2.py
~~~

Review fail-closed behavior, duplicate event handling, device-key rotation,
database transaction failure, and notification delivery. Do not expose internal
worker credentials or private device keys in the mobile bundle.
