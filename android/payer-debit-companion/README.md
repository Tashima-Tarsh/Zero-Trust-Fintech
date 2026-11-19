# DISHA 8.2 — opt-in Android payer-debit evidence companion

Open this directory in Android Studio. Sync the Gradle project and run it on a physical Android phone. This is **not** a UPI payment app and **not** the simulated test receiver.

1. In the live DISHA P2P or P2M checkout, authorize DISHA Vault using the device's passkey/biometric.
2. Tap Open DISHA Android companion; it pairs to that single order using a short-lived one-time code.
3. In the companion, explicitly grant Notification access from Android Settings; return to the ORIGINAL checkout and use Google Pay/PhonePe/Paytm/BHIM normally.
4. The companion inspects notifications *only* from locally allowlisted payment-app packages while a pair is active. Extracted amount, UTR, payee, OS source package and timestamp are signed with an AndroidKeystore P-256 device key, then sent to DISHA's first-party endpoint. Raw notification contents, PIN, OTP and SMS are not transmitted.
5. The server checks the pair, signature, original order, amount, permitted sender package, timing, UTR and replay history. It never posts a credit from this observation.
6. The checkout may show **Payer debit evidence matched**. This is payer-side evidence, not a beneficiary-credit receipt.

Default supported packages: Google Pay, PhonePe, Paytm and BHIM. To support an actual bank-app debit notification, the operator must verify the bank's package and add it to DISHA_DEBIT_SOURCE_PACKAGES on the backend. Generic SMS apps are excluded by default.

Notification access covers broad notifications at the operating-system permission level, although this code filters locally. Permission cannot be granted by WebAuthn or a website. Android 15+ may redact sensitive notification content. Notifications do not always contain a UTR, and Android signing does not prove the bank actually debited or credited an account. You may unpair at any time in the app; active collection expires with the checkout.

No Accessibility Service, SMS read, background screen capture, payment-gateway webhook, or bank API.

**Release gate:** Android Studio physical-device notification test, permission refusal, redacted notifications, fake/same-amount events, cancelled payment, duplicate UTR, expired pair and network retry. Do not declare production-ready based on emulator or JS tests alone.
