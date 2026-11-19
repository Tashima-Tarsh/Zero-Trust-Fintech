# DISHA 8.2 — Testing, Release and Safe Cleanup Plan

**Current release classification:** pre-production acceptance; a successful Android emulator dispatch is not a real payer debit. All tests must operate on isolated fixtures or explicitly authorized controlled UAT accounts.

## Core test-driven development (TDD) contract

| Suite | Code and expected behavior |
| --- | --- |
| Unit/contract | `npm run lint`, `npm test`; exact paise, QR bytes, P2P/P2M classification and immutable TR |
| Session security | Quantum wrong nonce, expired challenge, replay ACK, mismatched order/token, duplicate event ID |
| Vault evidence | Optional WebAuthn, one-order evidence, no raw PIN or sensitive telemetry, idempotent ACK |
| Disposable PostgreSQL | Tenant isolation, durable sessions, financial posting/idempotency, negative fake evidence |
| Android API 35/37 | Real emulator touches, `ACTION_VIEW`, test receiver, cancel, app return, no money moved |
| Physical Android | Google Pay, PhonePe/BHIM when supported; each separate P2P/P2M; pre-PIN refusal captured |
| SaaS / owner | Clerk identity; approval; no mock merchants, financial totals or exposed internal IDs |
| Edge / deployment | Cloudflare asset parity, Railway upstream API health, same deployed release commit |
| Scale | Concurrent sessions, node restart, Redis outage, PostgreSQL pool limits and websocket fanout |

## Physical UAT gates

1. Confirm requested amount, payee and P2P/P2M receiving-account classification; collect original bank-issued P2M QR only for comparison, not as an API dependency.
2. Verify Quantum Signal start/challenge/ACK is visible in server logs and the one-tap Android Intent actually launches the selected app.
3. Record exact pre-PIN rejection message when present. Never enter a PIN into the website or a developer script.
4. Confirm app return and any legitimately exposed UTR/TR without modifying the issued order.
5. Independently establish whether a real payer debit happened in the controlled test; only an adequately authenticated source may justify a completed decision.
6. Check replay, wrong recipient/amount, cancel and retry do not fabricate settlement.
7. Verify merchant/owner dashboards and receipts match the same decision, with no generated internal IDs shown as public reference labels.

## Safe technical debt workflow (Ponytail)

- Trace references through source, tests, build scripts, Cloudflare/Railway routes and external consumers before declaring anything dead.
- Remove stale demo credentials and duplicate obsolete development assets when their owners are known. Never ship placeholder payment recipients or demo sales into production.
- Keep the source `public/` and required deployment mirrors synchronized until their deployment contracts are decommissioned.
- Preserve `tests/` fixtures that exercise failure and replay; those are **not production dummy data**.
- Do not drop PostgreSQL tables or rows based only on assumptions. First produce read-only inventory, identify merchant authorization/test ownership, back up, then approve a separate migration.
- Ship a scoped PR, observe all CI suites and physical UAT evidence before a production GO recommendation.

## Release status labels

- **IMPLEMENTED:** code and automated tests exist.
- **CI VERIFIED:** relevant automated run passed.
- **DEVICE VERIFIED:** actual supported Android and UPI app acceptance observed.
- **FINANCIAL EVIDENCE VERIFIED:** authenticatable payer debit evidence with cross-order replay safety demonstrated.
- **GO:** all above plus security, availability and SaaS deployment validation.

As of this design, the feature-flagged Quantum Signal browser/server handshake is merged but physical UPI pre-PIN acceptance, authenticatable payer debit evidence and 100K-session scale have not passed their release gates.
