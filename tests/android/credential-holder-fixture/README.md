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

## Emulator evidence (2026-11-21)

- **Android-to-server signed challenge: PASS.** The emulator installed the fixture, invoked the lab button, generated a P-256 key inside AndroidKeyStore, signed the server's 32-byte challenge and received a successful signature verification over the local `adb reverse` connection. CI emitted `ANDROID_SERVER_HANDSHAKE_PASS`. Node regression tests cover nonce substitution, changed signature, TTL expiry and replay; no UTR or bank success is generated.
- **Chrome-to-Android credential provider: NOT PASSED.** On Android 35 Google Play, `RegistryManager.registerCredentials` first failed with no provider dependencies found. On Android 36 Google Play Store, diagnostics confirmed `GMS_VERSION=250834038`, `GMS_AVAILABILITY=0`, and `REGISTRY_METADATA_FOUND=true` with the correct provider class. The next registration step returned `RegisterCredentialsUnknownException: 17`. Google Play services identifies status 17 as `API_NOT_CONNECTED` for the relevant API. Credential registration therefore did not reach the Chrome callback.
- This does not establish production readiness or customer-phone SMS access. The Google Play Identity Credential registration service must become available to the test app/device, or a separately supported Android platform credential-provider path must be used. Keep the e2e job failing until it reaches `Android handoff received`; never relax its assertion to merely detect `DigitalCredential`.

Android 36 Google Play emulator result: CI job `136763710126`, commit `38815eaf3a59bc1ee261f4088935c59098526355`. Chrome/provider handoff was **not** demonstrated.

## Local Android Studio / Windows diagnostics

To reproduce the issue without touching production payments, launch an **Android 36 Google Play Store** AVD in Android Studio (do not attempt to log in with accounts you cannot use). From Windows PowerShell in the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File tests/android/credential-holder-fixture/doctor.ps1
```

This read-only preflight saves `local-diagnostics/<timestamp>/` containing ADB connectivity, SDK/GMS build, the fixture's installed manifest information, emulator list, filtered Logcat, and a Gradle `--no-daemon` debug build. If ADB cannot initialize the interrupt socket or Gradle cannot connect to its daemon, restart **only** local tooling:

```powershell
powershell -ExecutionPolicy Bypass -File tests/android/credential-holder-fixture/doctor.ps1 -RepairLocalTools
```

`-RepairLocalTools` performs `adb kill-server`/`start-server` and `gradle --stop`, then uses `--no-daemon` for the build. Neither command changes device accounts, Google Play Services, or production payment records. The script never needs Google account credentials. Logs may contain system identifiers; review before sharing.

### CI matrix result (commit `9d22d7f`)

- Android **35** Google Play image: `GMS_AVAILABILITY=2` (Play Services needs update); registration ends in `RegisterCredentialsConfigurationException` — not an eligible comparison for digital holder flow.
- Android **36** Google Play image: `GMS_AVAILABILITY=0`, registry provider metadata present, but `RegisterCredentialsUnknownException: 17` from the GMS Identity Credentials registration client. This is *not* evidence that Android does not have Credential Manager or that DISHA signing failed.
- Google's `IdentityCredentialClient.registerCredentials` API documents status 17 for disallowed operations; a Google-side eligibility/API enablement restriction is a **hypothesis**, not an established root cause. See https://developers.google.com/android/reference/com/google/android/gms/identitycredentials/IdentityCredentialClient and https://developers.google.com/android/reference/com/google/android/gms/common/api/CommonStatusCodes .
- Do not mark the Chrome holder flow green until the emulator actually logs `Android handoff received`. An Android Studio Gradle sync passing is not the browser callback.

## Controlled experiment — exact-path registration failure (2026-11-21)

**Evidence-based conclusion:** Android 36 Play Store image reaches the GMS `IdentityCredentialClient.registerCredentials` callback with status **17 / API_NOT_CONNECTED**, despite `GMS_AVAILABILITY=0` and the correct provider metadata. The AndroidX `RegistryManagerProviderPlayServicesImpl` converts that returned failure into `RegisterCredentialsUnknownException`. The application cannot read GMS's internal policy decision from this exception. Google's public `IdentityCredentialClient.registerCredentials` documentation explicitly states that **operations not permitted** can return `RESULT_API_NOT_CONNECTED`; this is a *documented possible class of cause*, not proof of an app-specific allowlist rule. Source: https://developers.google.com/android/reference/com/google/android/gms/identitycredentials/IdentityCredentialClient

**Falsified candidate:** A published, independently reproduced GMS Identity Credentials error-17 report recommended `androidx.credentials:credentials-play-services-auth` and `androidx.work:work-runtime` to fix its own failure (https://stackoverflow.com/questions/78966079/how-to-use-the-google-identity-credentials-library/78992995). This controlled experiment added both dependencies; DISHA Android 36 CI **still returned registration error 17**. Android 35 still lacked sufficient GMS version. Android APK compiled successfully and the signed Android-to-server handshake continued to pass on both images. Jobs: 136777018001 (API 36), 136777018029 (API 35), commit `b06302e`. Dependencies reverted because they did not solve DISHA's isolated registry path.

**Proven:** app builds; AndroidKeystore P-256 signed server nonce is valid; API-36 service registration is rejected with 17. **Not proven:** precise private GMSCore reason, enrollment requirement, Chrome callback, payment debit evidence.

**Next discriminating test:** Run Google's official reference wallet sample alongside DISHA on the *same* Android 36 Google Play image and signing/install environment, capture both `registerCredentials` results and GMS service/permission logs. If both fail with 17, investigate that GMS image/account/backend feature availability; if the reference succeeds while DISHA fails, use a differential manifest, registry payload, signing identity, SDK/runtime comparison. Do not mask 17 or mark E2E pass on synthetic or unverified evidence.

Reference implementation: https://android.googlesource.com/platform/frameworks/support/+/main/credentials/registry/registry-provider-play-services/src/main/java/androidx/credentials/registry/provider/playservices/RegistryManagerProviderPlayServicesImpl.kt

The next test should compare *known supported* wallets/providers, rather than assume Google Cloud credentials, user login, or a special secret grants access. Never bypass platform security.

## API 37 Pixel emulator: distinguish OS handoff failures

After installing the debug fixture and successfully registering the synthetic credential, open the **corrected branch-preview** browser test page in emulator Chrome. Do not substitute the deployed page if its request payload differs. Before tapping the no-payment request, clear the fixture's Logcat buffer or record a timestamp, then observe:

```bash
adb logcat -c
adb logcat -s DISHA_CREDENTIAL_FIXTURE:I
```

- No `HOLDER_ACTIVITY_CREATED`: no holder activity launch observed. Investigate the browser OpenID4VP payload, matching registered SD-JWT type, Google Play services provider selection and Chrome-origin prerequisites.
- `HOLDER_ACTIVITY_CREATED` followed by `GET_CREDENTIAL_CALLBACK_REJECTED`: Android started the activity but the provider request could not be parsed or validated; inspect only the exception class, without dumping credential data.
- `GET_CREDENTIAL_CALLBACK_PARSED` and `Android handoff received`: the OS-to-holder callback was observed. The fixture still deliberately returns a no-payment exception, never a bank receipt.

A successful registration or consent prompt alone is **not** a passing Chrome-to-holder E2E test. The repository's `emulator-handshake.sh` retains a failing assertion until the parsed callback appears. Keep any Logcat exports free of credentials, origins, browser request data and device identifiers before sharing.
