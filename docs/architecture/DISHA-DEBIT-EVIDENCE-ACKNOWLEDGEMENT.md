# DISHA signed debit evidence acknowledgement (research-only)

This feature extends the existing `financial/debit-credential.js` provider claim route.
It **does not** claim bank settlement, debit, or NPCI confirmation. A wallet's own
signature proves only that the configured issuer signed a claim, unless an independent
bank-confirmed source establishes that issuer's authority over the transaction.

## Existing evidence ingress
1. An active P2P checkout requests `POST /api/debit-credential/challenge`, which
   binds random challenge + paise amount + payee VPA to its session and expiry.
2. A participating, allowlisted claim issuer signs `DISHA-DEBIT-CREDENTIAL-V1`
   with Ed25519. The server validates the exact signature, challenge, amount,
   payee, expiry and UTR replay.
3. The claim is stored as **unverified debit evidence** without changing checkout,
   bank, transaction or ledger status. The feature gate
   `DISHA_DEBIT_CREDENTIAL_EXPERIMENT=1` controls claim ingestion.

## New acknowledgement endpoint
`GET /api/debit-credential/evidence-receipt/:serviceRequestId?token=<session-token>`

- Requires the exact checkout session token and P2P session; never exposes another user's receipt.
- Requires a previously stored, issuer-signed claim.
- Requires `DISHA_EVIDENCE_RECEIPT_PRIVATE_KEY_BASE64`: DER PKCS#8 Ed25519 private
  key encoded as base64, provided only through protected runtime environment.
- Response contains `evidenceReceipt.acknowledgement` and
  `evidenceReceipt.signature` (base64url Ed25519), along with
  `signatureAlgorithm: "Ed25519"`.
- Signed fields include checkout serviceRequestId, issuer ID, UTR **candidate**,
  original issuer-claim SHA-256, time received, and explicit
  `paymentVerified:false`, `debitVerified:false`.
- A missing signing key returns HTTP 503 rather than producing an unsigned receipt.
- External verifiers use the corresponding DISHA public key and deterministic field
  ordering in `financial/debit-evidence-receipt.js`. Never expose the private key.

## Security limits
This is a **tamper-evident receipt of observed evidence**, NOT a debit-confirmed
receipt. An Android biometric/PIN, notification, SMS, UTR, browser return
parameter, or DISHA server signature cannot independently authenticate a bank debit.
Bank-confirmed settlement remains a separate trust-gated step. No provider key
or source data is installed by this PR; no live UPI app cooperation is claimed.

## Rollout gates
- Run `node tests/test-debit-evidence-receipt.js`, default test suite, CI.
- Set keys through Railway/secret management, never GitHub tracked files.
- Enable claim ingestion only after verifying the issuer's authority.
- Never change paymentVerified/debitVerified based on the evidence acknowledgement.
