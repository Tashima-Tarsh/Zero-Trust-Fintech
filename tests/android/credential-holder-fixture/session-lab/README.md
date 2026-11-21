# Android session observation lab

The existing test holder opens this lab from its launcher. Credential Manager selection continues to return the fixture's intentional no-payment exception. The notification bridge uses Android's notification callback and the existing DISHA session-evidence endpoints. The only accepted notification source is the fixture's own package and synthetic channel. The app reads strict typed synthetic fields after checking the sender and session window. It never scans notification history or parses bank text.

## Consent and transport

Android grants notification-listener access through Settings. The in-app disclosure comes before the Settings link. A second explicit action starts an in-memory, per-order grant for at most three minutes. Stop clears local collection immediately and requests server revocation. Removing Android access also stops collection. An already submitted HTTP request can complete before server revocation. Process death drops the in-memory lease and the server independently enforces expiry.

The lab creates a synthetic order using `POST /lab/session`. It enrolls an Android Keystore P-256 public key using `POST /api/session-evidence/authorize` with the order, token, device ID, consent and CSRF header. It signs the ordered `DISHA-SESSION-EVIDENCE-V1` JSON with SHA-256/ECDSA and posts the fields, bearer token and base64url signature to `/api/session-evidence/event`. Keystore signing authenticates the enrolled app key. The flow does not perform hardware attestation or bank authentication.

The router response uses the existing `SIGNAL_MATCHED` state and explicitly sets `paymentVerified` and `debitVerified` to false. The HTTP harness uses the existing schema and router with an isolated, in-memory PostgreSQL engine. Its test package allowlist applies only to this lab router. Production callers retain the existing package defaults. The app sends only structured test fields to device loopback over ADB reverse. The lab is for isolated development and emulator use.

## Run on a test emulator

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix tests/android/credential-holder-fixture/session-lab
node tests/android/credential-holder-fixture/session-lab/test.js
node tests/android/credential-holder-fixture/session-lab/server.js 18766
```

In another terminal, build and install the existing holder fixture. Use `adb -s emulator-5554 reverse tcp:8766 tcp:18766`, open the notification evidence lab, enable system access, start a synthetic session and post a matching notification. Allow the fixture to post test notifications when prompted and press the matching button again. Repeat the matching notification to exercise replay rejection. Use the malformed and mismatch buttons to exercise the respective paths, then stop the session and remove notification access in Settings. Filter Logcat by `DISHA_SESSION_OBSERVATION`.

For a short expiry run, pass a third command-line argument such as `15000` after the port.

## Supported data and financial trust

Android documents notification access and platform protections such as OTP redaction. Google Play requires disclosure, consent and handling protections for sensitive financial and payment information. A release would need review of the in-app disclosure, privacy policy and Data safety declaration for the exact data practices. [Listener API](https://developer.android.com/reference/android/service/notification/NotificationListenerService) · [Android 15 redaction](https://developer.android.com/about/versions/15/behavior-changes-all#otp-redaction) · [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)

Google Pay documents transaction ID, status and amount in its transaction-detail and statement workflows. The reviewed sources do not establish that a bank or UPI app exposes a complete UTR, payee VPA, amount, or final debit or credit status via an Android notification. Real sources stay unsupported until a provider documents the format and supplies approved, redacted samples for the specific app and version. No missing field is reconstructed from the DISHA order. [Google Pay statement verification](https://support.google.com/pay/india/answer/16919844) · [Google Pay transaction status](https://support.google.com/pay/india/answer/16920039)

For payer debit, ICICI Bank's **Composite Pay API** documents UPI initiation and status inquiry for a bank-onboarded corporate ERP flow. Sandbox access starts with a developer account. The bank requires business approval, an NDA and applicable agreements for UAT and production access. This scope covers payments initiated through the authorized integration. For consumer UPI flows, NPCI describes TPAP onboarding through a sponsor bank and the Check Transaction Status API as a PSP facility. An authorized sponsor/PSP must grant access and supply the transaction identifiers, authentication contract and status semantics before DISHA can verify a bank debit. [ICICI Composite Pay](https://www.icici.bank.in/business-banking/cms/corporate-api-suite/payments-api) · [ICICI onboarding](https://developer.icicibank.com/) · [NPCI FAQs](https://www.npci.org.in/what-we-do/upi/faqs) · [NPCI PSP API circular](https://www.npci.org.in/uploads/UPI_OC_No_215_A_FY_2025_26_Guidelines_on_usage_of_UPI_AP_Is_51f4521ef0.pdf)

For merchant credit, a specific candidate is a Razorpay-onboarded merchant accepting UPI payments through the provider. Use merchant credentials to fetch the provider payment and bind its ID, order, amount, currency and merchant account to DISHA's order. Use settlement reconciliation to map the same payment to a settlement and UTR. Confirm actual bank credit with an authorized merchant bank statement or credit feed. Razorpay requires approved KYC and an activated account for settlement. The RBI Master Direction governs payment aggregators. No credentials, authorized transaction, or matched merchant bank credit were available for this lab. [Razorpay Payment API](https://github.com/razorpay/markdown-docs/blob/master/api/payments.md) · [Settlement reconciliation](https://github.com/razorpay/markdown-docs/blob/master/api/settlements/fetch-recon.md) · [Settlement prerequisites](https://d6xcmfyh68wv8.cloudfront.net/docs/payments/settlements/) · [RBI direction](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12896)
