# DISHA 8.2 — Code Audit & ₹500 Cr Path Report

**Repo:** `https://github.com/Tashima-Tarsh/Zero-Trust-Fintech`
**Audited:** full monorepo at `D:\Downloads\Zero-Trust-Fintech`
**Goal:** (1) audit + remove extra/duplicate code without breaking design, (2) path to a ₹500 Cr firm, (3) website audit + 3D immersive "everything shown" concept, motto-led.

---

## 1. What this repo actually is

A **sovereign zero-fee UPI payment rail** for Indian merchants:

| Piece | Port | Role |
|-------|------|------|
| `server.js` (root) | 3000 | Unified Express + WebSocket server: checkout PWA (`public/`), session/challenge/NPCI/QR, 7-layer fraud verify, Android Web Share Target (`/handle-share`), gaming verify-payment, VPA routing, admin IP-whitelist APIs |
| `db.js` | — | Dual-engine store: Postgres (`pg`) + native `node:sqlite` fallback to `disha82.db`; VPA router + importer wired in |
| `disha-cinematic/server.js` | 5000 | Merchant SaaS platform: auth, dashboard, payments, VPA management, fraud console, IP whitelist; own SQLite `disha-cinematic/data/disha.db` |
| `disha-cinematic/public/index.html` | — | PhonePe-inspired marketing website (hero carousel, 7 solutions, video, savings calculator, trust, FAQ) |
| `public/index.html` | — | Customer checkout PWA: dynamic QR, UPI app launchers, WebSocket status, simulate drawer |
| `disha-ui/` | — | React TS components (BrandLogo, LoginModal, FraudControls, OneTimePricing, OurStory, FinalCta, AccessRequestModal) — **unused** |
| `zero-trust-fintech-production/` | — | Separate Python/FastAPI "production twin" (5-layer fraud, merkle ledger, n8n) referenced by `render.yaml` but **not integrated** with the Node servers |
| `sharepay-mvp/`, `forensic-upi-engine/`, `forensic-upi-intent-engine/`, `merchant-pwa/`, `halo-landing/`, `android/` | — | Duplicate/exploration sub-projects and scaffolds |

Docs exist: `README.md`, `BACKEND_ARCHITECTURE_END_TO_END.md`, `schema.sql`, `render.yaml`, `docker-compose.yml`.

---

## 2. Extra / duplicate code to remove (without breaking design)

None of these are referenced by the running Node servers; removing them does not change the UI/UX or the verified flows.

| Path | What it is | Verdict |
|------|-----------|---------|
| `disha-ui/` | Unused React component library (no build wiring, no imports anywhere) | **Retire** (or move to `attic/`) |
| `halo-landing/` | Abandoned Vite + React landing scaffold | **Retire** |
| `merchant-pwa/` | Duplicate checkout PWA server (ESM static server) — root `public/` already does this | **Retire** |
| `sharepay-mvp/` | Duplicate MVP re-implementing root server logic (`server.js`, `forensics.js`, `sharepay.db`) | **Retire** |
| `forensic-upi-engine/` + `forensic-upi-intent-engine/` | Duplicated forensic sub-projects with overlapping docs/backend/mobile-app | **Retire one / merge into docs** |
| `android/app/src/` | Placeholder Android app, no build config visible | **Retire** unless Android work is planned |
| `scratch/` | Throwaway Puppeteer capture/debug scripts | **Retire** |
| `workflows/n8n/` | n8n JSON exports — keep only if n8n orchestration is part of the product; otherwise archive | **Archive** |
| `marketing/disha82-cartoon-ad/` | Cartoon ad assets | **Keep** (marketing, not code) |

### In-repo duplication (merge, don't delete functionality)

1. **Challenge amount** — three implementations:
   - `server.js:311` `generateChallengeAmount` (cents 11–99, excl. multiples of 5 & 10, collision-checked vs active sessions)
   - `utils/upi-intent.js:120` `generateChallengeAmount` (cents 1–99, excl. multiples of 10)
   - `npci-intent.js:305` re-exports `utils/upi-intent`'s version
   → **Keep one** (`utils/upi-intent.js`) and import it everywhere; preserve the 11–99 / no-5 rule used by `server.js`.

2. **UPI URI builder** — two overlapping implementations:
   - `npci-intent.js:87` `buildNPCIIntentUri`
   - `utils/upi-intent.js:51` `buildUpiUri` (stricter, P2P vs P2M split)
   → **Keep `utils/upi-intent.js`**, drop `buildNPCIIntentUri` or make it a thin wrapper. Update `server.js:377` `generateUPILink` accordingly.

3. **Two databases** — root uses `disha82.db`; `disha-cinematic` uses `disha-cinematic/data/disha.db`. Two split states (sessions vs merchants/orders). For a clean monorepo, **canonize one DB path** and have both servers open it (or keep ports separate but share the schema). Do not change table shapes — only the file path + connection string.

4. **Admin auth duplicated** — `server.js:160` `requireAdminAuth` vs `middleware/ip-whitelist.js` `check()`. Both read `X-API-Key`/`X-Admin-Key`. Unify into a single auth module.

---

## 3. Clean-code refactor plan (design-preserving)

**Rule:** do not touch `phonepe-inspired.css`, `index.html` visual structure, colors (`#382477`, `#19C99E`, `#29CEE9`), fonts, or the checkout PWA layout. Behavior must stay byte-for-byte identical; only structure improves.

### Phase 0 — Characterize (do first, zero changes)
- Run `npm test` (`node test-disha.js`) and the standalone suites (`test-vpa-router.js`, `test-ip-whitelist.js`, `test-npci-intent.js`, `test-verify-all-four.js`, `test-verify-qr-touch.js`). Capture green baseline.
- Add these to `package.json` `"test"` so CI runs all of them.

### Phase 1 — Decompose `server.js` (1,364 lines, "TASK N" comment blocks)
Split into `lib/`:
- `lib/session.js` — `generateSession`, `generateChallengeAmount`, `generateUPILink`, `findSession*`
- `lib/fraud.js` — `/api/verify` 7-layer flow + `extractReceiptEvidence`
- `lib/ws-hub.js` — WebSocket `orderWsClients` + `broadcastOrder*`
- `lib/share.js` — `/handle-share` Android SST flow
- `lib/gaming.js` — `/api/gaming/verify-payment`
- `lib/vpa.js` — VPA select/upload/quarantine/analytics/health endpoints
- `lib/admin.js` — admin auth + IP-whitelist middleware wiring

### Phase 2 — Unify data layer
- Single canonical SQLite path (env `DISHA_DB_PATH`, default `disha82.db` at root).
- `disha-cinematic/server.js` requires root `db.js` instead of its own copy, or both open the same file via `DATA_DIR`.
- Keep `schema.sql` as the single source of truth for schema; seed accounts/VPAs from it.

### Phase 3 — Dedupe utils
- One challenge-amount function, one UPI URI builder, one IP/CIDR util (`utils/ip-utils.js` already good — keep).

### Phase 4 — Harden (security, no design change)
- CORS: replace `ALLOWED_ORIGINS = ['*']` default with explicit env list (`server.js:57-59`).
- CSP: remove `'unsafe-inline'` where possible; keep hash/nonce for inline slider code or move inline scripts to external files.
- Secrets: remove hardcoded `disha_dev_admin_key` default (`server.js:147`) and seeded gaming API key/secret (`db.js:292-302`) — env-only, fail closed in production.
- Rate limiter: in-memory `Map` resets on restart and isn't shared across Render replicas; switch to Redis-backed (Redis already in `render.yaml`) or at minimum document the limitation.
- Validation: add a small schema validator (e.g. `express-validator` or a hand-rolled one) for `/api/verify`, `/api/session/new`, `/handle-share` instead of ad-hoc checks.

### Phase 5 — Tests & CI
- Consolidate root test scripts into `tests/` with a single runner (`npm test` runs all).
- Add GitHub Actions lint + test (`.github/workflows/` exist for forensic projects but not root).

### Verification at every phase
`npm test` + `node test-*.js` must stay green; open `localhost:3000` and `localhost:5000` and confirm the PhonePe-inspired design renders identically.

---

## 4. Clean-code quick wins (file:line)

- `server.js:311` → move `generateChallengeAmount` to `utils/upi-intent.js` (single source)
- `server.js:377` `generateUPILink` → import `buildUpiUri` from `utils/upi-intent.js`
- `server.js:147` `ADMIN_API_KEY` default → remove default, require env in production
- `db.js:292-302` → remove seeded `apiKey`/`apiSecret` from source
- `server.js:57-59` CORS `'*'` → env-driven allowlist
- `server.js:75` `Access-Control-Allow-Origin: origin || '*'` → echo only allowed origins
- `package.json:9` `"test": "node test-disha.js"` → run all suites

---

## 5. Path to a ₹500 Cr firm

DISHA's current model (from README): **one-time license = 4 × verified monthly net savings**, 0% perpetual commission. For a ₹500 Cr (₹5 billion) revenue/valuation business, the lever is **merchant count × GMV × trust**, not transaction MDR.

### Revenue math (illustrative)
| Merchant tier | Monthly GMV | 2% MDR avoided | One-time license (4× mo. savings) | Merchants needed for ₹500 Cr ARR (approx.) |
|---|---|---|---|---|
| Kirana | ₹15 lakh | ₹30k/mo | ₹1.2 lakh | ~4,200 |
| Supermarket | ₹50 lakh | ₹1 lakh/mo | ₹4 lakh | ~1,250 |
| D2C brand | ₹2 crore | ₹4 lakh/mo | ₹16 lakh | ~312 |
| Gaming studio | ₹10 crore | ₹20 lakh/mo | ₹80 lakh | ~62 |
| Enterprise marketplace | ₹50 crore | ₹1 crore/mo | ₹4 crore | ~12 |

### Strategic levers
1. **Product-led growth:** Free/low-cost checkout PWA for small merchants; one-time license scales with volume. The savings calculator on the website is already a good conversion tool — keep it, add "export quote" + Stripe/Razorpay payment link for the license fee.
2. **Vertical focus first:** Gaming studios and MMO platforms (highest GMV per merchant, pain of VPA bans is real — DISHA's 1,000-VPA anti-ban fleet is a strong differentiator). Then kirana/D2C.
3. **Compliance & trust moat:** NPCI UPI v3.2 alignment, RBI PA/PG authorization or partner-bank sponsorship, SOC2-style audit, double-entry ledger + merkle audit trail (the Python production twin already designs this — port the ledger/merkle ideas into the Node code). Publish a trust center page.
4. **Distribution:** Partner with banks (VPA issuance), ISOs, accounting/GST software, e-commerce platforms (Shopify/WooCommerce plugins for India), and commerce OS providers.
5. **Product expansion (roadmap already in README):** Account Aggregator bank-statement reconciliation, GST e-invoicing, offline BLE soundbox, credit on UPI/RuPay, cross-border (PayNow/Singapore, UAE). Each opens a new pricing lever beyond the one-time license (SaaS for premium features).
6. **Unit economics:** Zero per-transaction MDR means gross margin is near 100% on software; cost is hosting + support. Scale is bounded by sales capacity, not transaction cost.
7. **Metrics to track:** active merchants, GMV processed, MDR saved (marketing number), license ARR, churn, support tickets per merchant, 7-layer intercept count (trust signal).

**Timeline to ₹500 Cr:** 3–5 years. Year 1: prove with 50–100 merchants + gaming pilots. Year 2–3: channel partners + vertical SaaS features. Year 4–5: enterprise marketplaces + cross-border.

---

## 6. Website audit + 3D immersive concept

### Current website (`disha-cinematic/public/index.html`)
**Strengths:** clear PhonePe-inspired light-first design, hero carousel (3 banners), 7 solution cards, sectors grid, 15s video, savings calculator, trust section with honest disclosure, FAQ, CTA. Responsive nav + mobile drawer.

**Gaps:**
- No interactive product demo (QR/soundbox shown statically).
- Calculator is an estimate, not a bindable quote.
- No trust center / security audit page despite heavy "7-layer" claims.
- No 3D depth — everything flat; fintech competitors use depth to signal "infrastructure".
- Single hero video can't scale; a WebGL scene can show the whole system live.

### 3D immersive concept: "Everything shown in 3D"

**Motto (in 3D):** *"Your Business. Your Payment. Sovereign."* — rendered as the central spatial anchor; every element orbits or connects to it.

**Stack:** Three.js (or React Three Fiber if moving to React), fallback to 2D CSS for non-WebGL devices. Keep the existing PhonePe visual identity (colors, typography) as the 2D shell; the 3D scene is an immersive layer under/behind it.

**Scenes (everything shown):**

1. **Hero — Payment beam in 3D.** Customer phone (left) and merchant terminal (right) in a 2.5D isometric space; a glowing ₹ beam flows between them with the live challenge amount (e.g. ₹100.37) floating as a 3D token. Tappable → opens the real checkout flow.

2. **7-layer fraud engine — 3D gate tunnel.** Seven translucent gates the payment must pass (session TTL → paise match → UTR dedup → timestamp → NPCI note → velocity → double-entry ledger). Each gate lights up green/red on hover with a micro-explanation. Represents the whole verification engine spatially.

3. **1,000-VPA anti-ban fleet — orbiting node cluster.** 1,000 VPAs as points across 4 bank orbits (SBI/HDFC/ICICI/Axis), color-coded by health score, pulsing on use, cooling down with a visible ring. Shows the anti-ban system "live".

4. **Double-entry ledger — balanced scales.** Debit and credit sides as two 3D pans that stay perfectly level; each settled payment adds equal weight to both. Click to see journal entries scroll by.

5. **Soundbox — audio waveform visualizer.** 3D speaker emitting a waveform when a payment verifies; language toggle (7 Indian languages).

6. **Merchant dashboard — floating workspace.** Cards for volume, VPA health, fraud stats floating in 3D space; navigates to the real `/dashboard`.

**Interaction:** scroll-driven (scrollytelling) — as the user scrolls, the camera travels through the tunnel/gates/orbits; each section snap-aligns. Reduced-motion respected (respect `prefers-reduced-motion`, fall back to the existing 2D page).

**Implementation approach (no design break):**
- Keep the current `index.html` as the SEO/marketing shell.
- Add a `/3d` route (or a "Experience the rail" CTA button) that loads a Three.js scene; link back to `/checkout` and `/login` so the 3D site feeds the real product.
- Reuse existing assets: `/assets/disha-symbol-transparent.png`, hero orbs, dashboard mockups as textures on 3D cards.

---

## 7. Recommended immediate next steps

1. **This week:** baseline all tests (`npm test` + standalone suites), then Phase 1 refactor of `server.js` into `lib/`, keeping design untouched.
2. **Next 2 weeks:** dedupe challenge amount + UPI builder, unify DB path, harden CORS/CSP/secrets, remove dead code (`disha-ui/`, `halo-landing/`, `merchant-pwa/`, `scratch/`).
3. **Month 1:** consolidate tests into one suite + GitHub Actions; deploy to Render via `render.yaml` (note: render.yaml references the FastAPI backend not yet wired — decide Node vs Python as the single runtime, don't run both).
4. **Month 2:** launch the 3D immersive site at `/3d`, add a bindable quote/license checkout to the savings calculator, publish trust-center page.
5. **Ongoing:** merchant pilot program (gaming first), then ₹500 Cr GTM as above.
