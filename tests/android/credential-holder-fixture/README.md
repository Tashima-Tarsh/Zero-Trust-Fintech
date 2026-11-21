# DISHA Android Credential Manager handoff fixture

**Research only — never a payment verifier.** A separate, explicitly installed test holder application registers synthetic SD-JWT credential *metadata* with Android Credential Manager and observes Android's `GET_CREDENTIAL` handoff. It never reads SMS, presents a valid SD-JWT, authenticates a debit, or sends an issuer claim to the DISHA server.

## Build

```bash
gradle -p tests/android/credential-holder-fixture :app:assembleDebug --no-daemon
```

Install the APK **only on an opted-in test Android device**. Launch `DISHA Research Credential Fixture`, select **Register synthetic DISHA credential**, and use Chrome to open:

`https://disha8-2.thenitishkr.in/debit-credential-test.html`

Tap **Request Android Credential (No Payment)**. Watch filtered Logcat:

```bash
adb logcat -s DISHA_CREDENTIAL_FIXTURE:I
```

A log line `Android handoff received` establishes the Android OS-to-provider callback. The fixture deliberately returns `DISHA_TEST_ONLY_NO_BANK_DEBIT_CREDENTIAL` as an Android credential exception, so Chrome may display `NotAllowedError` or another generalized failure. This is expected: it must **not** generate a receipt or mark payment verified.

## Source mapping

- Official Android Holder API: https://developer.android.com/identity/digital-credentials/credential-holder/present-credentials
- The registry is `OpenId4VpRegistry` (default Wasm matcher) with an `SdJwtEntry`.
- The exported activity handles `androidx.credentials.registry.provider.action.GET_CREDENTIAL`.
- `PendingIntentHandler.retrieveProviderGetCredentialRequest` obtains the verified Android handoff and `setGetCredentialException` returns a fail-closed response.
- Real credential presentation must additionally verify the browser's calling origin using an allowlisted browser package/signing certificate and cryptographically verify an issued SD-JWT with holder binding before ever claiming a bank debit.

No production Android APK is bundled with DISHA checkout. This fixture intentionally requires installation **on a laboratory device only**, not on DISHA customers' devices.

## Status

Kotlin source implementation; requires GitHub Android compile CI and physical Android Chrome integration test to establish working platform handshake.
