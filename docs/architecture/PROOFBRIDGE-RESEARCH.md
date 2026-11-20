# DISHA ProofBridge — Zero-install web payment evidence experiment

**Branch:** experiment/zero-install-proofbridge  
**Status:** Research implementation, NOT production-ready. No live UTR extraction or Android root attestation claimed.

## Goal

A payer and a seller use existing browsers; neither installs DISHA, a PWA, a plugin, an APK, a notification listener, or a background service. The payer uses an **already installed** UPI payment application to authorize payment as usual. The DISHA site establishes one-time checkout consent and accepts an optional issuer-signed transaction claim. If a genuine transaction proof channel later becomes available, the same protocol can bind its UTR to the original checkout.

## What is implemented

- Opt-in checkout mode: append \`&proofbridge=1\` to an existing DISHA P2P checkout URL (or \`?proofbridge=1\` if it is the first parameter).
- QR is hidden and payment app links are disabled **in this research mode** until the user checks the one-time consent box and touches Proceed.
- \`POST /api/proofbridge/authorize\` validates the session token and CSRF header, checks order status/expiry and the canonical server UPI URI, binds payee/amount to a random nonce, records consent in PostgreSQL, then returns a HMAC-signed **ticket** plus server URI.
- Frontend requires the server-issued URI to equal the checkout URI byte-for-byte before it shows a QR; mismatches remain blocked.
- \`POST /api/proofbridge/capsule\` accepts a strict Ed25519-signed experimental evidence capsule from a specifically configured issuer public key. Checks exact order/nonce/ticket hash/amount/payee/window and rejects reused (issuer, UTR) across orders. Capsule contains no UPI PIN, SMS, screenshot or entire transaction history.
- \`GET /api/proofbridge/status/:orderId?token=...\` provides an issuer-signed **UTR claim** to the original checkout. It is labeled **not bank verified**.
- Existing ledger remains authoritative; this experiment does **not** update financial sessions, transactions, UTR bindings, settlements or receipts to SUCCESS. The verified receipt stage remains guarded by the existing ledger API.
- All experimental routes are behind \`DISHA_PROOFBRIDGE_EXPERIMENT=1\` and an independent 32+ character ticket secret; no branch feature runs on main.

## Configuration (non-production sandbox only)

\`\`\`bash
DISHA_PROOFBRIDGE_EXPERIMENT=1
PROOFBRIDGE_TICKET_SECRET=<random-64-character-secret>
PROOFBRIDGE_ISSUER_ID=experimental-test-issuer
PROOFBRIDGE_ISSUER_PUBLIC_KEY_BASE64=<base64-of-Ed25519-SPKI-DER-public-key>
\`\`\`

PostgreSQL is required. Schema is additive and created only when the experiment is enabled. Do not put issuer private keys in the repository, browser, checkout URL, screenshots or app bundle.

**No secrets are included in this branch.** If an issuer is not configured, authorization can work but capsule submission returns 503.

## Capsule data contract

The issuer signs the exact UTF-8 JSON bytes produced by \`canonicalCapsule(capsule)\` (field order fixed by implementation):

\`\`\`json
{
  "protocol": "DISHA-PROOF-CAPSULE-V1",
  "issuerId": "experimental-test-issuer",
  "orderId": "ORD_PROOFBRIDGE_1234",
  "nonce": "<40 hex digits from ticket>",
  "utr": "123456789012",
  "amountPaise": "50000",
  "payeeVpa": "receiver@oksbi",
  "outcome": "SUCCESS_CLAIM",
  "paidAt": 1795150000000,
  "ticketHash": "<sha256 of ticket JSON plus signature>"
}
\`\`\`

The 12-digit UTR above is **synthetic fixture data**. It does **not** represent a real payment. Submit \`{"capsule":{...},"signature":"<Ed25519-signature-base64url>"}\` to \`/api/proofbridge/capsule\` from an isolated test issuer. Payload must match a currently authorized order. Never call this from an untrusted payer browser with a private issuer key.

## Zero-install customer flow

1. Payer opens checkout in browser with experimental mode.
2. DISHA validates the order and displays amount; payment QR is *locked*.
3. Payer checks one-time consent and touches Proceed.
4. Server creates bound proof ticket and authorizes the unchanged payment URI.
5. QR becomes visible; payer makes payment using existing UPI app (P2P is scan/import QR, not prohibited one-tap intent).
6. A **participating issuer** can deliver a signed evidence claim; the checkout displays the candidate UTR as unverified while awaiting separate financial confirmation.
7. The normal verified receipt displays only when the existing ledger independently reports SUCCESS with a genuine UTR.

Seller has no client installation or upload obligations. Browser telemetry does not certify the payment.

## Device integrity / threat model

- Tampered payee, amount, duplicate URI fields, P2P/P2M misclassification, expired order and replayed proof are rejected server-side.
- The browser **cannot** directly verify Android root status, read private app storage, read the Android Keystore's protected material or obtain genuine UTRs from arbitrary UPI apps.
- HMAC ticket authenticates DISHA's server-side order parameters; the Ed25519 issuer signature authenticates the *issuer of a claim*, **not** the actual bank credit.
- An attacker controlling the browser, Android or displayed checkout can bypass a webpage's display restrictions or make a separate UPI transfer. This implementation does not offer an absolute block against hacked or rooted Android. If verified hardware/device integrity becomes a hard requirement, block all devices lacking verifiable attestation; ordinary no-install web checkouts cannot currently satisfy that.
- Prevent double-spends and ledger poisoning: claims never reserve a UTR in the financial ledger and never post a credit.
- Ticket/session consent expiry is independent of financial settlement. The experimental consent expires within 3 minutes or the original order expiry, whichever comes first.
- No authenticated payment-aware issuer or Android OS broker exists in this branch. UTR extraction from a genuine payment remains **unsolved**.

## Next experimental milestones

1. Build an isolated Android emulator **test issuer** delivering a signed capsule from a simulated UPI receiver; assert client/receipt transitions with no real funds.
2. Test Android 35/37, CI lint, all Node tests, PostgreSQL invariants, and generated frontend parity.
3. Prototype an AOSP/system-managed broker or wallet API in a controlled emulator image, never a hidden downloadable client.
4. Demonstrate a live payment-aware issuer returning a real UTR before asserting automatic live-payment receipts.
5. Add independently verifiable device attestation if a supported platform integration becomes available.

**Never merge or deploy the experimental branch automatically.** A real-device P2P UTR test, threat-model review and issuer evidence are required for a production go/no-go decision.
