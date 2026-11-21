# DISHA Chrome/Android PaymentResponse acquisition experiment (isolated)

**Goal:** Determine with **actual on-device observations** whether a supported installed UPI payment app can return an automatic transaction identifier to a zero-DISHA-install Chrome page, and whether it can be correlated with an existing 180-second DISHA checkout without treating that return as bank-authenticated debit.

## Scope and stop conditions
- Standalone lab only: `tests/browser/paymentresponse-lab.html`; not imported into production checkout, `server.js`, worker, public assets, financial reconciliation or callbacks.
- Does not install a DISHA app, ask for a manual RRN, read bank SMS/notifications, add a PSP or register a new processor.
- It probes **Google Pay's documented merchant PaymentRequest contract**, not arbitrary UPI apps or personal-account UPI links. Official merchant onboarding, MCC and supported Google Pay app may be prerequisites. No claim that the user's P2P checkout can use it as-is.
- The probe button calls `canMakePayment()` only. The separate explicit launch button may request an **actual monetary transaction**; do not use without authorized test merchant, payer and device. It cannot be auto-triggered.
- The lab reports only sanitized classifications, never raw financial data/signatures and never posts the result to DISHA. No payment or settlement success is inferred.
- Never force a 12-digit `txnId` to be a bank RRN. In official Google Pay docs, `txnRef` is the merchant-input reference; `ApprovalRefNo` and several legacy fields are deprecated; `tezResponse` is current. `signature` presence is **not** signature verification.
- If Google Pay integration or merchant eligibility is unavailable, record `BLOCKED_BY_INTEGRATION_OR_UNSUPPORTED_METHOD`, not `RRN_NOT_POSSIBLE`.

## Device procedure
1. Use an authorized Android device with updated Chrome and an already installed Google Pay app. Ensure HTTPS secure-context hosting for the isolated `tests/browser/` files; `file://` is not a supported substitute for a real origin.
2. For **no-money discovery**, enter actual *authorized merchant test* VPA, merchant name, merchant-issued MCC, unique transaction reference, and test amount. Click `Probe browser support (no payment)`.
3. Record browser/Android version, `secureContext`, payment method availability, and whether `canMakePayment` reported support. If false, **stop** and record reason; do not silently fall back to a `upi://pay` link and pretend it provides a browser callback.
4. Only with explicit separate approval to conduct a real payment, click `Launch payment test` and approve or cancel via the provider. The test never initiates a payment without direct user interaction.
5. Record the sanitizer output locally: `TEZ_RESPONSE_OBSERVED` versus `NO_TEZ_RESPONSE`, presence and format of returned `txnId`, status, request-ref echo, amount/payee matches, and signature-presence flag. Do not record full bank responses, VPA or secrets in public issues.
6. Independent test: compare the returned reference with the **actual bank/UPI transaction receipt** supplied privately by the consenting payer; for any RRN claim require a separately observed explicitly labelled RRN matching exactly. A 12-digit ID alone is not RRN proof.
7. Repeat the control with cancel/failure/missing reference, wrong amount, mismatched payee, and a second order. Do not use a successful synthetic fixture to claim a real debit.
8. Once an actual usable source exists, propose a **separate** order/nonce/180-second integration PR through the existing `financial/session-evidence.js` observation-only path. Never alter reconciliation and ledger state in this experiment.

## Classification gates
- **CODE PASS:** parser / correlation tests run, no financial mutation.
- **PLATFORM PASS:** Chrome recognized supported payment method on a real device.
- **ACQUISITION PASS:** a real completed payment produced an automatic browser `PaymentResponse` with provider-reported transaction ID.
- **RRN PASS:** the automatically acquired value was independently matched to the actual bank-generated RRN. Not inferred from length.
- **ZERO-INSTALL GENERALITY PASS:** supported across the intended payment apps and P2P/P2M merchant classifications without introducing forbidden integrations. **Not established** merely by Google Pay merchant success.
- **DEBIT VERIFIED:** never asserted by this lab.

## Run code tests
`node tests/browser/paymentresponse-lab.test.js`

## Official references
- https://developers.google.com/pay/india/api/web/create-payment-method
- https://developers.google.com/pay/india/api/web/googlepay-response
- https://developers.google.com/pay/india/api/web/pay-ui
- https://developer.chrome.com/docs/android/payments-in-webviews

**Status as of 2026-11-21:** code classification tested; no direct Android device access / real merchant credential / consenting real payment available in this environment. PLATFORM / ACQUISITION / RRN remain **NOT TESTED**, not PASS.
