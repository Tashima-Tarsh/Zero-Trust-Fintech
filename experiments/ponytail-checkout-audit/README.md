# DISHA 8.2 Ponytail checkout audit — PR #1 through #141

**Scope:** GitHub pull-request inventory (117 visible PR entries spanning #1 to #141), detailed sample of checkout-affecting PRs, current `main` frontend/backend routing, consolidated CI, and payment evidence integration. This is a **source-history and release-path audit**, not a claim that every changed line in 117 PRs was manually reviewed, or that live Android/Google Pay payment was exercised.

Ponytail rule: **correct the smallest broken connection between already-existing components; don't build another checkout or another signed verifier**.

## Historical layers reviewed

| PR window | Resulting checkout architecture |
|---|---|
| #1–35 | Client signing/security, Railway/Clerk checkout and production routing; #24 previously fixed a separate stale `/checkout` static interception |
| #36–70 | One-Touch Vault, merchant and P2P handoff, QR, native Android, checkout-origin rules; #67 separated personal P2P from merchant P2M |
| #71–87 | Premium frontend mirrors and Ponytail deletions; #78 removed retired browser controllers; #83 rewired customer P2P chooser to ProofBridge `proofbridge=1` |
| #88–124 | Debit evidence, consent, Android handshake/observer prototypes and experiment gating |
| #125–131 | #125 was closed unmerged; #126 removed install-dependent Android observer/broker paths; #128 and #129 added opt-in PaymentRequest and signed response verification; #131 introduced server-enforced payer/device authentication |
| #132–141 | Signed SMS research, PSP research, Android lab, signature hardening, timed Google Pay return, durable seller outbox and #140 one-click PaymentRequest wiring; #141 brought Android fixture onto main |

## Verified findings against current main

### P1 — Normal P2P payer journey never activated the new signed return

`public/try-checkout.js` emits `/p2p?orderId=...&token=...&proofbridge=1`; it did **not** add `timedprovider=1`. `public/cosmic-checkout.js` attaches the signed PaymentRequest flow only when the URL explicitly contains that flag, and `public/p2p-paymentrequest-probe.js` repeats the opt-in gate. Individual PR #83 and #140 tests passed, but the real chooser-to-checkout handoff was not exercised together.

**Minimal patch:** Add `timedprovider=1` to the existing authorized P2P navigation. No client-supplied payee, extra app, new checkout page, or payment-status promotion. Existing `proofbridge=1` is retained for fallback compatibility.

### P1 — Two independent static/runtime checkout code sources

`public/_worker.js` serves `/api/runtime/checkout` and several `/api/runtime-assets/*` from Cloudflare Pages static assets. `server.js` implements the same paths, serving current files from Railway with `no-store`. Cloudflare's allowlist included `cosmic-checkout.js` but **not** `p2p-paymentrequest-probe.js`, which caused the same checkout to potentially load JavaScript from **two independently deployed versions**.

`tests/test-frontend-parity.js` verifies checked-in source mirrors, **not** the assets actually served by Cloudflare Pages and Railway. The earlier `tests/test-checkout-edge-gateway.js` explicitly asserted Pages must serve the runtime checkout when Railway is unavailable; that encoded the opposite of a strict latest-production-code guarantee.

**Minimal patch:** The standard P2P chooser now opens `/api/runtime/checkout`. The Cloudflare worker delegates canonical runtime checkout and `/api/runtime-assets/*` to Railway. Legacy `/checkout`, `/p2p`, `/pay` remain Pages static fallback URLs. Existing merchant static `/api/runtime/merchant-checkout` behavior is preserved.

### P1 — Merged source/CI cannot alone establish deployment freshness

PR #140 and #141 passing CI proves their source-level assertions ran; it does not tell us which Cloudflare Pages deployment a buyer loaded. The worker's `x-disha-edge` header helps identify static Pages routing but does not compare it with the repository.

**Minimal patch:** `scripts/audit-checkout-deployment.cjs` performs read-only byte/hash comparisons of live `/api/runtime/checkout`, served scripts, styles, static chooser and legacy checkout against the checked-out source. It reports `MATCH`, `STALE_CONTENT` or `UNREACHABLE`. No real payment is attempted. Local fake-response tests cover all three outcomes.

### P2 — Payer UI still contains legacy labels

`public/checkout.html` still has `Quantum Fusion`, QR markup, `I Paid — Check Debit Evidence`, and a hidden section labeled `P2P Android payment response experiment`. PR #140 changes the button to `Pay with Google Pay` at runtime in timed mode; it did **not** replace the whole visible checkout shell. Those older controls and labels explain why a user's actual page differs from a simplified example mockup. A separate UX consolidation should only remove old elements after confirming their fallback functions are no longer required.

### Operational gates

- The verified signed provider return only exists when Chrome recognizes an eligible instrument and the server has authenticated signing keys. No live Google Pay transaction has been run in this audit.
- `GOOGLE_PAY_REPORTED_SUCCESS` / `PROVIDER_REPORTED_SUCCESS` is not an independently verified payer bank debit.
- `DISHA_SELLER_EVIDENCE_PILOT` gates the existing seller outbox worker; normal orders do not automatically have configured seller webhook destinations.
- No production/browser dashboard was changed from this audit branch. Live DISHA URL could not be independently fetched from the current tool environment; run the read-only deployment freshness script from an environment with production DNS/network access.

## Reproduce / verify

```bash
npm ci
npm run lint
npm run build
npm test
node scripts/audit-checkout-deployment.cjs https://disha8-2.thenitishkr.in
```

Expected after both Railway and Cloudflare deploy latest commit: zero `STALE_CONTENT` and zero `UNREACHABLE`. If the chooser remains stale, its `/try-checkout.js` SHA will identify Pages deployment drift; if checkout JavaScript remains stale, the `/api/runtime-assets/cosmic-checkout.js` SHA identifies Railway runtime drift.

**Stop condition for release:** signed provider verification and existing payment-state invariants remain green; no checkout claims bank debit merely because the provider returned success. Leave deployment/production secrets untouched until the source PR is reviewed.
