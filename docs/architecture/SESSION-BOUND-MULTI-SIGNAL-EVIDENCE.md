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

## Current implementation boundary
The Node API, PostgreSQL schema, signature checks, correlation rules, Android listener source and unit regression tests are added on the feature branch. The repository has no complete Android Gradle host application, so the Android component has not yet been compiled or installed. Real-device notification compatibility, multi-device pairing UX, end-to-end API tests against PostgreSQL, and CI results remain release gates. Do not enable the Android capture flow in production until those gates pass.
