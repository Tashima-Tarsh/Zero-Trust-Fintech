# DISHA synthetic Android payment handler

This fixture has no payment SDK, UPI handler, or Android network permission. It tests the Chrome return path with a DISHA-owned method. Its Node server never calls checkout, reconciliation or settlement code.

## Run

1. Pick a lab-controlled HTTPS origin that Chrome on the emulator already trusts. Build on JDK 17 with Gradle 8.11.1 from `tests/android/payment-handler-fixture`:

   ```powershell
   gradle '-PfixturePaymentMethod=https://lab.example/pay' :app:assembleDebug
   apksigner verify --print-certs app/build/outputs/apk/debug/app-debug.apk
   adb -s emulator-5554 install app/build/outputs/apk/debug/app-debug.apk
   ```

2. Set `DISHA_FIXTURE_ORIGIN` to that HTTPS origin and `DISHA_FIXTURE_FINGERPRINT` to the APK signer SHA-256 in colon-delimited hex. Set `DISHA_FIXTURE_CERT` and `DISHA_FIXTURE_KEY` to the lab TLS certificate and key. Run `node tests/browser/payment-handler-fixture.cjs`. The server binds to loopback on port 18767 by default. Route the authorized lab origin to it. Use `DISHA_FIXTURE_PORT` to change the local port.
3. Open the lab origin in Android Chrome. Choose **Probe**, then **Run synthetic transport** if eligible. In the fixture, choose **Return synthetic response**. Repeat on a fresh page and choose **Cancel**. The success run should display HTTP 200 and `debitVerified:false`. The canceled run should display a browser rejection and leave the server without a result event.
4. The optional `DISHA_FIXTURE_HTTP_CONTROL=1` mode serves only the loopback negative control. Open `/?probe=1` to run the capability check automatically. It never clicks the launch control. It does not substitute for an HTTPS method manifest.

## Contract and evidence

- Android looks for the Chromium PAY action, one configured method name, and a syntactically valid request ID. The activity returns the method and JSON `details` containing `requestId`, `synthetic:true`, and `outcome:"TRANSPORT_OK"`. Cancel leaves Android's canceled result and no payload.
- Chrome forwards the envelope to the local test server. The server requires an issued request ID, matching inner ID, exact method, exact synthetic schema, and a previously unconsumed ID. It returns `debitVerified:false`.
- The original Android 17/Chrome 145 experiment resolved the Play Services Wallet shim under `org.chromium.intent.action.PAY`. The installed APK declares `https://google.com/pay` and Google authentication methods. The other exported action, `com.google.android.gms.pay.PAY`, belongs to an alias with no Chromium method declaration. The India `tez` method had no eligible handler.
- On the recovered emulator the HTTP control logged `DISHA_FIXTURE /probe/unavailable`. A Chrome-trusted HTTPS method origin and signer manifest were not exercised. The positive Android-to-Chrome callback and cancellation remain unverified in Chrome.
- Local APK build passed with JDK 17 and Gradle 8.11.1. APK SHA-256: `cc8dac66701a2a6288130b387dc2555e9a5241e69903a4add1a5a62054de19b5`. `apksigner verify` passed, installation succeeded, and the emulator resolved `ai.disha.testupi.paymentfixture/ai.disha.testupi.SyntheticPaymentActivity` for the package-scoped Chromium PAY query.
- `node tests/browser/payment-handler-fixture.test.cjs` passed the eight correlation/validation cases and the local HTTP issue, acceptance, malformed JSON and replay checks. `node tests/browser/paymentresponse-lab.test.js` passed 12 existing parser tests. The synthetic HTTP acceptance was injected by the test client.

## What each source could establish

| Source | Transport to DISHA without a new customer app or manual share | Real payer-debit evidence |
| --- | --- | --- |
| Android payment activity result | Available to the native caller of a participating payment activity. A browser-only checkout needs a browser-mediated integration. | Depends on what the provider returns and how it can be verified. |
| Chrome PaymentResponse | Browser-mediated for an eligible, installed payment app. | The envelope transports provider data. This fixture contains only synthetic data. |
| Consented notification observation | The existing DISHA observer needs an authorized native listener. | An observed debit alert is an observation of notification content. |
| Play Services public payment interfaces | The Wallet shim can advertise its own Chrome methods. The tested India method was unavailable. | No payer-debit response observed or established here. |
| Authorized PSP payer-debit event | A provider could deliver an authorized server callback without customer-side DISHA installation. | Only if the provider contract authenticates the payer-side event and binds it to the checkout. No such integration was exercised. |

Sources: [Chromium intent implementation](https://chromium.googlesource.com/chromium/src/+/f5544bb4a3fae467f0db56d0cfdd8544f5181917/chrome/android/java/src/org/chromium/chrome/browser/payments/AndroidPaymentApp.java), [Android payment app guide](https://web.dev/articles/android-payment-apps-developers-guide), [payment method manifest](https://web.dev/articles/setting-up-a-payment-method), [Google Pay India response](https://developers.google.com/pay/india/api/web/googlepay-response), [Google Pay PSP callbacks](https://developers.google.com/pay/india/api/psp/callback/overview).
