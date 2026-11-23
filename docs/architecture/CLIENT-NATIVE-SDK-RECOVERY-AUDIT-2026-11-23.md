# DISHA Native SDK recovery — scoped ponytail branch

## Scope and provenance

Recovered the original Android SDK and **research-only** host/fixture source from commit `453e85458890311e0c972f1d91d8a4a46acd90b1`, following its deletion in `39aac039`. All recovered paths retain their historical blob identity. This is isolated from `main` and must not be merged into a live checkout without review.

The library under `android/session-evidence/` is an Android **AAR source module**; `android/upi-host/` is a testable native APK source module; `android/intent-bridge/` is a reusable Java bridge. This branch does not establish a published production AAR, deployed host APK, installed SDK, or verified bank debit.

### Build and checks

Requires JDK 17, Android SDK platform 35, Gradle 8.9. From `android/` run:

```bash
gradle :session-evidence:assembleDebug :upi-host:assembleDebug :upi-host:testDebugUnitTest
```

Fixture from repository root:

```bash
gradle -p tests/android/credential-holder-fixture :app:assembleDebug
```

Only run Android tests on opted-in lab devices; do not connect private banking accounts. These commands have **not** been executed as part of this restoration.

## Architecture boundary

The attached client diagram models a customer, **seller** Android app, seller backend, DISHA API, native DISHA SDK, UPI app, and Android debit signals. Android notification access is **device-local**. A seller app on a separate device cannot access a payer phone's notifications. A payer-authorized host component and explicit Android Notification Access must be present on the **payer device**, or a genuine independently authorized evidence provider must provide bank-debit evidence. The `upi-host` does not include the notification listener. The `session-evidence` AAR embeds one, but a host app must explicitly request permission.

## Endpoint reconciliation

The screenshot proposes `POST /v1/checkout/session`, `/security/verify`, `/auth`, `/evidence`; these are **proposed diagram contracts**, not proven current backend routes.

Historical recovered source uses:
- `POST /api/session-evidence/authorize`
- `POST /api/session-evidence/event`
- `GET /api/session-evidence/status/:orderId`
- `POST /api/session-evidence/revoke`
- `POST /api/session-evidence/upi-result` in native UPI-result host research

The currently maintained DISHA browser flow uses original payment session APIs plus Quantum Signal `/api/quantum-signal/start`, `/challenge`, `/ack`, `/event`. Do not alias proposed endpoints to financial completion without actual router implementation, auth, persistent state, and tests.

## Demonstration constraints

- Demo may show session creation, merchant payee, native UPI dispatch, synthetic or observed UPI return, request-bound event signing, explicit pending evidence.
- Do **not** claim real Google Pay/PhonePe debit detection, live bank integrations, OS-wide root/debugger attestation, completed payment, or verified merchant credit.
- An Android signature authenticates an enrolled app key, not the bank truth of a notification or an independently verified debit.
- No app-return success, UTR candidate, or signed evidence receipt independently authorizes settled ledger state.
- Full real-device and end-to-end production acceptance remains open.
