# Zero-Trust Fintech

Defensive research prototypes for UPI session orchestration, payment-integrity controls and forensic triage.

## Projects
- [forensic-upi-intent-engine](forensic-upi-intent-engine/README.md) — current scaffold with Redis, append-only financial ledger schema, n8n orchestration, forensic helpers, statement preview and opt-in mobile sensors.
- [forensic-upi-engine](forensic-upi-engine/README.md) — earlier scaffold retained for compatibility and reference.

**Important:** Neither project can independently verify actual bank settlement from screenshots, user-provided UTRs, app switching or device telemetry. Production settlement needs an authorized bank/PSP integration and independent reconciliation. Demo VPAs are non-transactional and disabled by default.

License: MIT.
