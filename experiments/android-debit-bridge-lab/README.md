# DISHA Debit Evidence Bridge v1 — Ponytail Prototype

**Status:** Code implemented on an isolated research branch. Automated Node tests can validate the contract. Android APK build, Chrome 145 handler eligibility and Android→Chrome device return **have not been run** in this chat environment.

The design intentionally reuses the existing DISHA checkout pattern: orderId, amountPaise, VPA, consent, nonce, expiry, and a read-only result. No new production payment processor or ledger path.

## Components

| Location | Responsibility |
|---|---|
| `public/labs/disha-debit-bridge.js` | Invented `requestDebitEvidence()` JavaScript facade. Validates session, consent, nonce, returned source and expiry; emits no bank-verified claim |
| `public/labs/disha-paymentrequest-transport.js` | Adapts native Chrome `PaymentRequest.show()` to the facade. No UPI payment method used |
| `public/labs/disha-debit-bridge-lab.html` | Browser test UI. One button uses a synthetic adapter, another attempts actual installed lab Android payment handler |
| `experiments/android-debit-bridge-lab/` | Separate minimal Android Gradle test project with `org.chromium.intent.action.PAY` activity and synthetic `RESULT_OK` or `RESULT_CANCELED` |
| `tests/test-disha-debit-bridge-lab.js` | Pure JS behaviour tests including wrong nonce/order/amount/method, consent, cancellation, synthetic Android event, replay-like overlap |

## Web lab (does not touch production)

From an isolated local DISHA checkout server, open:

```
http://127.0.0.1:3000/labs/disha-debit-bridge-lab.html
```

On Android emulator use the local server and an ADB reverse mapping:

```powershell
adb -s emulator-5554 reverse tcp:3000 tcp:3000
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:3000/labs/disha-debit-bridge-lab.html" com.android.chrome
```

Use **Test protocol using synthetic adapter** first. It returns `LAB_EVENT_OBSERVED_UNVERIFIED` with `debitVerified=false`.

## Android payment handler experiment

Open `experiments/android-debit-bridge-lab/` as a separate Android Studio project and install only on the development AVD. This is a laboratory APK, not a customer deployment.

The Activity registers:
- `org.chromium.intent.action.PAY`
- `org.chromium.default_payment_method_name` = `https://disha8-2.thenitishkr.in/labs/disha-debit-bridge-method`

**Chrome eligibility remains a required gate.** This experiment does not yet publish a real HTTPS payment method manifest or verify origin→app association. The URL is a *proposed identifier only*, not an existing production endpoint. Before testing native `PaymentRequest.show()`, host an explicitly lab-owned HTTPS payment method manifest with verified app package/signing certificate in an isolated, authorized environment, and confirm Chrome 145 recognizes this exact method. Never point a live payment to it. Chrome might reject this method.

The Java Activity currently reads a JSON `data` intent extra matching the lab protocol. Actual Chrome versions can encode payment method data differently. This is a **deliberate fail-closed gate**: if actual device input differs, inspect the consented lab Intent with Android Studio/REA, adjust parser to Chromium's actual public format, then rerun tests. Do not claim a successful Chrome return from a compiled activity alone.

The Activity lets the tester choose synthetic return or cancellation. It emits `methodName`, JSON `details`, and an `instrumentDetails` compatibility candidate. The browser transport recognizes only the explicitly configured lab HTTPS method and accepts only a correctly session-bound synthetic result. No bank/payment application is involved.

## Next integration milestone

1. Install and compile the lab APK on `emulator-5554`.
2. Verify the manifest `PAY` intent filter and default method via `dumpsys package`.
3. Configure proper HTTPS payment-method manifest and app association for the lab-only method.
4. With real click, observe `PaymentRequest.show() → Android RESULT_OK → Chrome PaymentResponse`.
5. Test `RESULT_CANCELED`, wrong nonce, expired session and tab/user-consent cancellation.
6. Only after verified transport, consider connecting the **existing authenticated DISHA evidence endpoints**, requiring real issuer/provider provenance before `debitVerified` can ever be true.

## Deliberate exclusions — Ponytail

- No changes to `server.js`, production checkout, DB schema, existing financial ledger or receipt authority.
- No SMS read/notification privileges, root, account access or private Google Pay APIs.
- No customer APK rollout.
- No claim that `PaymentRequest` alone can read a bank debit.
- No new production service or secret.

The `navigator.dishaDebitBridge.requestDebitEvidence()` described earlier is **not a stock Chrome API**. Here we implement the same interface as the test-only `DISHADebitBridgeLab.create(...).requestDebitEvidence()` facade, with a pluggable transport. A real `navigator.*` API needs a browser/OS implementation or a privileged, user-consented bridge.
