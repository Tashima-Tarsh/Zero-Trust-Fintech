# Consented Android debit-reference observation

This mode is opt-in and uses a separate local DISHA session. The user selects one installed payer package and supplies the expected amount and payee for binding. The source package, Android post time, explicitly observed fields and reference kind are signed with the existing enrolled Keystore key. Only new notifications posted during consent are inspected. The app does not read history, derive a reference or fill missing fields from the order.

The listener reads Android's title, text, expanded text and text-line extras from the chosen package. The parser accepts an explicit completed payer title, a single labelled 12-digit `UTR` or `RRN`, an explicit amount in rupees and an explicit payee VPA. It preserves leading zeros and the source label. A transaction ID or generic reference is identified by type but does not become a UTR. Multiple conflicting references or bindings return `UTR_AMBIGUOUS`. Insufficient evidence returns `UTR_NOT_AVAILABLE`. The accepted patterns are conservative and have synthetic test coverage. They have not been validated against live notifications from the listed apps.

The local router binds the signed event to the token, nonce, selected package, enrolled key, amount, payee and expiry. The backend stores the label separately and rejects repeat references. A successful response reports `DEBIT_UTR_OBSERVED` with both bank verification flags false. The existing synthetic notification fixture uses its original protocol and cannot produce the real observation response in its session. Raw notification content is neither logged nor submitted. The Credential Manager no-payment callback remains separate.

## Pixel API 37 evidence

The connected device was `emulator-5554`. Package Manager listed the DISHA fixture, CMWallet and Android Messages, and none of the four supported payer packages. No debit notification from an eligible source was available, so there were no live source fields to inspect or submit. Android Messages is outside this implementation's source scope. The user confirmed a test phone was unavailable. No money was moved.

The parser and signed HTTP regression use artificial references explicitly labelled as test vectors. They establish protocol behavior, including signed-label tampering, missing and wrong references, binding mismatches, replay and consent revocation. They do not establish that a real payer app notification contains the required fields.
