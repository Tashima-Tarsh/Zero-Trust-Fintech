# Phase 2 — Device Integrity Checks

This phase evaluates consented client observations and stores immutable
diagnostic decisions. Its purpose is to **reject tampered or anomalous client
action claims** before acceptance.

## Implemented

- backend/worker/phase2.py: bounded image decoding, ELA/OCR checks, behavioral metrics and integrity decisions.
- backend/worker/app.py: authenticated /v1/intent/evaluate evidence intake.
- database/migrations/002_phase2_reconciliation.sql: legacy filename for the immutable device-integrity diagnostic table.
- backend/tests/test_phase2.py: consent, replay, mismatch and status regression tests.
- n8n-workflows/02_intent_verifier.json: authenticated Device Integrity Checks request route.

The decision is DEVICE_INTEGRITY_PASS or DEVICE_INTEGRITY_REJECT.
A prior rejection for a session blocks its subsequent signed client action claim.

Final acceptance occurs only via the separately signed
POST /v1/client/attest-payment API. See docs/api_spec.md.
