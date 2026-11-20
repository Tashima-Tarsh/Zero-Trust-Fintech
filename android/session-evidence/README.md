# DISHA session evidence Android library

This directory is a Gradle Android library module named :session-evidence. It packages the notification listener and permission-state helper into an AAR. It is not a standalone APK; it must be included by the Android application that owns the payer checkout UI.

## Build

From the repository android/ directory, with JDK 17, Android SDK Platform 35 and Gradle 8.9 or compatible installed:

```sh
gradle :session-evidence:assembleDebug
```

The output is an AAR under session-evidence/build/outputs/aar/.

## Required payer flow

1. The checkout UI explains that Android Notification Access is a broad OS permission and asks for explicit consent. Do not imply that Android scopes this permission to one checkout.
2. Check SessionEvidenceAccess.hasNotificationAccess(context). If false, call SessionEvidenceNotificationListener.openNotificationAccessSettings(context) only after the payer chooses to continue.
3. When Android returns to the host app, check access again. If granted, call SessionEvidenceNotificationListener.enroll(context, apiBase, orderId, sessionToken, deviceId).
4. Generate and persist a random, app-scoped device ID. Do not use an advertising ID. The Android Keystore P-256 key is held by the OS.
5. Keep the checkout order ID and session token in protected host-app session state. Do not put the token in a URL, analytics event or log.
6. On checkout completion, expiry, or consent revocation, call stopSession(context). For explicit revocation while online, call revokeSession(context); local collection is cleared even if the network request fails.
7. A second payer device must separately grant OS access and enroll with the same active checkout session credentials. The server caps enrollment at three devices.

## Server contract

- POST /api/session-evidence/authorize enrolls the device against the active checkout.
- POST /api/session-evidence/event accepts signed, parsed notification fields.
- GET /api/session-evidence/status/:orderId?token=... returns the aggregate evidence state.
- POST /api/session-evidence/revoke revokes the session evidence window.

Evidence ingestion does not itself change checkout status or ledger records. The host checkout must read the status endpoint and render the returned decision; it must not treat a listener callback as a completed payment.

## Privacy and parsing limits

- Android Notification Access is system-wide. The listener filters to the server's allowlisted UPI package IDs and forwards only parsed candidate fields during an active, unexpired DISHA session. It does not upload full notification text or unrelated app notifications.
- Notification formats vary by UPI app, app version and language. Amount, payee VPA, reference and status may be absent, redacted or ambiguous. Missing values remain null; never infer them.
- Notifications can be delayed or posted more than once. The server validates session binding, timestamp, amount/payee, event uniqueness and reference reuse.
- The P-256 signature authenticates the enrolled app key, not the truth of the notification, hardware integrity or a non-compromised OS.
- Notification access can be revoked in Android settings at any time. The host must re-check access when the app resumes and stop local collection if access is absent.

## Remaining release integration

The customer checkout is web-based. A browser cannot grant Android Notification Access or host a NotificationListenerService. The Android host app must own the consent/pairing screen and provide a deliberate handoff from checkout to the installed host app. This library supplies the native listener; it does not silently install an app, bypass OS consent, or make the existing web checkout a native host.

Physical-device validation against current Google Pay and PhonePe notification layouts is required before production use. No live GPay/PhonePe extraction is claimed by this source module alone.
