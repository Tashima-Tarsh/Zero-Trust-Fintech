# DISHA Android → Chrome SMS transport experiment

This is a **zero-install Chrome experiment**, not a production bank-SMS reader. It tests whether an origin-bound WebOTP message is returned to Chrome while an otherwise similar synthetic debit SMS is not. It does **not** bypass Android permissions and does not use live bank accounts, real-money payments, or customer data.

## Run with the existing Pixel emulator

1. Start the existing Android Studio Pixel emulator. Keep the original AVD data and debugging credentials.
2. In a development checkout of the branch, install Node dependencies and run the local DISHA server on **port 3000**. Use the project's normal local development configuration; do **not** modify production environment variables or database. The static lab is at `public/labs/sms-transport.html`.
3. On Windows PowerShell in the repository root, with `adb.exe` in PATH:
   ```powershell
   .\experiments\sms-transport\run.ps1 -Mode Status
   .\experiments\sms-transport\run.ps1 -Mode Open
   ```
   For a nonstandard ADB binary, pass `-Adb "C:\path\to\platform-tools\adb.exe"`; for another emulator, pass `-Serial emulator-5556`.
4. Chrome opens `http://localhost:3000/labs/sms-transport.html` through ADB reverse. Check explicit consent and press **Start 90-second WebOTP listener**. Record the code shown.
5. **Negative control:** send a bank-like SMS while the WebOTP listener is open:
   ```powershell
   .\experiments\sms-transport\run.ps1 -Mode Debit
   ```
   Observe whether Chrome receives any WebOTP credential. A regular SMS appearing in the Android SMS app is **not** a Chrome SMS read.
6. Stop/restart the listener, note its **new** 6-digit code, then send the origin-bound message:
   ```powershell
   .\experiments\sms-transport\run.ps1 -Mode Otp -Code 123456
   ```
   Replace `123456` with the current displayed code. Accept any Android user prompt. This is the **positive control**.
7. Record exact Chrome lab states and Android version. Repeat on a physical device only with a user-controlled test SIM and explicit consent; emulator-only results cannot establish real bank SMS capability.

## Expected evidence and limitations

- `WEBOTP_MATCHED_ONLY_NOT_BANK_EVIDENCE` proves only an SMS **code** was delivered through WebOTP. It does **not** prove receipt of the full body or the sender's authenticity.
- `WEBOTP_TIMEOUT_NO_BANK_SMS_ACCESS` is a negative observation for this one channel, not proof that all possible Android→Chrome channels have been exhausted.
- `WEBOTP_CAPABILITY_NOT_DETECTED` means this browser/environment lacks the tested WebOTP capability.
- The separate `financial/sms-debit-relay.js` endpoint accepts signed candidates only from configured trusted relay sources; the zero-install Chrome lab does **not** provide such a signing source.
- A signed relay can authenticate the transport, not necessarily the bank SMS source. The financial status remains unverified unless independently authenticated bank/payment evidence exists.
- No code in this experiment uploads bank SMS, requests SMS permissions, claims rooted/debugger checks, issues receipts, or writes financial ledger state.

## Evidence collection

Capture ADB `getprop`/Chrome version, a timestamped screenshot of the browser lab, and the two SMS experiment outcomes. Do not record or commit genuine SMS messages, payer phone numbers, OTPs, private keys, or financial credentials.
