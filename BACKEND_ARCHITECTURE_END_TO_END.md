# DISHA 8.2 — Backend Architecture / Source of Truth

This entry point supersedes older pre-Quantum sketches. The canonical design after the merger of PR #68 is:

- [Technical Design Document and Interface Design Document](docs/architecture/SYSTEM-ARCHITECTURE.md)
- [End-to-end Mermaid sequence, decision tree and exception flow](docs/architecture/END-TO-END-FLOW.md)
- [Release and safe cleanup tests](docs/architecture/TEST-AND-RELEASE.md)

## Actual payment services

`server.js` and `merchant-api.js` are the primary payment/session backend, with `platform-control.js` for owner controls. `financial/vault-evidence.js` maintains optional authorized browser-journey evidence. `financial/quantum-signal.js` implements `DISHA-SIGNAL-V1` start → challenge → ACK → event ingestion with PostgreSQL state and order-bound replay controls. `utils/upi-intent.js` preserves personal P2P and bank-issued P2M payment identity. Cloudflare Pages serves the checkout and proxies authorized API routes to the Node backend.

## Intended innovation and current gap

The business vision is **self-hosted merchant-controlled payer-debit evidence correlation using Vault, Quantum Signal, UTR and TR**. The current merged code verifies the browser session handshake; authenticatable debit-event acquisition has not been proven with real Google Pay/PhonePe and may require additional authorized integration or other evidence channels. Existing financial ledger controls must stay intact until a versioned verified replacement exists.

**Do not turn an ACK, browser return, UTR text or emulator trace into a completed financial decision. Do not expose generated database IDs as product-facing payment references.**

For build/test/deploy and live readiness, use [the test plan](docs/architecture/TEST-AND-RELEASE.md).
