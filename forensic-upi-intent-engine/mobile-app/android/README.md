# Android native module integration

This folder contains Java native module sources, **not** a generated buildable React Native Android project. Use a compatible React Native CLI version to generate Gradle/manifest/MainApplication files, and register `ForensicUPIPackage` in the application's package list.

`UPIIntentBridge` launches a `upi://pay` intent and reports an approximate elapsed time after the app is resumed. It can query APK signer SHA-256 for a known installed package if Android package visibility allows, but cannot guarantee which app ultimately processed the payment. Keep signed-package allowlists independently verified, never copied from untrusted device reports.

`SecureSnapshot` optionally invokes PixelCopy on this application's **own** window after an explicit consent flag; it discards the pixels. It does **not** silently capture another PSP application's success screen. Android MediaProjection requires OS consent and cannot bypass FLAG_SECURE/protected content.

Neither native module confirms a payment; use bank-side reconciliation. Never use raw motion traces, persistent device identifiers, or covert media capture.
