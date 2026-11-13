# React Native client source scaffold

Includes intent/QR UI, optional consented aggregate telemetry, server-assigned VPA retrieval, app-switch timing, and native Android module source. This is **not a full native application**: Android Gradle files and iOS Xcode projects must be generated and integrated before a device build.

Security boundaries:
- React Native and browser clients must never hold n8n credentials or `WORKER_API_KEY`.
- Call only a merchant-controlled, tenant-scoped HTTPS proxy.
- The `VPARotator` helper fetches a *server*-leased VPA and never selects one locally.
- `AppStateTracker` and `TelemetrySDK` are opt-in and do not fingerprint devices or read sensor streams.
- `SecureSnapshot` can only capture/discard the merchant application's own window after consent; other UPI apps cannot be silently screenshotted.
- Payment app return is never evidence of bank credit.

An iOS native scaffold requires Xcode, signing, a supported UPI scheme and compatible RN templates. No promise of iOS PSP app package inspection is made.
