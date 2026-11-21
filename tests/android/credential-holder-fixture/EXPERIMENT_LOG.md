# PR #94 — Android Credential Discovery Evidence Log

## Observed Pixel API 37 / Chrome 145 results (2026-11-21)

- The synthetic registry registration completed on Android: `APPLICATION_SCOPED_REGISTRATION_SUCCESS` at 17:03:10.836 device local time.
- The DISHA HTTPS Chrome test page opened and the Digital Credentials API request reached Android Credential Manager.
- The selector **still displayed "No ID found"** on the application-scoped registration branch.
- No successful DISHA selection, `HOLDER_ACTIVITY_CREATED`, `GET_CREDENTIAL_CALLBACK_PARSED`, or intentional exception delivery was established in that run.
- An earlier CMWallet synthetic PID was selectable on the same emulator with *different* metadata/request. This does **not** isolate a matcher or provider bug.

## Code facts (not root-cause claims)

- DISHA uses published AndroidX registry `1.0.0-alpha05` and constructs `OpenId4VpRegistry` with its default WASM matcher.
- The Chrome DCQL requests `dc+sd-jwt` with VCT `https://disha8-2.thenitishkr.in/credentials/upi-debit-v1`, matching the registered synthetic `SdJwtEntry` VCT.
- Registration now occurs asynchronously in `DishaCredentialApplication`, while `RegisterActivity` retains a manual retry path. Both use the same registry ID and credential entry ID.
- **Moving registration into Application did not fix discovery on device.** It must not be documented as the proven root cause.

## Diagnostics added in this branch

Each automatic registration attempt now emits a `REGISTRY_DIAGNOSTICS` Logcat line with only the byte count and SHA-256 digest of the serialized registry and WASM matcher. The log contains no credential content or financial information. `APPLICATION_SCOPED_REGISTRATION_SUCCESS` is logged only after `registerCredentials` returns.

The initial activity text no longer claims registration success before the asynchronous call completes.

## Unresolved decisive question

Did the Android matcher produce zero/error for DISHA's `credentials` bytes and exact Chrome DCQL, or did Google Play Services not expose the registered candidate to the selector? Neither a successful registration call nor a hash proves matcher output or persisted eligibility.

A deterministic matcher execution against these actual bytes and the exact Chrome request, or an equivalent same-metadata/same-request holder comparison, is still needed to distinguish these cases. Do not switch matchers, modify VCT, or upgrade snapshot dependencies without a reproducible result.

## Acceptance gate before merge

1. DISHA credential visible/selectable on Pixel API 37.
2. `HOLDER_ACTIVITY_CREATED` and `GET_CREDENTIAL_CALLBACK_PARSED` observed on selection.
3. `DISHA_TEST_ONLY_NO_BANK_DEBIT_CREDENTIAL` intentional rejection delivered.
4. APK compilation and CI pass.
5. Root cause supported by reproducible experiment evidence.

No real UPI debit, payment receipt, ledger posting, or bank verification is within this fixture.
