# DTWP V2 — Dual-Mode Transaction Witness Protocol

**Status:** Experimental, zero-DISHA-install web protocol. A signed UTR claim is not financial settlement.

## Customer contract

- Both P2P and P2M: one checkbox authorizes a short-lived, single-order evidence lease; Proceed starts the authorized checkout journey. Neither payer nor payee installs DISHA.
- P2P: copy the receiving personal UPI ID, pay through an existing UPI app, return to the browser. P2P stays scan/copy only; the platform does not dispatch a restricted personal-account native intent.
- P2M: use a bank-classified merchant checkout. A merchant VPA copied into a generic send-money flow may be treated as P2P, so the genuine bank-issued merchant QR or approved merchant payment intent is required to preserve merchant classification.
- UTR receipt: browser return triggers evidence refresh, but a trusted payment-aware issuer must supply the real transaction reference. Web consent, device timing, UPI ID copying and browser-resume telemetry cannot generate a genuine UTR.

## Signed V2 wire contract

- `DISHA-PROOF-TICKET-V2`: order ID, nonce, amount in paise, payee VPA, paymentType (`P2P`/`P2M`), merchantCategory, merchantReference, UPI URI hash and expiration. HMAC authenticates the server-issued ticket.
- `DISHA-PROOF-CAPSULE-V2`: issuer ID, order, nonce, 12-digit UTR claim, amount, payee, the three payment-classification fields, time, outcome and ticket hash. Ed25519 signature authenticates the issuer's claim.
- For P2P: `merchantCategory===''`, `merchantReference===''`, and `mc`/`tr` MUST NOT be introduced into the UPI URI.
- For P2M: `merchantCategory` must match the real four-digit MCC, and `merchantReference` must match the merchant transaction reference `tr`; they cannot be missing, duplicated or substituted.
- Cross-type substitution and changed payee/amount/MCC/tr/replayed UTR fail closed. A claim never marks the session or ledger SUCCESS.

## Correlation and feasibility

Merchant `tr` may help correlate a P2M transfer. In manual P2P VPA entry, the payer usually cannot convey the DISHA order ID to the other app automatically. Amount + payee + time is not a unique cryptographic match. To supply a **genuine** UTR, a participating Android/UPI app or trusted payment-record issuer must sign a transaction-bound receipt and communicate it to DISHA. If an issuer cannot distinguish near-identical transfers, it must decline automatic binding rather than guess.

## Deployment

Experimental mode remains off unless `DISHA_PROOFBRIDGE_EXPERIMENT=1` with a 32+ character ticket secret. V2 adds nullable PostgreSQL columns to the experimental tables. V1 tickets cannot be silently upgraded: use a fresh V2 order and new consent. No real payment evidence issuer or OS-level broker is implemented in this branch. No APK, notification reader or application install is part of the payer/payee experience.

## QA release gate

Run Node tests, PostgreSQL financial invariants and Android 35/37 tests; verify P2P scan/copy, P2M merchant MCC/reference, both signed ticket formats, evidence replay rejection and no false credit. Real-device live transfer and genuine UTR auto-retrieval remain separate, unmet acceptance criteria.
