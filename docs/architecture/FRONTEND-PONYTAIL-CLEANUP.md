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
