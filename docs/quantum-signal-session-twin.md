# DISHA Quantum Signal — server-side transaction twin

This implementation gives every P2P/P2M checkout its own **durable, bounded
digital twin**. It is not a cloud emulator with access to a physical Android
phone, and it does not silently request notifications, Accessibility or SMS.

## Journey

~~~mermaid
flowchart TD
  A["Checkout: P2P or P2M"] --> B["Proceed: device passkey"]
  B --> C["DISHA Vault authorization"]
  C --> D["Server Quantum Signal twin"]
  D --> E["Immutable amount, VPA, UPI Intent and nonce"]
  E --> F["Tap QR / select Android UPI app"]
  F --> G["Browser background and app return"]
  G --> H["Order-bound event transport"]
  H --> I{"Check amount, payee, ref, TTL and replay"}
  I -->|"Conflict"| J["NO: conflicting evidence"]
  I -->|"Browser return, no UTR"| K["UNKNOWN: no result exposed"]
  I -->|"UTR available"| L["UNKNOWN: candidate recorded"]
~~~

## Implementation and test URL

- Opt-in personal checkout: /p2p?amount=1&qs=1
- Opt-in merchant checkout: /p2m/checkout?paymentRef=...&token=...&qs=1
- Step 1: User selects **Proceed** to authorize DISHA Vault with an existing
  device passkey. New devices register once.
- Step 2: A PostgreSQL row is created in disha_quantum_twins, uniquely keyed
  by the actual order, authenticated Vault session and server-derived nonce.
- Step 3: A fresh tap opens the UPI QR/app Intent. A separate tap is required
  because a browser may not retain user activation after an asynchronous
  WebAuthn ceremony.
- Step 4: First-party app-handoff and background/return events are stored
  in disha_quantum_events. The existing Vault evidence module also stores
  its original idempotent browser event.
- Step 5: The backend checks whether the observed data matches the
  original server-side amount, payee, transaction reference, order time window
  and UTR reuse history.
- Step 6: The frontend displays the evidence classification; a browser
  callback never creates a paid ledger entry or artificial UTR.

## Endpoints

- POST /api/quantum-signal/start
- POST /api/quantum-signal/event
- GET /api/quantum-signal/status/:orderId?token=...

All endpoints require the order session token; writes additionally require
a matching CSRF header. The server enforces the original expiry, unique
event IDs, immutable payload hashes and cross-order candidate UTR conflicts.

## Proven versus unproven

Proven by deterministic tests: immutable P2P/P2M session snapshot,
real PostgreSQL storage and retry/replay behavior, Vault-bound authorization,
server-derived event timing, missing UTR, wrong amount and cross-order UTR.

Not proven yet: any private Android device result or payer-debit notification
from Google Pay or PhonePe. A cloud mirror cannot read the device's private
bank-app result simply because it shares an order reference. Device-root
integrity is currently UNKNOWN in a browser-only session.

This feature is opt-in (qs=1) and remains an unmerged draft while physical
Android browser/UPI acceptance and WebAuthn UX are tested. The earlier
notification-listener prototype must not be merged into this zero-settings
customer flow.
