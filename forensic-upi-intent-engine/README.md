# Client Device Attestation Engine

The current runtime is centered on **customer device authority**. A registered
Ed25519 device key signs the complete user action claim and its Device Integrity
Checks. Valid, bound, fresh, policy-passing claims are recorded as
**CLIENT_ATTESTED**, with one immutable event per session.

## Runtime path

1. An internal caller creates a session with client_user_id and client_device_id.
2. The customer device prepares the exact amount, UTR claim, timestamp and
   signed integrity observations.
3. Its enrolled native private key signs canonical JSON.
4. POST /v1/client/attest-payment validates the registered public key,
   device/session binding, timestamp, integrity policy and uniqueness.
5. The worker appends a client_attestation_ledger event in the same transaction
   as it finalizes the application attestation state.
6. n8n polls the immutable event feed and emits outbound notifications.

## Important paths

- backend/worker/client_attestation.py — signature verification, replay and ledger.
- backend/worker/app.py — session creation and optional device-integrity diagnostics.
- database/schema.sql — alternative native schema.
- infra/postgres/init.sql — worker database schema used by Docker.
- database/migrations/003_client_device_attestation.sql — existing worker DB upgrade.
- python-forensics/ela_analysis.py and backend/python_nodes/behavior_scorer.py —
  Device Integrity Checks and rejection policy.
- mobile-app/src/services/deviceAttestation.js — payload signing and HTTPS transport.
- n8n-workflows/04_attestation_notifications.json — scheduled outbound notifications.
- docs/api_spec.md — canonical signature contract and deployment requirements.

## Setup

For a new worker deployment, copy .env.example to .env and supply strong
secrets. Initialize with infra/postgres/init.sql. For existing worker data,
review and run database/migrations/003_client_device_attestation.sql after
backup. These two database layouts are not interchangeable.

Install dependencies from backend/requirements.txt and
backend/requirements-dev.txt. Run:

```bash
python -m pytest backend/tests -q
python scripts/validate_structure.py
python scripts/validate_phase1.py
python scripts/validate_phase2.py
```

Import the notification workflow into n8n, configure internal worker Header
Auth and CLIENT_ATTESTATION_NOTIFY_URL, and activate it when connectivity is
ready.

Device private keys must remain outside JavaScript. A verified device
enrollment procedure is needed to populate client_device_keys; no public
self-registration is provided. The JS mobile function is an integration
boundary and needs a native secure signer wired into it.

This system records final cryptographic attestation of a **client action
claim**. This status is intentionally scoped to that signed claim.

MIT licensed.
