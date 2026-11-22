# DISHA payer debit PSP event mirror — research experiment

## Exact direction of the existing Google Pay callback

Google's **UPI Callback API** is an interbank partner flow:
`NPCI → authorized PSP bank → Google Pay backend`.

It is **not** a public browser-to-DISHA stream or a selectable webhook
destination that a merchant can repoint. Production schemas, endpoints and
short-lived OAuth identity credentials are restricted to onboarded regulated
PSP banks. We will not attempt to intercept this channel, impersonate either
endpoint, or obtain another institution's tokens.

Sources (first-party): 
- https://developers.google.com/pay/india/api/psp/callback/overview
- https://developers.google.com/pay/india/api/web/handle-response
- https://developers.google.com/pay/india/api/web/googlepay-response

## Invention hypothesis

An **authorized payer-bank PSP**, with a contractual data-share agreement,
could send an independent, explicitly allowed copy of its own debit-leg event
to DISHA. This is a new DISHA **partner ingestion contract**, not Google's
private PSP callback contract.

```text
     NPCI -> registered PSP bank -> Google Pay backend
                            |
                            +-- optional, separately authorized payer-debit evidence
                                -> DISHA /api/payer-partner-debit/ingest
                                -> authenticated observation only
```

DISHA's server accepts the independent event only when all gates hold:

1. `DISHA_PAYER_PSP_PARTNER_MODE=enabled` explicitly configured.
2. Partner identity `sourceId` is present in `DISHA_PAYER_PSP_ONBOARDED_SOURCES_JSON`.
3. Detached Ed25519 signature verifies against the separately provisioned
   public key in `DISHA_PAYER_PSP_TRUSTED_ED25519_KEYS_JSON`.
4. Signed event contains exact order, transaction reference, receiving VPA,
   amount in decimal-string paise and a fresh timestamp.
5. PostgreSQL stores the event id once, with no merchant credit or ledger mutation.
6. Any `REVERSED` debit leg is distinguished from a `CONFIRMED` leg.

**No real partner is onboarded.** The default environment rejects every
incoming claim. The test suite generates ephemeral Ed25519 keys to simulate
a *hypothetical* authorized partner, and does NOT represent Google Pay, NPCI,
or a financial institution.

## Local verification

Run `node --test tests/test-payer-partner-debit-bridge.js`.

For the existing system integration suite, run `npm test` using the
project's documented development environment.

Proposed paths (research only):
- POST `/api/payer-partner-debit/ingest`
- GET `/api/payer-partner-debit/status/:orderId?token=...`

The latter requires the existing checkout session token. Responses stay
`debitVerified:false` and `paymentVerified:false` until a real, independently
validated bank source and a complete reversal/dispute policy are established.

## What proves the invention?

A genuine PSP bank voluntarily sends a signed, fresh, correct payer-debit event
to DISHA on a customer-authorized transaction, and DISHA demonstrates
end-to-end authenticity, exact order binding, replay defense and reversal
handling. Unit tests do **not** prove this partner participation.

What this cannot do on its own: redirect packets addressed to the PSP,
modify NPCI routing, or access a protected Google Pay PSP callback without
the bank's participation.
