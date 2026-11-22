# DISHA 8.2 — Vault to browser evidence handoff

Scope: zero aggregator, no bank API, no manual UTR. This is a browser-only
evidence capture path after a WebAuthn passkey ceremony and external UPI
application handoff. It is NOT a reliable way to read private state from an
unrelated UPI app, and it cannot independently prove funds were credited.

## Flow

1. User presses Touch to Pay once. New device registers a platform passkey or
   returning device authenticates once (no duplicate biometric).
2. Railway verifies WebAuthn, persists a short-lived order + checkout-token
   authorization in PostgreSQL (disha_vault_authorizations).
3. Checkout JS creates a cryptographically random event ID and saves one
   handoff record in sessionStorage, then invokes upi://pay.
4. pagehide/visibilitychange records browser backgrounding. On resume,
   pageshow, or focus, the checkout browser requests the specific order-bound
   event packet from the Vault via DISHAOneTouchVault.requestEvidence(orderId).
   The Vault returns the immutable observed event and any explicitly exposed
   UTR candidate to the browser, but does not perform a network write.
5. The checkout browser itself sends the returned Vault packet using
   POST /api/vault/evidence, with the original checkout session token in
   both JSON and X-CSRF-Token. The server verifies that the token and
   short-lived Vault authorization belong to the same order.
   Only after successful storage does the browser call
   DISHAOneTouchVault.acknowledgeEvidence(orderId,eventId,response).
   Failed requests reuse the original frozen packet and event ID for retry.
   No second passkey is asked.
6. Whitelisted browser-return fields (if exposed) are captured as *untrusted
   claims*. UTR candidates must be exactly 12 digits. A status claim of
   SUCCESS never produces a payment SUCCESS or settlement journal.
7. The stored evidence is classified: UTR_CANDIDATE_UNVERIFIED,
   RETURN_OBSERVED_NO_UTR, FAILURE_CLAIM_UNVERIFIED,
   CONFLICTING_EVIDENCE, or LATE_RETURN_OBSERVATION. Exact amount,
   payee, txnRef and UTR collision checks are recorded as observations.
8. Persisted evidence uses event-id idempotency; identical retry returns the
   same result, altered duplicate is rejected. UI shows evidence submitted and
   keeps checkout pending.

## Platform limits

- Generic web browsers cannot inspect other apps' private UTR/transaction
  screens, OS intents or bank balances.
- Some UPI apps do not return to the webpage or expose UTR fields. In that
  case the Vault still records a resumed browser session, **without inventing
  a UTR**.
- Device passkey verification proves a local credential ceremony; it does
  not cryptographically attest the external UPI app's transaction result.
- URL query parameters can be fabricated; they are never proof of payment.
- The short-lived authorization record survives browser navigation and
  Railway process restarts, but WebAuthn *challenge creation* elsewhere
  in server.js still uses process memory.
- sessionStorage is tab-scoped. Private browsing, disabled storage or a
  different tab can prevent automatic evidence delivery.
- A UTR candidate conflict is recorded for analysis, not consumed into an
  authoritative UTR binding that could deny service.
- This feature never calls any settlement method or modifies ledger balance.

## Validation

node tests/test-vault-browser-evidence.js
TEST_DATABASE_URL=postgresql://... node tests/test-postgres-vault-evidence-http.js

The PostgreSQL test **must** use a disposable localhost database; it inserts
synthetic Vault-authorization fixtures, never live financial proof. The
GitHub Action PostgreSQL financial invariants job gates this test.

## Production acceptance

Run controlled Android browser + UPI-app tests for each supported payer app:
actual backgrounding, return, force close, reload, missing parameters,
forged query, delayed return, and duplicate events. Record whether the UPI
app actually exposes a 12-digit UTR. Where it does not, the automatic
evidence packet correctly contains no UTR. Do not label those cases verified.
