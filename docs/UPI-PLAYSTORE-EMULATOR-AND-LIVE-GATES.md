# DISHA 8.2: three separate validation gates (19 November 2026)

## 1. Live SaaS + Clerk (production identity)
The owner's browser currently displays *Super Admin access denied* because
the signed-in Clerk primary email is different from the designated owner email.
The Railway API returns HTTP 403 on protected `/api/platform/owner/me` and
`/api/auth/me`. A 403 is not a missing data fetch or a reason to bypass
tenant approval. For live verification, sign out and sign in to the designated
owner account whose primary email is *verified* in Clerk, then check
`/api/platform/owner/me` and `/api/auth/me` via the authenticated browser
Network panel, followed by merchant `/api/merchant/dashboard`, `/api/merchant/vpas`
and `/api/merchant/payments` on an authorized test merchant session.
**Do not share Bearer or CSRF tokens.**

An unapproved merchant must still receive a 403 with an approval code. The
GitHub CI PostgreSQL suite tests tenant isolation and dashboard contracts
with disposable local test identities, not the live signed-in owner.

## 2. Android Play Store emulator (installation/intent inspection only)
The GitHub Android CI runs a DISHA test-only receiver on an Android Google APIs
AVD. The official India Google Pay app **is not installed** by this fixture.
The real app must be obtained from Google's Play Store, not an unofficial APK.

To create a Play Store AVD on Windows, install Android Studio with SDK,
Platform Tools and Command-line Tools, then run from repository root:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\Test-UPI-PlayStore-Emulator.ps1
```

The script installs Android 35 Play Store system image and boots an AVD when
needed. Once the Play Store app opens, **the human user** signs in and chooses
Google Pay India / PhonePe from the official store. The script does not take
credentials or perform banking operations. Repeat after manual installation:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\Test-UPI-PlayStore-Emulator.ps1 -InspectOnly
```

It records the app-package presence in
`test-results/android/playstore-upi-apps.json` as *installation-only* evidence.
The Android CI separately records `installed-apps.json` to distinguish the
test fixture from Google Pay and PhonePe.

Google Pay UPI bank onboarding requires a real SIM/mobile-number verification
and a compliant device; financial UPI activity on Android emulators is
restricted. Do not try to defeat device integrity/SIM-binding checks.
A successful APK installation or app launch does not prove payment acceptance.

## 3. Actual Google Pay and PhonePe pre-PIN payment acceptance
This requires a real, compliant phone with a bank-linked GPay/PhonePe account.
Test the same already-configured receiving VPA and exact amount with:
  1. App-targeted Android intent from DISHA checkout.
  2. Generic `upi://pay` from the same authorized checkout.
  3. QR scanning using the bank-linked app.
  4. Manual payee lookup inside the payment app as a diagnostic baseline.

Compare whether the app opened, whether the payee and amount matched, whether
the rejection occurred before PIN, and whether a genuine bank record arrived.
Collect only DISHA's opt-in event codes and aggregate results. **Do not record
UPI PIN, OTP, bank account numbers, transaction authentication or order bearer
tokens.** Do not repeatedly trigger blocked banking flows.

The independent release gates are:
- SaaS: verified Clerk primary email and live authenticated merchant API reads
- Emulator: real OS/browser -> test UPI receiver journey (not bank payment)
- Physical device: real GPay and PhonePe P2P/P2M payee acceptance and qualified
  credit reconciliation, tested under permitted banking procedures

Do not label the system production-ready until each required gate passes.
