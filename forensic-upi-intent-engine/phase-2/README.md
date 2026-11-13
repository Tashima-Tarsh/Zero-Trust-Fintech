# Phase 2 — Intent Forensic Verifier & Reconciliation Holding Queue

Phase 2 implements **fraud triage** for the first minutes after the UPI app handoff, not a bank-less payment settlement system.

See:
- [Threat scenarios and limitations](threat_model.md)
- [API contracts and workflow mapping](api_contracts.md)
- [Native installation / migration runbook](operational_runbook.md)

## Implemented artifacts

| Artifact | What it does |
| --- | --- |
| `n8n-workflows/02_intent_verifier.json` | Header-authenticated webhook `verify-payment` -> worker -> pending-reconciliation response |
| `backend/worker/phase2.py` | Explainable forensic risk analysis, consent handling, screenshot hash, OCR/ELA integration |
| `backend/worker/app.py` | Session-bound idempotent evidence intake and queue endpoints; no ledger credits |
| `database/migrations/002_phase2_reconciliation.sql` | Immutable forensic-submission log, queued sessions and replay lookup |
| `n8n-workflows/04_statement_parser.json` | Existing statement preview plus hourly *read-only* queue summary |
| `backend/tests/test_phase2.py` | Pending, fake-success, replay, mismatch, consent and auth regression checks |
| `config/systemd/forensic-worker.service` | Optional local Python worker daemon template |

## Non-negotiable invariant

**No forensic score can cause a payment status of PAID, release goods or credit the ledger.** A photo of a success screen, package-name match, UTR format or a signed *mock* callback is not a bank credit. All client-originated payment claims remain `PENDING_RECONCILIATION` until authorized bank/PSP-side reconciliation is independently implemented.

No automatic ₹1 transfers are issued to random VPAs. The existing 03 canary is passive database health only.
