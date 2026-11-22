# DISHA Quantum Signal — implemented session-twin handshake

**Current branch status:** PR [#68](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/pull/68) **merged into main** on 19 November 2026. It remains opt-in with `qs=1` pending physical-device validation.

## Business responsibility

Quantum Signal prepares an immutable P2P/P2M order twin, challenges the checkout browser, stores the matching ACK and records idempotent handoff/background/return observations. Together with DISHA Vault, these signals supply the order-bound context for the intended payer-debit evidence correlation model.

**This implementation does not yet read an authenticated debit event from the payer's bank or inside Google Pay/PhonePe.** Any returned UTR is a candidate until trustworthy provenance is established.

## API contract

1. `POST /api/quantum-signal/start` — bind original order, bearer and optional Vault authorization.
2. `POST /api/quantum-signal/challenge` — issue 30-second cryptographically random challenge and persist hashed server record.
3. `POST /api/quantum-signal/ack` — verify the original order/nonce/challenge; reject wrong, expired and cross-order responses.
4. User taps the native `Proceed to UPI` anchor — no asynchronous prompt between gesture and Android Intent.
5. `POST /api/quantum-signal/event` — bound `HANDOFF`, `BACKGROUND`, `RETURN` events with unique IDs and allowed return fields.
6. `GET /api/quantum-signal/status/:orderId` — read order-scoped signal state.

Checkout opt-in paths:
- Personal P2P: `/p2p?amount=1&qs=1`
- Merchant P2M: `/p2m/checkout?paymentRef=...&token=...&qs=1`

## Database

`disha_quantum_twins`, `disha_quantum_handshakes` and `disha_quantum_events`. The original `pa`, amount in paise, payment kind, TR and session expiry are immutable. Vault authorization remains an optional higher-assurance path.

## Release gate

The Android emulator verifies Intent transport through a test receiver, not payment-app acceptance. Real Android pre-PIN behavior, payer-debit evidence authenticity, SaaS access, edge/backend release matching and 100K active-session load are still not established. Keep n8n outside the payment-critical path.

See [canonical TDD/IDD](architecture/SYSTEM-ARCHITECTURE.md) and [full end-to-end Mermaid flow](architecture/END-TO-END-FLOW.md).
