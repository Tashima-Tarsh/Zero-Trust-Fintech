# Ponytail native SDK communication repair — 23 November 2026

## Found and fixed

PR #155 restored native Java sources but did not restore the server-side session-evidence endpoints. The restored UPI host also wrote literal backslash+n characters in its enrolled device public-key PEM instead of the required newline escape, and local notification collection could remain enabled while the asynchronous network revoke was in flight.

This repair restores the previously merged server-side Express evidence router, native UPI-result router, and their contract tests; gates those routes and their PostgreSQL schemas behind `DISHA_NATIVE_EVIDENCE_EXPERIMENT=1` (off by default); fixes Java PEM formatting; and clears local observer state synchronously on revoke. Restored code comes from commit `453e854`. The SDK still requires a separately installed, consented payer-host Android app.

## Evidence-only, no third-party payment API

Routes: `POST /api/session-evidence/authorize`, `/event`, `/revoke`, `/upi-result` and `GET /api/session-evidence/status/:orderId` are available **only when explicitly enabled**. They process user-device evidence, not bank API calls, PSP/aggregator integrations or bank webhooks. Observed device/app evidence never automatically completes a bank settlement or the financial ledger. No manual UTR entry is required by this module.

## Validation and readiness

Run `node tests/test-session-evidence.js`, `node tests/test-session-upi-result.js`, `node tests/test-native-evidence-ponytail.js`, `npm run lint` and `npm test`. The restored feature requires PostgreSQL and a consented real Android test environment. This change has **no verified physical-device E2E success** and does not establish zero fraud or a confirmed user debit. Do not enable in production before testing.

**Additional release blocker:** the historical UPI host passes the full checkout token in a custom-scheme URL. Replace it with a short-lived single-use pairing ticket and verified HTTPS Android App Link before real payer deployment; avoid exposing bearer credentials to another application. Native notification listening is device-local and cannot work from the seller's different phone.
