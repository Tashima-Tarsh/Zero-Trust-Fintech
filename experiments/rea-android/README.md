# REA + DISHA Android Payment Evidence — source-guided discovery

## What already exists on the tested AVD

Grounded in the user's `dumpsys package com.google.android.gms` output:

| Android component/action | Observation | Integration decision |
|---|---|---|
| `org.chromium.intent.action.PAY` | `com.google.android.gms/.wallet.ow.ChooseAccountShimActivity` | **Research candidate** for a Chrome/Android payment app callback. Does not prove India UPI support. |
| `com.google.android.gms.pay.PAY` | `com.google.android.gms/.pay.main.PayImplicitIntentActivity` | **Research candidate** for Google services' payment UI. Does not provide a PSP bank debit callback. |
| `upi://pay` `ACTION_VIEW` | `No activities found` | **Unavailable** for the synthetic intent on this AVD. |
| `com.google.android.gms` | Installed | **Confirmed** platform services, not the Google Pay India UPI application. |
| Chrome `PaymentRequest.canMakePayment()` | `false` for `https://tez.google.com/pay` synthetic request | API works; **eligible India UPI instrument not demonstrated**. |

## Source-backed architecture

Chromium `AndroidPaymentApp.java` defines the Android payment-intent action, launches an eligible app, and implements the returned Activity result callback. That enables `PaymentRequest.show()` to resolve in Chrome **only when** an eligible payment handler is registered and the user explicitly initiates that payment. It is not a general listener for bank SMS, PSP bank server callbacks, or arbitrary transaction history.

Google Chrome documentation also distinguishes Android **WebView**'s support for `org.chromium.intent.action.PAY` and its integration requirements. Some emulator `Google Play Services` `PAY` activities are Google Wallet / Google Pay payment methods, **not proof of Indian UPI payer-debit support**.

References:
- https://chromium.googlesource.com/chromium/src/+/main/chrome/android/java/src/org/chromium/chrome/browser/payments/AndroidPaymentApp.java
- https://developer.chrome.com/docs/android/payments-in-webviews
- https://developers.google.com/pay/india/api/web/handle-response
- https://developers.google.com/pay/india/api/psp/callback/overview

## Install and enable REA on the Windows machine running Android Studio

REA official repository: https://github.com/morluto/rea

The official REA environment currently requires Node `22.23.4+`, `24.22.1+`, or `26.12.1+` and npm. For Android APK decompilation REA needs a full JDK and working JADX. REA's Android-device inspection needs working ADB.

With an updated Node, run from the repository in PowerShell:

```powershell
.\experiments\rea-android\setup-and-observe.ps1 -Mode Setup
```

This invokes official `npx --yes rea-agents setup`, which registers REA's MCP interface for an installed supported agent. **Restart Codex/agent after setup** and check that REA tools appear. Do not treat a successful setup command as proof that the REA provider is connected.

With `emulator-5554` booted:

```powershell
.\experiments\rea-android\setup-and-observe.ps1 -Mode Inspect
```

The script captures **bounded metadata** only, under `rea-android-observations/` in the local checkout. Review it before sharing. Do not collect account profiles, live payments, private keys or bank credentials.

REA Android APK analysis: inspect the public intent filters and declared Android export/permissions for the two named Google Play Services activities, then investigate the same action in Chromium source. Do not decompile or inspect Google app private account data or invoke internal payment components with synthetic privileged payloads.

## REA prompt for a local authorized research agent

> Use REA's Android discovery tools and the existing Pixel AVD. Discover `com.google.android.gms`, its `org.chromium.intent.action.PAY` and `com.google.android.gms.pay.PAY` handlers, then compare them to Chromium `AndroidPaymentApp.java`. Provide manifest export/permission/method metadata and source citations. Reuse DISHA's `paymentresponse-lab.html` and `paymentresponse-lab.js` with synthetic, consented user-initiated PaymentRequest only; record `canMakePayment`, `show` and any returned `methodName` plus field **names** (never log raw sensitive response data). Locate any **payer debit** status channel supported on this AVD and document actual evidence. Do not attempt to access private PSP communications, extract credentials, or claim that wallet/card methods support UPI. If no channel works, state the precise technical blocker.

## What we can integrate today

**A. Existing Chrome PaymentRequest lab** (controlled only): reuse `public/paymentresponse-lab.js` or matching checked-in location, and test `show()` with a supported public test handler; return response *metadata* to a local test server. It tests transport only.

**B. Existing payer SMS notification lab** (requires installed DISHA test observer and explicit notification access): reuse `PaymentObservationListener.kt`, `DebitSmsNotification.kt` and its test. Simulated bank-like notification can produce an RRN candidate. It is not zero-install.

**C. Existing DISHA payer debit research receiver**: draft PR #133 is a proposed separately authorized PSP payer-debit event endpoint. A real PSP cannot be assumed to send to it; simulated signed events are not actual bank events.

### No evidence yet

No observed browser-accessible Google Pay India UPI transaction response; no bank-authorized PSP-to-DISHA callback; no zero-install arbitrary bank SMS read. Therefore no pathway can be represented as a fully verified live payer-debit flow yet.

## Source-to-discovery gates

1. **Manifest:** Is handler exported, accessible by Chrome, and associated with a supported payment method identifier?
2. **Ready:** Does `canMakePayment()` return `true` on this AVD for that exact method and eligible instrument?
3. **Runtime:** Does explicit `PaymentRequest.show()` result in a `PaymentResponse`?
4. **Semantics:** Does the result actually indicate a payer UPI debit, or only a wallet/card instrument?
5. **Provenance:** Can the evidence source be authenticated without confusing a browser echo with actual bank debit?
6. **End-to-end:** Does the approved event reach DISHA and remain correctly session-bound, replay-safe and reversal-aware?

Only advance to financial integration when all required live gates are proven. A previous gate passing is not evidence of the next gate.
