# DISHA session-bound multi-signal evidence

## Objective
Bind payer-side evidence from one or more enrolled devices to one immutable checkout session. The server owns session state, correlation, replay checks and fraud decisions. A merchant has no component to install or operate.

## Session contract
- Checkout order ID and session token identify the active DISHA checkout.
- The first explicit consent creates a random 160-bit nonce and an expiry no later than the checkout expiry or 180 seconds.
- Each paired device enrolls a P-256 public key. Pairing additional devices preserves the same session nonce, consent timestamp and expiry.
- The session binding includes amount in paise, payee VPA and P2P/P2M classification.
- Every event includes the session ID, nonce, device ID, source package, Android notification posted timestamp, amount/payee/reference when actually present, and status.
- Device events are accepted only while the original checkout is still PENDING and the consent window remains active.

## Server endpoints
- POST /api/session-evidence/authorize — explicit consent and device-key enrollment.
- POST /api/session-evidence/event — signed event ingestion and correlation.
- GET /api/session-evidence/status/:orderId?token=... — session evidence counters and consent state.
- POST /api/session-evidence/revoke — revoke session evidence collection.

## Fraud gates
- Strict event schema and allowlisted UPI source package IDs.
- P-256 signature verification against the key enrolled for that exact session and device.
- Exact order ID + nonce binding; cross-session events rejected.
- Posted-time checks against consent and session expiry; future-clock tolerance is bounded.
- Exact paise and payee comparisons whenever those fields are present; mismatch is rejected.
- Missing amount, payee or transaction reference remains incomplete and cannot become a matched signal.
- Unique event IDs and globally unique non-null transaction references prevent event and reference replay.
- Additional devices share the same nonce; they cannot create a second parallel session context.
- Event ingestion does not update checkout status, transaction rows, UTR bindings or ledger entries.

## Decision states
- SIGNAL_MATCHED — success status plus exact amount, exact payee and transaction reference.
- INCOMPLETE_SIGNAL — one or more required notification fields were absent.
- PAYMENT_FAILED_SIGNAL — source notification reported failure.
- AMOUNT_MISMATCH / PAYEE_MISMATCH — supplied values conflict with the session.
- CROSS_SESSION / SESSION_TIME_INVALID — wrong nonce/order or stale/future/expired evidence.
- EVIDENCE_REPLAY_BLOCKED — event ID or transaction reference already used.

## Android adapter
The Android source under android/session-evidence is a host-app integration component, not a ready-to-install APK. It requires a payer-authorized Android Notification Access grant. It filters allowlisted packages and active sessions before forwarding only parsed fields; it does not transmit complete notification text. Notification layouts vary, so parsers must be validated against current GPay/PhonePe releases and languages on physical devices.

## Current implementation boundary (updated 21 November 2026)
The repository **does** contain a buildable Android Gradle fixture at `tests/android/credential-holder-fixture/`. PR #98 proved synthetic credential discovery and holder callback on Pixel API 37 / Chrome 145. PR #99 proved explicit Android notification permission and in-app consent, Keystore-signed **synthetic** events, HTTP 202 to an isolated PostgreSQL-backed server, and negative expiry/revocation/replay/signature/mismatch checks. PR #100 added an opt-in real-debit RRN/UTR observation parser; its actual Pixel test returned `UTR_NOT_AVAILABLE` because no eligible payer app was installed. No real debit RRN or payer-bank authenticity was demonstrated.

The generic module under `android/session-evidence/` remains a host-app adapter; the APK fixture is a separate test implementation, **not** a customer production release. The parser is deliberately strict: explicit completed-payer wording, labelled 12-digit RRN/UTR, amount and payee VPA. User-reported bank SMS may contain RRN but bank-SMS notification parsing is not validated by this test. The complete checkout gate, `I Paid` evidence-only popup and secure callback are pending separate integration and E2E proof. Keep `paymentVerified` and `debitVerified` false for notification-only evidence. See [current evidence matrix](DEBIT-FIRST-CHECKOUT-EVIDENCE-STATUS-2026-11-21.md).
