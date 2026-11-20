# DISHA Android UPI Result Host

A minimal native Android host with **no NotificationListenerService** and no notification, Accessibility, camera, microphone, contacts or location permissions. It uses only INTERNET.

## Flow
1. Receives a short-lived DISHA deep-link handoff.
2. Enrols an app-scoped P-256 Android Keystore key against the active checkout session.
3. Launches the selected installed UPI app.
4. Receives the UPI activity result through AndroidX Activity Result API.
5. Extracts only fields explicitly returned: status, response code, transaction ID, approval reference, merchant transaction reference, and optional amount/payee.
6. Signs normalized evidence and posts to the existing session-evidence endpoint.
7. Returns the browser to checkout.

## Browser handoff
The web checkout must construct this link from the server-issued active session:

    disha://pay?apiBase=<encoded-origin>&orderId=<order>&token=<session-token>&upiUri=<encoded-upi-uri>&upiPackage=<package>&returnUrl=<encoded-checkout-url>

Allowed app package IDs: GPay, PhonePe, Paytm and BHIM. The checkout must disclose that returned transaction fields are sent to DISHA for this payment session. The token must be short-lived, never a Clerk secret or long-lived credential.

## Response boundary
Android's activity-result API returns data only when the called UPI app implements the UPI response contract. Generic ACTION_VIEW does not guarantee a result. Missing data is reported as missing; no UTR is invented and no payment is marked successful. ApprovalRefNo is preferred as the UTR/reference candidate; txnId is used only if it is absent. txnRef is the merchant request reference, not a payer UTR. Amount/payee are forwarded only when actually returned.

## Build
From android/ with JDK 17, Android SDK Platform 35 and Gradle 8.9:

    gradle :upi-host:assembleDebug

The APK is produced under upi-host/build/outputs/apk/debug/.

## Release gates
The checkout handoff is not yet wired. Real-device return contracts for GPay/PhonePe/Paytm/BHIM are not yet verified. Signing/distribution and verified Android App Links are not configured. The legacy notification-listener library is a separate module and is not a dependency of this host.
