# DISHA 8.2 — evidence-first UPI Android development

Use **Ponytail** (`DietrichGebert/ponytail`) together with Google's **Android Skills** (`android/skills`), in this order when diagnosing a UPI checkout problem:

1. **Android debugging:** Reproduce on the actual phone; capture a time-bounded Logcat, activity stack, user-visible error, and the exact P2P/P2M URI parameters (redact private account identifiers). Mark each conclusion **observed**, **inferred**, or **unknown**. Three failed guesses mean re-examine the model, not add another workaround.
2. **Google android-intent-security:** Trace Chrome `intent://` versus raw `upi://pay` handling; exported Android test receiver components; Android activity lifecycle, package routing, and relevant intent sanitization. Do not claim an Android security skill can change Google Pay's bank/app acceptance rules.
3. **Google testing-setup:** Reuse current fixture receiver, Android 35/37 CI, and real-device ADB instrumentation rather than importing a second test framework. Simulators never move money.
4. **Ponytail review:** Read all callers/tests and find the smallest complete root-cause change. Never delete payment validation, ledger protections, accessibility, or error handling. Test changes in both P2P and P2M.

Relevant source entry points: `utils/upi-intent.js` (URI construction); `public/cosmic-checkout-model.js` (Chrome/WebView link formation); `public/cosmic-checkout.js` (checkout taps and return); `tests/android/upi-receiver/` (test-only Android receiver).

**Evidence 2026-11-19:** P2P real-device Logcat launched **Slice** (`indwin.c3.shareapp`) from generic Android intent; app then emitted `mpin_verify_screen_error` and `api_failure`. This proves an ambiguous app-choice path, not a malformed UPI URI or an internal Google Pay rejection. Google Pay P2M failure requires its own physical-device log and bank-issued merchant QR comparison; do not infer P2M root cause from P2P logs.

**Preserve invariants:** Payee `pa`, amount `am`, currency, merchant's bank-issued `mc`, and unique `tr` must never change merely because an app is selected. Keep scannable QR unmodified. A pre-PIN return, `RESULT_OK`, or app-side success cannot post a financial credit.

**Release checklist:** `npm run lint`, `npm test`, Android 35/37 test receiver, parity of `public/`, `dist/`, `disha-cinematic/public/`, `disha-cinematic/dist/`, and real-device Chrome app-choice retest. Never merge and deploy an unverified payment behavior change automatically.

Repo-scoped skill setup: run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-upi-agent-skills.ps1` in Windows PowerShell. This installs pinned upstream prompt skills only; it never changes production payment logic or executes downloaded scripts.
