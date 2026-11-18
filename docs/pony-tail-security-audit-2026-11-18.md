# DISHA 8.2 — Pony-tail UTR and checkout re-audit
Date: 18 November 2026

Scope: active Express checkout, merchant SaaS, WebAuthn Vault, UPI intent, UTR sources, PostgreSQL and Android E2E.

## Mathematical temporal policy

Let t0 = server-issued order creation time, t1 = observed time, te = order expiry, and delta=t1-t0 in whole milliseconds.

| State | Gate |
|---|---|
| INVALID_SESSION_CLOCK | missing timestamps or te <= t0 |
| CLOCK_SKEW | delta < 0 |
| WAITING | 0 <= delta < 15,000; order not expired |
| OBSERVATION_WINDOW | 15,000 <= delta <= 180,000; t1 <= te |
| EXPIRED | delta > 180,000 or t1 > te |

The 15-second minimum and 180-second maximum are observation policy bounds, not evidence of payment success. The old 99.7% claim had no empirical support and has been removed.

## Confirmed issues and repairs

| Issue | Severity | Repair |
|---|---|---|
| API 35/37 Android CI failed after one-touch Vault change | P1 | Test fixture now issues 32-character hex Vault IDs, uses native Android touch and checks browser return |
| Emulator tests omitted Vault evidence receipt | P1 | Assert one synthetic passkey ceremony, one browser-return packet, no UTR after cancellation and no synthetic financial settlement |
| Public /api/verify bound UTR before authenticating order and time | P0 | Token and CSRF gate before mutation, non-authoritative UTR observation only |
| Public /handle-share could bind customer-asserted UTR and mutate another order | P0 | Removed authoritative UTR binding and unauthenticated order state updates |
| Legacy CFC and WebAuthn finalize endpoints could reserve a fabricated UTR | P0 | Store untrusted candidate separately, without authoritative UTR ownership |
| Public /api/cfc/cancel could impose cooldown on a stranger's order | P0 | Require active order, checkout token and matching CSRF header |
| Concurrent duplicate candidate UTRs | P1 | PostgreSQL non-authoritative claim store serialized by per-UTR advisory lock; conflicting orders reported, never settled |
| Time-gate uncertainty and unsupported numerical claim | P2 | Unified mathematical window function, unit-tested boundary conditions |

The new untrusted candidate table is an audit trail, NOT a credit ledger and NOT an exclusive UTR ownership registry. A previous false claim cannot establish who paid.

## Vault and browser evidence contract

The customer authorizes the device once; browser asks the Vault for the observed event after returning from the external UPI app. Vault returns a frozen packet containing order reference, event ID, permitted lifecycle signals and any *actually observed* UTR candidate. The checkout browser sends this packet to the existing order-bound evidence endpoint and acknowledges the Vault only after storage. Returned UTR and success parameters are still untrusted observations; neither route can settle funds.

## Open findings

1. P0 for a real-money claim: There is no independently labelled dataset establishing false-positive rates from UTR-plus-time-only identification. This is a measurement gap, not a request to add bank APIs or an aggregator.
2. P1: WebAuthn challenge issuance is in-memory. A process restart or multi-replica handoff can lose the challenge; persisted single-use challenges are still needed for horizontal scaling.
3. P1: Some browsers lose transient user activation while awaiting the biometric ceremony. The genuine Continue to UPI app fallback remains, and real-device second-tap rates need measurement.
4. P1: A 12-digit UTR may occur on pending or failed transactions. Correlation and replay checks never themselves confirm completion.
5. P1: Pre-existing authoritative UTR bindings made by earlier customer-claim code require a provenance audit. Do not automatically delete history or assume those bindings prove a credited transaction.
6. P2: A different tab, storage denial or UPI app with no browser-visible return data can prevent automated evidence capture.
7. P2: Dormant Python/FastAPI and n8n files are not the active Railway deployment; the tests here do not assert their orchestration is running.

## Release test matrix

- DISHA CI: syntax lint, browser tests, one-touch Vault, anti-fraud and pony-tail timing boundary tests.
- PostgreSQL: genuine Express HTTP against disposable localhost PostgreSQL, token/CSRF checks, non-authoritative candidate replay, zero forged ledger credits.
- Android API 35/37: native touch, synthetic UPI receiver, one test passkey ceremony, cancel, automatic Vault return event, pending order.
- Railway: successful production deployment and health of app, PostgreSQL and Redis.

Passing simulated E2E does not certify all commercial UPI apps or real-money settlement.
