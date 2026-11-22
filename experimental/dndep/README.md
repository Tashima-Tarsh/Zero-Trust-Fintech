# D-NDEP: Native Debit Evidence Protocol — research v0

STATUS: Experimental server wire-protocol implementation; NOT an OS collector, NOT an existing Chrome API, NOT deployed, and NOT bank-confirmed debit.

## Original invention

Invent an OS-owned transaction evidence sensor, a Chromium-to-OS consent tunnel, and an origin-bound minimal observation assertion. Payer installs no DISHA APK; achieving this requires Android and Chromium platform distribution of the proposed capability.

## New browser API (proposed, does not presently exist)

Navigator.requestDebitObservation({challengeJws, amountPaise, payeeVpa, windowMs:180000})

Only secure top-level documents with fresh user gesture and OS-mediated permission/biometric consent may use the API. No website can read raw SMS, unrelated notifications, or browser-private data.

## New OS subsystem (proposed)

An AOSP component, DebitObservationService, is called via browser-process authenticated Binder IPC. The service must:
1. Verify browser caller identity and authenticated origin; deny other Binder callers.
2. Verify independently server-signed order/nonce/amount/payee challenge and exact 180-second expiry.
3. Obtain system user consent plus fresh device authentication BEFORE collecting any relevant event.
4. Observe only time-bound transaction-scoped debit-related SMS/notification events with OS-authorized delivery metadata, never generalized browser SMS permission.
5. Resolve the true posting UID, package signing certificate or SMS delivery metadata from OS data, not untrusted message strings. Spoofable SMS sender labels are never treated as cryptographic provenance.
6. Match event direction, amount, exact VPA and reference only when those facts are genuinely present; otherwise return INSUFFICIENT_EVIDENCE without filling in missing fields.
7. Generate an OS-protected signature tied to independently provisioned trust roots and documented attestation state. Never accept a self-enrolled public key as OS certification.
8. Cancel on revocation, expiry, browser lifecycle end or device lock. Export no raw unrelated content.

## Proposed flow

DISHA server -> Chrome: signed 180-second challenge.
Chrome -> Android OS: authenticated origin + challenge + fresh user gesture.
Android OS -> User: consent sheet + device authentication.
Android OS: observe genuine matching debit-related event.
Android OS -> Chrome: minimal signed D-NDEP assertion.
Chrome -> DISHA server: signed assertion + original signed challenge.
DISHA server: independently verify source provenance, signatures, consent ordering, exact binding and atomic DB replay guards.
DISHA server -> Chrome: DEBIT_EVIDENCE_OBSERVED receipt only; financial ledger untouched.

## Executable research implementation

experimental/dndep/protocol.js implements strict canonical server challenges and signed assertions. It depends on an INDEPENDENT trusted observer resolver and independent source-provenance verifier; neither is falsely implemented as a local software key. A production integration must implement the trust resolver using platform attestation material and an atomic PostgreSQL UNIQUE transaction for reference/event replay. The injected replay store used in tests is synthetic and not production ready.

## Threat model and remaining engineering

- Challenge substitution, cross-origin spoofing, malformed envelopes.
- Forged notifications, compromised packages, malicious SMS sender ID, source-cert substitution.
- Post-consent event timing, future observations, time rollback, revocation race, session expiry.
- Duplicate RRN, replay across orders/devices and concurrent server claim races.
- Consent-UI spoofing, Binder caller impersonation and stolen observer software key.
- Verify device attestation trust chain, platform build state and distribution policy independently.

## Acceptance gates

P0: server wire-protocol adversarial tests — code committed, GitHub CI must prove PASS.
P1: native AOSP collector including real consent and source-verified event — NOT IMPLEMENTED.
P2: Chromium Blink/browser/Android IPC integration, real native callback — NOT IMPLEMENTED.
P3: user-authorized genuine debit SMS or notification acquired — NOT VERIFIED.
P4: zero-install distribution on ordinary stock Android/Chrome — NOT DEPLOYED.
P5: trusted DISHA backend receipt integrated, persistent replay and exact ledger isolation — NOT IMPLEMENTED FOR D-NDEP.

No synthetic event may be described as bank-confirmed debit, and no green unit test proves Android capture, Chrome dispatch or production zero-install.
