# DISHA 8.2 — Asset and frontend consolidation (Ponytail)
- The official DISHA wordmark is unchanged.
- The supplied Mars touchdown image is locally served as `assets/disha-login-mars.webp` for merchant sign-in.
- The supplied spacecraft image is locally served as `assets/disha-checkout-space.webp` behind the native UPI checkout.
- The supplied Nile-at-night image is locally served as `assets/disha-earth-night.webp` for landing and merchant operations.
- Images are separately optimized WebP derivatives of the user-provided exact sources; originals remain with the user.
- Removed an external image element that rendered as a broken graphic in the merchant workspace. Eliminated redundant competing foreground celestial elements.
- Preserved existing Node, PostgreSQL, Vault, Quantum Signal and Clerk contracts. Public receiving UPI IDs are still allowlisted for P2P and P2M requires the authenticated merchant workflow.
- All canonical assets and generated deployment mirrors are kept synchronized in the branch. Tests ensure no regressed copy.
- No database resets or transaction state writes. No live payment result is implied by frontend CI.

## Product entry acceptance

- `/choose-payment` presents mode, amount and receiving UPI ID before issuing a P2P or P2M session.
- `/api/session/new` only accepts configured P2P receiving accounts, preserving the server authorization boundary.
- P2M prefill survives the Clerk sign-in redirect in same-tab sessionStorage and is applied only to an already active merchant VPA; the existing authenticated create API remains authoritative.
- Public homepage P2P/P2M controls now select the form instead of immediately issuing a hardcoded ₹1 checkout.
- Dashboard calls-to-action are consolidated and access-denial messages do not reveal an owner's hardcoded email.

## Gate and known limitations

Root lint/Node test was successful on the branch after the frontend change, but PostgreSQL financial-invariants and Android emulator workflows were not triggered by this frontend-only PR. Physical GPay and PhonePe pre-PIN acceptance and authenticatable payer debit evidence still need UAT. Do not merge the UI branch into the financial release automatically based on static frontend success.
