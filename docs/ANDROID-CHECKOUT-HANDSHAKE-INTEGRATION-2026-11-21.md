# DISHA existing checkout: opt-in Android handshake experiment

## What changed

- Reuses `public/checkout.html` (P2P) and `public/merchant-checkout.html` (P2M): **no new checkout page**.
- Enable only with `androidHandshake=1` on the original checkout URL. The normal checkout and payment flow remains unchanged.
- Customer gives explicit one-time consent in the existing checkout.
- Clicking Start invokes existing `DISHAOneTouchVault.authorize(orderId)`, which performs Android platform WebAuthn/passkey verification (fingerprint, face or device PIN, depending on authenticator).
- Once authorized, starts a one-time `navigator.credentials.get({otp:{transport:['sms']}})` WebOTP listener, with expiry min(120 seconds, checkout session expiry).
- After an origin-bound **test** SMS from a second phone and Chrome's approval prompt, the browser displays `SMS_WEBOTP_CHANNEL_CONFIRMED — BANK_DEBIT_UNVERIFIED`. Wrong codes, expiry, cancellation, or unsupported browser are safely handled. No transaction status changes.
- Cloudflare checkout asset allowlist and Android test fixture updated. Built mirrors under `dist/` and `disha-cinematic/` synchronized.

## How to run on your EXISTING checkout

Deploy this revision to your own HTTPS Cloudflare Pages and Railway checkout infrastructure. Open the **same existing payment URL** on Android Chrome, appending `&androidHandshake=1` (or `?androidHandshake=1` when the URL has no existing query string). The existing merchant/payee details and payment buttons are still there.

In the inline **ANDROID HANDSHAKE · EXPERIMENT** section, check consent, tap **Start fingerprint/PIN + SMS test**, authenticate with your device, and copy the generated test SMS. From a *second phone*, send that SMS to the Android phone running Chrome. The last line must be the site's exact hostname plus the generated code (`@your-hostname #123456`). Chrome may ask to let that website receive the code. The checkout shows the result.

Do **not** submit, forward or upload a real bank SMS, bank UTR, PIN or account information to this test. This is a capability experiment, not a genuine payment-verification interface.

## Security boundary

An SMS with an origin-bound WebOTP code only demonstrates browser-approved receipt of a **special test message**, not bank sender provenance. Normal bank debit SMS and GPay/PhonePe notifications remain outside website-accessible surfaces. The browser never marks the payment verified from this test. Only the existing backend settlement/evidence routes control payment receipts. WebAuthn authenticates customer interaction and order binding, not a debit event.

## Local verification

- `node tests/test-android-checkout-handshake.js`: PASS (consent; auth before listening; wrong code; expiry; cancel; page exit; no settlement).
- `node tests/test-checkout-edge-gateway.js`: PASS.
- `node tests/test-android-fixture.js`: PASS.
- `node tests/test-frontend-parity.js`: PASS.
- `node tests/test-proofbridge-checkout-flow.js`: PASS.
- `node scripts/lint.js`: PASS.
- `node scripts/build.js`: PASS.
- `node tests/runner.js`: 51 passed, 8 fail with `Cannot find module 'express'` in this dependency-limited environment, 4 skipped without active servers. No real Android phone or live bank transaction has been tested here.

No production deployment and no bank verification claim are made.
