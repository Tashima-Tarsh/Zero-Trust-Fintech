# DISHA 8.2 — P2P UPI Merchant SaaS / Android Test Matrix (18 Nov 2026)

**Scope:** the deployed merchant SaaS, Clerk, PostgreSQL, real customer
\`/merchant-checkout.html\`, the legacy \`/checkout/\` path, Android UPI intents,
risk controls, callback/status handling, dashboard/ledger and deployment recovery.

**Risk principle:** "Opening a UPI app", "returning to the browser", a custom
\`Status=SUCCESS\` query parameter, a UI screenshot and a self-reported UTR
are NOT themselves evidence of a credited UPI transfer. The final status and
financial entries must only reflect the payment evidence channel actually
implemented and audited. Emulator tests prove UI/intent transport, not bank
settlement.

## Environments and run modes

- **CI API + PostgreSQL:** Existing \`tests/test-postgres-merchant-saas.js\`,
  \`tests/test-postgres-financial-core.js\`, \`tests/test-postgres-checkout-store.js\`
  run against disposable Postgres; no real payment or merchant secrets.
- **CI Android 15 (API 35) and Android 17 (API 37):** New workflow
  \`.github/workflows/android-p2p-emulator.yml\`. Boots Google's Android
  emulator using ReactiveCircus, builds a deliberately non-paying UPI intent
  receiver and renders the *real* merchant checkout HTML in a WebView. The
  fake backend exists ONLY inside GitHub Actions.
- **Real device UAT:** Actual Android phone with SIM binding and bank-linked
  Google Pay/PhonePe/BHIM, your own recipient VPA and controlled ₹1 test.
  This MUST NOT be run in CI or through the fake receiver.
- **Production-read-only:** Auth, page status, header checks, no fake
  balances, HTTP availability, logs and dashboard access. Do not post to
  live merchant APIs automatically just to obtain a green test.

Test outcomes: **PASS / FAIL / BLOCKED / NOT RUN**. A CI suite can be green
while real-bank UAT remains NOT RUN. Never label it complete by inference.

## Test case catalog

Columns: Case, Priority, Action and expectation, Mode.
P0 = release blocker, P1 = required before accepting merchants,
P2 = additional regression.

### Merchant identity and onboarding

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| M01 | P0 | Sign up via Clerk; new merchant account is created with no fake orders, volumes or VPAs | Device/manual |
| M02 | P0 | Log in with valid Clerk session; only that merchant's workspace loads | Device/manual |
| M03 | P0 | Open merchant API without auth; HTTP 401, no tenant information | CI |
| M04 | P0 | Present arbitrary X-Merchant-ID or another tenant's ID; ignored, authenticated Clerk subject controls scope | CI |
| M05 | P0 | Sign out then revisit dashboard and API; protected content remains inaccessible | Browser/manual |
| M06 | P1 | Expired, malformed or revoked Clerk token; 401 and helpful sign-in path | CI/Browser |
| M07 | P1 | Complete setup: business name, actual personal UPI, PERSONAL/P2P, MCC blank; accepted and persisted | CI/Device |
| M08 | P0 | Existing VPA registered by merchant A reused by merchant B; rejected without exposing owner | CI |
| M09 | P1 | Malformed VPA with whitespace, @ missing, invalid handle; rejected | CI |
| M10 | P1 | P2P setup must not demand MCC; generated payment URI has NO mc field | CI/Android |
| M11 | P1 | Optional P2M option with valid bank-issued 4-digit MCC; uses P2M semantics, never guesses MCC | CI |
| M12 | P1 | Attempt P2M MCC absent or invalid (letters, 3/5 digits); validation error | CI |
| M13 | P1 | Update business name, phone and city; refreshed dashboard reflects persisted values | CI/Browser |
| M14 | P1 | Add second receiver VPA and set primary; only one primary, routing chooses active account | CI/Browser |
| M15 | P1 | Pause primary without replacement; blocked; pause nonprimary succeeds | CI |
| M16 | P0 | Attempt new payment with no active receiving VPA; rejected without inserting pending session | CI |
| M17 | P1 | Two merchants in simultaneous sessions, different devices; data never crosses tenants | CI/Device |
| M18 | P2 | Keyboard/screen-reader navigation, validation and error states on mobile sign-up | Android/manual |

### Payment request, QR, link and checkout

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| P01 | P0 | Create ₹499.01 P2P request; server creates one new PENDING session and merchant-owned order | CI |
| P02 | P0 | QR/intent payee equals chosen receiving VPA, amount is exactly ₹499.01, cu=INR; no mc for P2P | CI/Android |
| P03 | P0 | Public checkout token absent/incorrect/altered; no order returned, no merchant-private data leaked | CI |
| P04 | P0 | Merchant B cannot read merchant A's orders or export | CI |
| P05 | P1 | Customer opens copied checkout URL, sees correct business, description, VPA, amount, expiry | Android |
| P06 | P1 | QR visible with mobile desktop view; QR value equals Open UPI app URI | Android/manual |
| P07 | P0 | Invalid amount: 0, negative, NaN, overly large, more than two decimal places; reject without session | CI |
| P08 | P1 | Merchant-supplied reference is kept as metadata, order/session IDs remain unique and unpredictable | CI |
| P09 | P0 | Payment request expires after configured TTL; link no longer offers a usable payment action | Android |
| P10 | P1 | Refresh browser page retains same order, no accidental duplicate payment request | Android |
| P11 | P1 | Fast double-tap Create Payment; review duplicate-submit prevention and idempotency | Browser/manual |
| P12 | P0 | Two equal-amount requests for different customers; distinct tokens/orders, no cross-assignment | CI |
| P13 | P1 | P2P QR lacks bank-issued P2M MCC; P2M QR includes validated MCC and reference if used | CI |
| P14 | P1 | Mobile 360x800 and 412x915 layouts have legible amount and tappable buttons | Android |
| P15 | P1 | Refresh payment status uses recorded backend state, not browser-local simulated payment | Android |
| P16 | P1 | Clipboard copy button copies exact URI, respecting clipboard permission/errors | Android/manual |
| P17 | P1 | QR library failure or offline assets give understandable fallback, no blank payment link | Android/manual |
| P18 | P0 | Access legacy \`/checkout/\` path; record whether it still requires manual 12-digit UTR (separate release requirement) | Browser/manual |

### Actual Android app handoff (the emulator suite is test-only)

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| A01 | P0 | Android WebView loads exact merchant checkout page with actual DOM and JS | CI Android |
| A02 | P0 | Tap Open UPI app; Android dispatches ACTION_VIEW \`upi://pay\` to installed test receiver | CI Android |
| A03 | P0 | Test receiver displays correct pa, pn, amount, INR and no MCC for P2P | CI Android |
| A04 | P0 | Test receiver cancelled/back; checkout remains PENDING and ledger unchanged | CI Android |
| A05 | P0 | Only changed test-backend status makes UI show completed; app return alone never does | CI Android |
| A06 | P0 | Expired request shows EXPIRED and UPI button cannot be used | CI Android |
| A07 | P1 | Android 15 API 35 runs A01–A06 | CI Android |
| A08 | P1 | Android 17 API 37 runs A01–A06; obeys new 4 GB AVD RAM minimum | CI Android |
| A09 | P1 | Android Chrome (not only WebView) opens generic UPI intent from HTTPS page | Physical/manual |
| A10 | P1 | No UPI handler installed; understandable fallback, QR still usable | Device/manual |
| A11 | P1 | Multiple handlers installed: chooser and selected app preserve amount/payee | Physical/manual |
| A12 | P1 | App switch to background, swipe away, browser resumed; no false completion | Physical/manual |
| A13 | P1 | Android Back pressed before PIN; checkout remains pending and is resumable | Physical/manual |
| A14 | P1 | Rotate screen, split-screen, font 200%, dark mode; UI readable and no duplicate submission | Android/manual |
| A15 | P1 | Poor network (2G/3G/offline) before app open and on return; safe pending/error and retry | Android/manual |
| A16 | P1 | Deep link handling on Google Pay, PhonePe and BHIM on a real SIM-bound phone | Physical/manual |
| A17 | P1 | Android OEM devices: stock Pixel, Samsung, Xiaomi and OnePlus | Physical/manual |
| A18 | P1 | Do not register a real bank account or enter a UPI PIN in an emulator | Policy/manual |

#### New negative-path emulator coverage (PR #63)

The test-only receiver now supports two explicit outcomes triggered by the
Android E2E runner while a real native UPI activity is in the foreground:

- `PRE_PIN_FAILURE`: the fake app returns `RESULT_CANCELED` with
  `Status=FAILURE`. The checkout must keep the same PENDING request and
  must not create a receipt.
- `APP_REPORTED_SUCCESS`: the fake app returns `RESULT_OK` with
  `Status=SUCCESS` **without transferring money**. The checkout must
  still remain PENDING and must not create a receipt.

The runner verifies a **fresh** native activity-return log, the unchanged
fixture ledger, and zero submitted vault events. These are regression tests
only; neither scenario reproduces GPay/PhonePe's internal pre-PIN validation.

**Still blocked for release:** physical Android Chrome + real registered UPI
apps, with a real issued P2P/P2M receiving account and an independently
confirmed small-value test. Record the app, Android version, whether the
correct payee/amount appeared, the exact *redacted* pre-PIN error text,
and compare the bank-issued QR to the DISHA URI using
`node scripts/upi-acceptance-harness.js`. Never upload a PIN, bearer token,
account balance, or a full customer logcat into public CI artifacts.

### Verification, security, callback and accounting

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| V01 | P0 | Open app then return with no payment; payment never becomes COMPLETED | CI/Physical |
| V02 | P0 | Forge \`Status=SUCCESS\` or UTR in browser URL; must not finalize payment | CI/security |
| V03 | P0 | Fake UPI intent receiver says "success"; only app return, not financial proof | CI/security |
| V04 | P0 | Wrong PIN and cancel on real phone; no completed merchant order | Physical |
| V05 | P0 | Insufficient balance / bank decline; order not completed | Physical |
| V06 | P0 | Amount mismatch or wrong payee; target order must not be credited | CI/security |
| V07 | P0 | UTR reused against second order; replay rejected/quarantined | CI |
| V08 | P0 | Race: concurrent attempts to finalize same order; at most one committed journal | CI |
| V09 | P0 | Expired order callback/return arrives late; no out-of-window credit without audited reconciliation policy | CI |
| V10 | P0 | Duplicate/retried callback; idempotent status and no duplicate ledger entries | CI |
| V11 | P0 | Ledger amount is exact integer paise, no floating rounding or imbalance | CI |
| V12 | P0 | Recorded success requires evidence actually available through the configured verification flow | Audit/Physical |
| V13 | P0 | Merchant A cannot change B's order via another tenant's API | CI/security |
| V14 | P1 | Missing auth, CSRF token, malformed JSON, replay nonce and rate-limit bursts are handled | CI |
| V15 | P1 | HTTP lost while mobile app open; state is polled/recovered after browser resumes | Android/manual |
| V16 | P1 | WebSocket disconnected/reconnected; no phantom success | CI/Android |
| V17 | P1 | A payment is disputed/reversed later; ledger state and audit trail reflect reversal policy | Audit |
| V18 | P0 | Customer screenshot or claim without accepted evidence cannot make ledger SUCCESS | CI |
| V19 | P1 | Pending order times out, dashboard counts move to expired correctly | CI/Android |
| V20 | P0 | Existing \`/api/verify\` receipt parser checked for false-positive confirmations, not simply token formatting | Security review |

### Merchant dashboard, operations, mobile UI

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| D01 | P0 | New merchant sees zero balances/transactions, no preview orders or sample settlements | CI |
| D02 | P1 | All 12 navigation sections and mobile sidebar are responsive and keyboard reachable | CI/Android |
| D03 | P0 | Created order appears in merchant Payments immediately with PENDING status | CI |
| D04 | P0 | Other merchant cannot see order in dashboard, search or CSV | CI |
| D05 | P1 | Dashboard amounts/counts agree with PostgreSQL source rows | CI |
| D06 | P1 | Date filters today / 7d / 30d / all match expected results | CI |
| D07 | P1 | CSV export has correct currency and escapes spreadsheet formula injection | CI |
| D08 | P1 | Notification for created payment appears, read action persists | CI |
| D09 | P1 | VPA controls update live state; paused account isn't selected for new payment | CI |
| D10 | P2 | Soundbox says latest actually completed order; no synthetic announcement | Browser |
| D11 | P1 | IP directory is not misrepresented as enforced on payment APIs | Audit |
| D12 | P1 | Invalid session, empty/error response and expired auth show clean UI failures | Android/manual |
| D13 | P1 | No exposed internal debug console, mock data, fake payment button or sensitive logs | CI/security |
| D14 | P1 | Every button acts, errors are visible, no dead controls on 360px mobile | Android/manual |

### Infrastructure, resilience and privacy

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| I01 | P0 | PostgreSQL-only authority survives Railway restart; same orders/VPAs and users remain | Staging |
| I02 | P0 | Merchant tables created idempotently without deleting old financial entries | CI |
| I03 | P0 | Data backups verified by checksums and sampled restore | Disaster-recovery exercise |
| I04 | P0 | Clerk public routes reach Railway; protected merchant APIs never bypass server auth at Cloudflare | CI/Browser |
| I05 | P1 | Cloudflare/reverse proxy forwards query token unmodified, no accidental caching of private order | Browser |
| I06 | P1 | Secrets are absent from screenshots, browser localStorage, public bundles and error messages | Security |
| I07 | P1 | API rate-limits and malformed inputs handled without crashing app | CI |
| I08 | P1 | Backend outage returns retryable error, no simulated success, no duplicate payment | Android |
| I09 | P1 | HTTPS, security headers and redirects remain correct on mobile | Browser |
| I10 | P0 | Re-deployment leaves customer orders, VPA assignment, passkeys, webhook state and ledger consistent | Staging |

### Real ₹1 / ₹2 transfer validation (requires an authorized human using a real phone)

| ID | Priority | Action / expected result | Mode |
|---|---|---|---|
| R01 | P0 | Customer Android phone with registered SIM and bank-linked UPI app opens actual merchant checkout link | Physical |
| R02 | P0 | Confirm amount and recipient on bank app before approving; do not enter PIN into merchant website | Physical |
| R03 | P0 | Customer approves a small genuine P2P payment to an account they control or consent to test | Physical |
| R04 | P0 | Confirm bank debit, recipient credit, amount and UTR through independently available bank records | Physical |
| R05 | P0 | Confirm DISHA status and ledger truth match the genuine bank outcome; investigate discrepancies | Physical |
| R06 | P0 | Repeat after wrong PIN / cancel / low balance; ensure no false credit | Physical |
| R07 | P1 | Retry with GPay, PhonePe, BHIM (when supported) across different Android OS versions | Physical |
| R08 | P1 | Test pending, delayed settlement, reversal and outages only with the bank's permitted testing procedures | Physical |

## Automated Android test evidence

The \`android-p2p-emulator.yml\` GitHub Action uploads:
- Screenshot and UI hierarchy of PENDING checkout;
- The **test-only** UPI receiver page showing payee and amount;
- Screenshot after cancellation with PENDING preserved;
- Screenshot after changing only the *fixture backend* state;
- Screenshot after expiry;
- Sanitized \`DISHA_UPI_TEST\` logcat and HTTP fixture startup log.

No real PIN, customer number, bank credentials or production UTR is used.

## Release gate

**Do not approve production readiness** unless:
1. All P0 API/PostgreSQL tests PASS.
2. Android 15 and 17 emulator runs PASS or failures are resolved.
3. R01–R05 pass on a real phone with real account evidence.
4. V01–V03, V07–V12 and V18/V20 are independently audited.
5. Merchant tenant isolation, duplicate attempt, retry and exact amount are proven.
6. Existing legacy \`/checkout/\` path is audited or explicitly deprecated.
7. The exact build under test is the build deployed to the intended production domain.

Anything requiring actual bank settlement should be marked **NOT RUN** until a permitted transfer or sanctioned bank test environment is available.

## Local developer alternatives

- Android Studio Emulator with Android 15 (API 35) and Android 17 (API 37),
  preferably Google APIs x86_64. Android 17 AVD requires at least 4 GB RAM.
- <https://github.com/ReactiveCircus/android-emulator-runner> for reproducible
  disposable GitHub Actions emulators (recommended for this PWA).
- Firebase Test Lab Spark includes a limited no-cost virtual/physical test quota,
  but an Android APK/UIAutomator runner is required to use it for a web-first flow.
- <https://github.com/payu-india/PayU-UPI-Intent-Simulator-App> is a
  **PayU-specific** intent simulator. Its provider-specific sandbox status does
  not validate DISHA's independent P2P financial settlement.

Official references:
- <https://developer.android.com/about/versions/17/setup-sdk>
- <https://developer.android.com/studio/run/emulator>
- <https://developers.google.com/pay/india/api/android/overview>
- <https://firebase.google.com/docs/test-lab/usage-quotas-pricing>
