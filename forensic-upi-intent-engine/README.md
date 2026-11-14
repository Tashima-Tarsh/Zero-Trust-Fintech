# Zero-Trust-Fintech — Client Device Attestation

The active engine records **cryptographically signed client action claims** from enrolled user devices. Valid Ed25519 signatures, passing Device Integrity Checks, and exact matching to a bound session produce **CLIENT_ATTESTED** state and a replay-protected append-only record.

## Trust model

- Signed claims include session ID, user/device IDs, UTR claim, exact amount, timestamp and integrity measurements.
- Public keys must already be enrolled and bound to the user's session; requests cannot self-enroll.
- Invalid signatures, changed claims, stale requests, replay conflicts, and failing integrity checks are rejected.
- CLIENT_ATTESTED is the terminal status of the **device-signed action claim** within the application.

## Code

- [Current engine](forensic-upi-intent-engine/README.md) — API worker, SQL schemas, n8n workflows, mobile integration and tests.
- [Historical reference](forensic-upi-engine/README.md) — prior prototype, not in the active attestation path.

MIT licensed.
