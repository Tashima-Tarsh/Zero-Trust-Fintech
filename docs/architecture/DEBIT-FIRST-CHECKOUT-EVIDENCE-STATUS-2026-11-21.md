# DISHA debit-first checkout — code and evidence status (21 November 2026)

> Engineering status, not a claim of live financial verification. This document distinguishes code merged into `main`, controlled Pixel tests, and the checkout flow under development. No PSP, bank API, payment aggregator, payment-app API, payment webhook or merchant-credit API is required by the proposed **observation** flow.

## Source-of-truth code reviewed

| Component | Source | What it demonstrably does |
| --- | --- | --- |
| Browser checkout | `public/checkout.html`, `public/merchant-checkout.html`, `public/cosmic-checkout.js` | Existing P2P/P2M checkout, copy/payment actions, `I Paid — Check Debit Evidence` entry point, server-driven receipt paths |
| Browser auth experiment | `public/android-checkout-handshake.js`, `docs/ANDROID-CHECKOUT-HANDSHAKE-INTEGRATION-2026-11-21.md` | Opt-in WebAuthn + **test** WebOTP; **not** Android notification access or bank SMS reading |
| Android credential holder | `tests/android/credential-holder-fixture/app/src/main/java/ai/disha/credentialfixture/{DishaCredentialApplication,PresentActivity}.kt` | Pixel API 37 / Chrome 145 synthetic selector and OS-to-holder callback verified in PR #98; callback intentionally ends with `DISHA_TEST_ONLY_NO_BANK_DEBIT_CREDENTIAL` |
| Android observation lab | `PaymentObservationListener.kt`, `SessionObservation.kt`, `SessionObservationActivity.kt`, `DebitNotification.kt` in the same fixture | Explicit user consent and Android notification access, short-lived session, synthetic signed observations and opt-in selected-payer-package RRN/UTR parser |
| Session evidence API | `financial/session-evidence.js` | P-256 device signature, nonce/order/amount/payee binding, expiry, replay/revocation; no ledger completion from observation |
| Issuer-claim experiment | `financial/debit-credential.js`, `financial/debit-evidence-receipt.js` | Separately signed *issuer-claim acknowledgement*; **not** bank settlement proof, and not the same as a signed Android notification |
| Local tests | `tests/android/credential-holder-fixture/session-lab/{README.md,REAL-UTR.md,test.js}` | Disposable PostgreSQL harness, signed synthetic HTTP tests, no real money |

This is a **targeted checkout / Android / financial-evidence code audit**, not an assertion that every repository file has been individually audited. Production mirrors `dist/` and `disha-cinematic/` must stay synchronized when runtime code changes; this documentation-only change does not touch them.

## Verified results — do not conflate them

1. **PR #98 (merged):** On Pixel API 37 / Chrome 145, the synthetic DISHA credential appeared in Chrome's selector; selecting it produced `HOLDER_ACTIVITY_CREATED` and `GET_CREDENTIAL_CALLBACK_PARSED`. The intentional no-payment exception surfaced as `NetworkError`. This is a successful **transport/handoff** test, not a debit result.
2. **PR #99 (merged):** Android listener received a fixture-owned synthetic notification, enrolled a Keystore P-256 key and sent a signed event to the isolated session-evidence server. HTTP 202 `SIGNAL_MATCHED` did **not** set `paymentVerified` or `debitVerified`. Negative tests covered source filtering, amount/payee mismatch, signature alteration, replay, expiry and revocation.
3. **PR #100 (merged):** Opt-in real-observation mode and conservative reference parser added. It only accepts a single *explicitly labelled* 12-digit `UTR` or `RRN`, completed-payer wording, explicit debit amount **and an explicit payee VPA**. Generic transaction IDs and ambiguous values are rejected. On the connected Pixel no supported payer app was installed; the result was `UTR_NOT_AVAILABLE`. **No real debit UTR/RRN was captured**, and no bank-SMS notification was processed by this mode.
4. **Current checkout mission:** Authentication → verified Android notification permission → time-bound in-app consent → copy payee VPA → user pays → `I Paid` → **debit evidence status modal** → authenticated, idempotent callback. This complete user-facing integration is **not established as merged or E2E tested** by PRs #98–#100. Work is implementing it separately.

## Requested UX and non-negotiable gates

1. **Authenticate:** Android BiometricPrompt/device credential in an installed, authorized Android component, or the actual supported browser credential mechanism. Never ask for, store or send the device PIN/biometric. A WebAuthn passkey proves authentication, **not** notification permission.
2. **Android access:** Android user explicitly enables the DISHA `NotificationListenerService` through system Settings; the Android holder checks actual access. A website checkbox cannot enable system notification permission or read other apps' notifications.
3. **Consent:** Unchecked per-session user approval, bound to order, nonce, immutable amount/payee, enrollment, expiry and revocation. Permission and consent are distinct.
4. **Copy:** Gate the checkout `Copy UPI ID` control on **server-verifiable** authenticated/consented session state when using the automatic-evidence path. Copy the exact session payee VPA. Unsupported browsers/devices must see a truthful, safe state.
5. **Pay:** User makes an ordinary UPI payment; no payment app private API, PSP, aggregator, webhook or merchant credit callback is used.
6. **I Paid:** Server-side status lookup only. Button press must never create a debit event, invent RRN/UTR, or mutate the ledger to SUCCESS.
7. **Modal:** Always show a status popup after `I Paid`: *Debit evidence observed* only for an eligible signed, order-bound observation; *Awaiting debit evidence* if absent; *Evidence rejected* if invalid. Never show bank-verified debit or successful settlement solely because of observed notification text.
8. **Callback:** Reuse the existing authenticated checkout channel. Deduplicate events and bind them to the exact order and authorized recipient. Emit a specifically named **evidence-observed/pending/rejected** event, never reuse a financially settled `payment.success` event without independent settlement evidence.

The existing receipt UI includes paths guarded by `payerDebitVerified`/`debitVerified` and independently settled ledger state. **Do not relax these gates** to display an existing payment-success receipt for notification-only evidence. Build a separate evidence-only modal/status instead.

## RRN, data minimization and what is *not* verified

The user reports that a bank debit SMS can contain the bank label, debit amount, RRN and **available balance**. That statement identifies a **test candidate**, not a captured DISHA notification. A bank SMS notification, a direct SMS read and a UPI-app notification are different Android surfaces. Current PR #100 is a *selected UPI-app package notification* parser; it does not establish general Android SMS access. SMS reading may require restricted Android/Play permissions; do not silently assume or request inbox-wide access.

**Only if actually present in the authorized source**, capture:
- explicit `RRN` or `UTR` with its original digits and source label;
- actual debit amount and Android notification timestamp;
- source/bank display label as **unverified provenance**;
- explicit payee VPA, if present, for complete session matching.

**Never transmit or persist** available balance, full SMS, account numbers, customer name/phone, OTP, unrelated messages, or account balances. Parse and discard locally; include tests that inspect network payloads, logs, database and receipt. If the payee VPA is absent from an SMS, **do not substitute** the checkout VPA as though it was observed. Treat the record as incomplete/partially matched until a defensible binding is demonstrated.

Device signatures authenticate the enrolled **device key and bytes it reported**, not the financial institution that supposedly authored the notification. Missing UTR means `UTR_NOT_AVAILABLE`, not 'no debit occurred'. `DEBIT_UTR_OBSERVED` is not a bank authentication claim.

## Acceptance matrix for the next checkout PR

| Gate | Evidence required | Status at this documentation snapshot |
| --- | --- | --- |
| Credential discovery + callback | Pixel Chrome selection and holder Logcat | **PASS**, synthetic PR #98 |
| Synthetic notification + signature → DB | Pixel HTTP response and negative tests | **PASS**, PR #99 |
| Strict labelled UTR/RRN parser | Kotlin + signed HTTP regression | **PASS**, synthetic PR #100 |
| Real bank/UPI notification with actual RRN | Consented phone trace with redacted source and exact reference semantics | **NOT VERIFIED** |
| Real bank SMS access without app/API | Supported Android permission/notification surface and observed live fields | **NOT VERIFIED** |
| Biometric → system access → consent → copy gated checkout | Server-enforced integration on supported phone/browser | **NOT VERIFIED** |
| I Paid evidence modal + evidence-specific callback | E2E UI + server auth, replay and idempotency tests | **NOT VERIFIED** |
| Bank-authenticated debit / final credit | Financial source authority and outcome proof | **NOT VERIFIED; not a prerequisite for *observed-evidence* UX** |

## Review and release checklist

- Reuse `financial/session-evidence.js` and the existing checkout JS and DOM; do not add redundant processors or new payment rails. Keep experimental issuer receipt and device observation schemas distinct.
- Separate `evidenceObserved`, `debitVerified` and `paymentVerified` in the data model, UI, merchant callback and tests.
- Verify Android permission and in-app consent independently; test expiry, revocation, source spoofing, unlabelled or ambiguous RRN, mismatched amount/payee, replay, invalid signature and cross-order disclosure.
- Do not turn mere HTTP 202 or `I Paid` into success or a paid ledger row.
- Test in isolated PostgreSQL with synthetic vectors and, only with user authorization, a privacy-preserving live source. Record **what was actually observed**.
- Run `npm run lint`, `npm test`, `npm run build`, relevant Android Gradle tests and PostgreSQL integration CI. Verify Cloudflare/Railway parity separately; do not change Railway just to update docs.
- Never merge/redeploy while another Work session's unfinished source changes are being presented as proven.

## Supporting repository documents

- [Android observation lab](../../tests/android/credential-holder-fixture/session-lab/README.md)
- [Real UTR mode and Pixel limitation](../../tests/android/credential-holder-fixture/session-lab/REAL-UTR.md)
- [Signed issuer-claim acknowledgement, a different trust boundary](DISHA-DEBIT-EVIDENCE-ACKNOWLEDGEMENT.md)
- [Session evidence interface](SESSION-BOUND-MULTI-SIGNAL-EVIDENCE.md)
- [Original Android checkout WebOTP experiment](../ANDROID-CHECKOUT-HANDSHAKE-INTEGRATION-2026-11-21.md)
- [UTR-first hypothesis evaluation](../UTR-FIRST-HYPOTHESIS-EVALUATION-2026.md)
