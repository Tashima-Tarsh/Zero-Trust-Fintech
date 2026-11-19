# DISHA Quantum Signal — one Proceed, server-device handshake

This review-only feature prepares an immutable P2P/P2M server order twin
before an ordinary non-rooted Android customer taps **Proceed to UPI**.

## Opt-in routes
- Personal: `/p2p?amount=1&qs=1`
- Merchant: `/p2m/checkout?paymentRef=...&token=...&qs=1`

## How it operates
1. The checkout establishes its authorized session from the server-issued order.
2. The backend freezes payment kind, receiving VPA, amount in paise, TR and expiry.
3. The browser calls `POST /api/quantum-signal/start` in session-bound mode.
   It does not invoke a passkey prompt or request notification access.
4. The server generates a 30-second unpredictable challenge with a hashed
   PostgreSQL record (`POST /api/quantum-signal/challenge`).
5. The browser acknowledges that challenge with the original order bearer +
   CSRF (`POST /api/quantum-signal/ack`). Until acknowledged, event ingest
   rejects attempts with `TRUST_ACK_REQUIRED`.
6. A real user-tapped HTML link opens the server-issued UPI Intent. Both P2P
   and P2M keep their separate original payment details.
7. On browser lifecycle and UPI return, DISHA sends idempotent events and
   any permitted visible transaction fields. Conflict and UTR replay
   classification remain separate from ledger authority.

The challenge establishes **two-way session channel continuity**; it is not
proof of root status, device attestation or money received. The optional
WebAuthn-authorized Vault client remains available separately for future
higher-assurance workflows. No customer notification reader, APK, SMS,
Accessibility Service, or other hardware is involved.

## Test gates
- DISHA CI and real disposable PostgreSQL financial invariant tests.
- Native Android Google Pay and PhonePe P2P / P2M handoff and return captures.
- Strict matching of pa, am, mc and tr; no P2P/P2M fallback substitution.
- Rejected forged, cross-order and expired handshakes.
- No duplicate UTR, reused event ID or false receipt.
- 100,000 simultaneously active checkout sessions: **not yet load-tested**.

## n8n timing
**Only after all release tests pass**, evaluate n8n for noncritical
operational automation such as nightly summaries, incident/exception
triage, scheduled CI reporting and housekeeping. Never put n8n in
the synchronous customer Intent dispatch or the ledger posting path.
For high concurrency use stateless Node.js servers, durable broker
workers and PostgreSQL transactions; prove throughput with realistic
load tests before choosing deployment sizing.

PR #68 remains draft and `qs=1` remains opt-in until those gates pass.
