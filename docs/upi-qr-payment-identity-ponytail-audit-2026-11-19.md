# DISHA 8.2 — UPI intent, QR, and payment-reference review (19 November 2026)

## Scope and approach
Applied the [Ponytail audit method](https://github.com/dietrichgebert/ponytail/blob/main/skills/ponytail-audit/SKILL.md): trace merchant configuration → session creation → UPI URI → QR/intent dispatch → second-phone ledger polling → reconciliation. Reviewed active implementation and relevant tests/config in `merchant-api.js`, `server.js`, `utils/upi-intent.js`, `npci-intent.js`, `financial/postgres-store.js`, `financial/reconciliation-webhook.js`, `financial/vault-evidence.js`, `public/cosmic-checkout*.js`, `public/checkout.html`, `public/merchant-checkout.html`, `public/premium-dashboard.js`, Android emulator fixture, and corresponding tests. Assumed many concurrent merchant payment sessions; do not assume a test-only fake UPI receiver represents actual Google Pay or PhonePe.

## Must fix / verified issues
1. **P2M reference mismatch** — Prior to this patch, `merchant-api.js` put a normalized record ID into the merchant UPI `tr` field, while saving an unrelated `txn_ref` in `sessions`. The payment app and stored evidence could reference different transactions. New merchant payments now use one cryptographically generated `PAY...` reference for both the exact bank-facing `tr` and the stored `txn_ref`. Previously created payment links retain their original `tr` for compatibility.
2. **False payer identity** — `public/cosmic-checkout.js` sent a browser-generated `userId` and fabricated `userName=Device user` while creating a QR-first session. These fields were not an authenticated bank-linked payer identity and are removed.
3. **Visible database record terminology** — New checkouts use `paymentRef` in customer checkout links, display the real recipient UPI ID alongside the amount, and show neutral payment reference terminology; new references are prefixed `PAY`, not a legacy record label. Older checkout URLs continue resolving.
4. **Bank-app pre-PIN rejection not covered by the fake UPI receiver** — The emulator asserts `upi://pay` dispatch, field preservation, and app cancellation only. It cannot establish VPA registration, acquiring-bank acceptance, merchant activation, or the exact error a live PSP displayed.
5. **Possible P2P/P2M classification mismatch** — `financial/postgres-store.js:getVpaMerchantType()` defaults an unlisted payee to `PERSONAL`. If an actual merchant VPA was never registered in `vpa_pool`, the generic checkout may omit merchant `mc/tr` fields and be rejected before PIN. The receiving account must be compared with the bank-issued QR, and the active configuration must be verified; no invented MCC or bank merchant ID is safe.

## Important compatibility and constraints
- The internal PostgreSQL `order_id` columns and existing `orderId` callback keys remain **legacy storage/API contracts**, not new customer-facing terminology. Renaming every reference would require a versioned migration across sessions, journals, reconciliation inbox, vault evidence, webhook consumers, integrations, and existing records. Do not drop the column or invalidate active payments in a cosmetic rename.
- For real P2M UPI, `tr` is a transaction reference, not an English-language record label. The bank/acquirer provides the actual merchant VPA and MCC; do not remove required fields or invent a payer UPI ID.
- Keep the QR as a genuine `upi://pay` payload. The separately shared HTTPS checkout link includes a bearer token and must not be embedded in the bank-scannable QR.
- A second-phone scan does not produce a browser callback; the original checkout must continue polling the same payment state. Only recorded credit permits a receipt.
- `npci-intent.js` contains a separate legacy URI builder and a claimed success-code registry. The active direct checkout uses `utils/upi-intent.js`; do not let the legacy response-code `MARK_AS_PAID` description authorize financial records.

## Automated harness
Run `node scripts/upi-acceptance-harness.js --kind P2M --checkout '<generated upi://pay...>' --bank '<actual bank QR upi://pay...>'`.
It checks `pa`, `pn`, `mc`, `tr`, `am`, `cu`, duplicated fields, merchant classification, and bank-issued fields when supplied. It does not prove live payment acceptance. Tests: `node tests/test-upi-acceptance-harness.js`, `node tests/test-android-fixture.js`, and Android API 35/37 E2E.

## Not inspected or not established
A full line-by-line review of every other repository subsystem (AI website assets, n8n jobs, Python alternate application, all dashboard styling) was not performed. Real Google Pay/PhonePe physical-device transactions, the customer's real banking identity, and the configured receiving account's bank-side status are not accessible through the CI emulator.

## Mobile-web and native-app platform mapping (November 2026 review)
- Razorpay's UPI Intent docs describe an intent application opened with payment details prefilled, then UPI authorization. **This flow is transport guidance, not a reason to integrate Razorpay into DISHA.**
- Android browser: keep a native user-initiated `upi://pay` anchor on the QR itself; never require a passkey, preemptive PIN, or asynchronous gateway request to launch it.
- Android WebView embedding: the host `WebViewClient.shouldOverrideUrlLoading` must intercept only valid `upi://pay` and forward it to `Intent.ACTION_VIEW`. The DISHA test host already follows this pattern and returns `false` for ordinary `https://` navigation. Razorpay's sample uses an overly broad Boolean condition; do not copy that branch.
- Desktop: display the same bank-scannable UPI QR and poll the original page's payment status. Do not attempt to force a native app on desktop.
- iOS: specific PSP app-scheme handling may be needed; a plain `upi://pay` tap is not guaranteed to be handled by every iOS browser. Android emulator success cannot establish iOS acceptance.
- The Razorpay-specific `webview_intent`, Razorpay.js, Android SDK, and Razorpay payment APIs do not belong in this zero-gateway product. The banned **UPI Collect** model (push request to payer's VPA) is not implemented and its MCC restrictions do not apply generically to UPI Intent.
- Google Pay's public UPI documentation describes `pa`, `pn`, `mc`, `tr`, `tn`, `am`, `cu` for **merchant** app payments. The issuer's real merchant VPA and classification are prerequisites; adding those fields to an unregistered personal VPA is not a substitute for merchant onboarding.
- The new QR tap diagnostic observes the browser becoming hidden and then visible. A fast return produces an **informational** message, never a failed/paid financial state. When the browser never backgrounds, the application has no reliable proof it launched.
- Sources reviewed: https://razorpay.com/docs/payments/payment-methods/upi/upi-intent , https://razorpay.com/docs/payments/payment-gateway/web-integration/custom/features/webview/upi-intent-android , https://razorpay.com/docs/payments/payment-gateway/web-integration/custom/payment-methods/upi-intent-mweb , and https://developers.google.com/pay/india/api/android/in-app-payments .
