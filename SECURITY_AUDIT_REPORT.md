# DISHA 8.2 — Security Audit Report

**Scope:** Full monorepo at `D:\Downloads\Zero-Trust-Fintech`
- Node.js checkout server (`server.js`, Express + ws, port 3000) + merchant SaaS (`disha-cinematic/server.js`, port 5000)
- Python/FastAPI "production twin" (`zero-trust-fintech-production/`, NOT integrated with the Node servers)
- Schema (`schema.sql`), DB (`disha82.db` SQLite), CI workflows (`.github/workflows/`)
**Mode:** Report only. Zero files were modified. No credentials were cracked; no live exploitation was performed.

---

## Executive summary

The codebase shows real security engineering (parameterized queries everywhere, double-entry ledger with balance assertions, UTR replay blacklisting, IP-whitelist middleware with CIDR support, PBKDF2 password hashing, timing-safe key comparison, security headers). However, it is **not production-hardened** as shipped. The most serious issues are:

1. **Receipt trust is client-attested, not bank-verified** — `/api/verify` accepts client-supplied timestamps and a client-controlled `editArtifacts` flag when scoring "screenshot authenticity"; settlement is probabilistic (text-pattern matching) with `bankCorroborated: false` in every path. The "Zero-Trust / fraud-proof" branding overstates the actual guarantees.
2. **Hardcoded / default cryptographic secrets in source** — Python JWT signing keys default to a static string in `config.py`/`auth.py` (the validator rejects only a different placeholder string); `.env` on disk carries real PostgreSQL credentials and a real personal UPI handle; CI workflows embed DB passwords and test secrets.
3. **Rate limiting collapses behind a proxy** — `trust proxy` is off, so `req.ip` is the reverse-proxy IP: all customers share one rate-limit bucket, and one customer can exhaust the limit for everyone. The in-memory fallback also resets on restart and is not shared across Render replicas.
4. **No authentication on the WebSocket channel** — any caller knowing an `orderId` can subscribe to that order's settlement broadcast.
5. **Session hijacking by challenge amount** — `findSessionByAmount` resolves a pending session by amount within ₹0.004, so anyone who knows (or guesses) the challenge amount can claim another customer's pending session via `/handle-share`.
6. **Payment simulation enabled by default** — `disha-cinematic` only blocks `/simulate` when `NODE_ENV=production AND ALLOW_SIMULATION=false`; the Node `/api/simulate-payment` settles orders with a predictable mock UTR when `ENABLE_PAYMENT_SIMULATION=true` or an admin key is present.
7. **No brute-force protection on `/auth/login`** (Python FastAPI twin) — no rate limiting or lockout.
8. **Audit logs store unredacted transaction payloads** (challenge IDs, UTRs, device IDs) and do blocking synchronous DB writes inside an async route.
9. **Forked codebases with diverging claims** — Node advertises a "7-layer" engine, Python a "5-layer" engine; `render.yaml` references the FastAPI backend which is not wired to the Node servers. Deployment target is ambiguous.

npm audit: **0 known vulnerabilities** across 113 production dependencies.

---

## Detailed findings

### CRITICAL / HIGH

| ID | Severity | Location | Issue |
|----|----------|----------|-------|
| A1 | High | `server.js:510-591` `extractReceiptEvidence()` | Trust scoring honors client-controlled fields: `shownTime` from `clientReported.timestamp` (checked against a wide ±1min window around session creation/now), `exifSoftware` from `clientReported.exifSoftware`, `editArtifacts` from `clientReported.editArtifacts === true`. A forged receipt can self-attest as unedited and supply an in-window timestamp, inflating the trust score toward settlement. |
| A2 | High | `server.js:595-826` `/api/verify` | Settlement decision is probabilistic OCR/text matching. No PSP signature verification, no bank webhook/SMS confirmation, no UTR-to-bank corroboration (`bankCorroborated: false` in every response). Replay protection exists (UTR blacklist) but only after scoring. "Fraud-proof" / "Zero-Trust" claims are marketing, not enforced controls. |
| A3 | High | `zero-trust-fintech-production/app/core/config.py:39-40`, `app/core/auth.py:35-38` | JWT `SECRET_KEY`/`JWT_SECRET_KEY` default to static string `zerotrust-fintech-jwt-secret-key-32bytes-minimum!` in source. The pydantic validator rejects only the literal placeholder `CHANGE_THIS_TO_A_RANDOM_64_CHAR_STRING`, so this real default passes validation. With env unset, all merchant JWTs are forgeable. |
| A4 | High | `.env` (present on disk, gitignored) | Contains real credentials: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/disha82`, real personal UPI handle `MERCHANT_UPI_ID=nkumar906099-7@oksbi`. Do not commit; rotate these values. |
| A5 | High | `.github/workflows/production-ci.yml:59-61, 99-111` | Hardcoded PostgreSQL password `SecurePass123!`, CI `JWT_SECRET_KEY`, `N8N_API_KEY: test-n8n-key` embedded in the workflow file. Move to GitHub Secrets/environments. |
| A6 | High | `ci.yml:39` | `ADMIN_API_KEY: test-admin-key` embedded in CI. |
| A7 | High | `server.js:28` `app.set('trust proxy', false)` + `server.js:71` `req.ip` | Behind Render/Cloudflare, every customer shares the proxy IP as `req.ip`. Rate-limit buckets collapse across all customers; one busy customer blocks all others. In-memory Map fallback resets on restart and is not shared between replicas. |
| A8 | High | `server.js:270-305` WebSocket `/ws` | No JWT/session authentication. Authorization is solely `orderId` in a query param. Any caller who knows (or guesses) an order ID receives settlement broadcasts (masked UTR/VPA, amounts, status). |
| A9 | High | `db.js:456-486` `findSessionByAmount()` + `server.js:855-858` `/handle-share` | A pending session is resolved by exact challenge amount (`ABS(challenge_amount - ?) < 0.004`). An attacker who knows or guesses the challenge amount can claim another customer's live PENDING session and trigger settlement against it. |
| A10 | Medium | `disha-cinematic/server.js:272` | Payment simulator blocked only when `NODE_ENV=production AND ALLOW_SIMULATION === 'false'` — simulation is ON by default, including production unless explicitly opted out. |
| A11 | Medium | `server.js:1032-1083` `/api/simulate-payment` | Settles an order with mock UTR `631902${Math.random()*900000}` (predictable, 6-digit suffix) when `ENABLE_PAYMENT_SIMULATION=true` or admin credentials provided — no proof of payment required. |
| A12 | Medium | `zero-trust-fintech-production/app/api/auth_routes.py:120-147` `/auth/login` | No rate limiting, no account lockout, no CAPTCHA — credential stuffing / brute force on merchant passwords is unimpeded. PBKDF2 (100k) / bcrypt slows offline cracking only. |
| A13 | Medium | `zero-trust-fintech-production/app/middleware/audit.py:15-48` | `log_audit_event()` stores full `request_data` (challenge_id, utr, amount, device_id, timestamps) unredacted, and performs blocking `SessionLocal().commit()` inside an async FastAPI route (event-loop stall). |

### MEDIUM / LOW

| ID | Severity | Location | Issue |
|----|----------|----------|-------|
| B1 | Medium | `server.js:1027` `/api/simulate-payment` | Mock UTR prefix `631902` fixed; low-entropy random suffix. |
| B2 | Medium | `server.js:43-44` CSP | `script-src 'self' 'unsafe-inline' ...` and `style-src 'unsafe-inline'` — XSS via any injection point executes inline scripts. `connect-src 'self' ws: wss:` permits WebSocket connections to arbitrary hosts. |
| B3 | Medium | `disha-cinematic/server.js:39-47`, `:649` | `Access-Control-Allow-Origin: *` on all JSON/static responses, including authenticated cookie-based sessions (`disha_session` HttpOnly SameSite=Lax). Credentials won't be sent with `*`, but the posture is loose and inconsistent with session auth. |
| B4 | Medium | `disha-cinematic/server.js:45, 270` | Session cookie lacks `Secure` attribute (sent over plaintext http in dev) and there is no CSRF token on cookie-authenticated state-changing POSTs (SameSite=Lax mitigates cross-site reads, not all CSRF). |
| B5 | Medium | `utils/ip-utils.js:45-50` | `X-Real-IP` accepted as client IP when `trust proxy` is off (though validated as public/non-private) — spoofable by any client directly hitting the Node server. |
| B6 | Medium | `npci-intent.js:222-223` | UTR extraction regex `\b\d{12}\b` grabs *any* 12-digit number from receipt text — false UTR attribution possible from dates/invoice numbers in a forged receipt. |
| B7 | Medium | `server.js:810-811`, `:953-954` | WebSocket `senderVpa` defaults to hardcoded placeholder `customer@okhdfcbank` / `customer@upi` when not supplied — fabricated sender data broadcast to clients. |
| B8 | Medium | `server.js:496-498`, `:983-986` | 500 error responses return raw `err.message` to clients (stack/DB detail leakage). |
| B9 | Medium | `server.js:500-506` `/api/session/:orderId` + `:1085-1100` `/api/ledger/:orderId` | No authentication; exposes merchant VPA address and session state for any order ID. |
| B10 | Medium | `middleware/ip-whitelist.js:270-278` `logAccess()` | `request_body` (up to 1000 chars) written to `api_access_log` — may log auth tokens, API keys, or payment payloads submitted in request bodies. |
| B11 | Medium | `db.js:28-44` | Dual-engine store: session-management functions (`saveSession`, `findSessionByOrderId`, ...) only write to `sqliteDb`. If only PostgreSQL is reachable, `isPostgres = true` but sessions never persist — `/api/verify` then always fails with `SESSION_NOT_FOUND`. Silent half-broken configuration. |
| B12 | Low | `middleware/ip-whitelist.js:230` | Exact IP match uses `ip_address = ?` text comparison while the same column stores CIDR strings — mixed types work for exact matches but are semantically unclean. |
| B13 | Low | `zero-trust-fintech-production/app/core/fraud_engine.py:208-210` `gate3` | Replay fingerprint `sha256(utr|amount|device_id)` omits merchant ID and collapses when `device_id` is missing (`"None"` string) — different transactions sharing UTR+amount but different devices bypass the replay gate. |
| B14 | Low | `zero-trust-fintech-production/app/core/challenge.py:317-335` | `is_challenge_consumed()` returns `val is None` — reports "consumed" when a challenge is *missing* (inverted logic; currently unused). |
| B15 | Low | `zero-trust-fintech-production/app/core/ledger.py:104-122` | `verify_integrity()` mutates the database (creates a genesis block) on a GET/read endpoint. |
| B16 | Low | `zero-trust-fintech-production/app/services/forensics_service.py:91-114` | ELA/OCR/metadata "analysis" are hardcoded stubs (always `manipulation_detected: false`, `match: True`) — presented as forensic evidence but perform no real detection. |
| B17 | Low | `zero-trust-fintech-production/app/core/config.py:86` | `extra = "allow"` — unknown env vars silently accepted, hiding typos like `JWT_SECRETE_KEY`. |
| B18 | Info | `npm audit` | 0 known vulnerabilities in 113 production Node dependencies. Lockfile (`package-lock.json`) committed — good. |

---

## What is done well (controls present)

- Parameterized queries / prepared statements in every DB access (Node `sqlite3`/`pg` and Python SQLAlchemy) — no classic SQL injection surface.
- `crypto.timingSafeEqual` for admin key comparison (`server.js:224-233`).
- Double-entry ledger with balance assertion on every settlement (`db.js:513-577`, Python `ledger_service.py` / `MerkleTreeLedger`).
- UTR blacklisting / single-use enforcement (`blacklist_utrs`, `isUtrBlacklisted`, Redis SET-NX replay gate in Python).
- IP whitelist middleware with exact + CIDR matching, brute-force counter (`blocked_ip_attempts`), per-company API keys (`gaming_companies.api_key/api_secret` generated with `crypto.randomBytes`).
- PBKDF2-HMAC-SHA256 100k iterations (disha-cinematic `db.js`) with bcrypt preference (Python `auth_routes.py`).
- Security headers: CSP, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, HSTS in production.
- Idempotency keys on POST endpoints (`Idempotency-Key` middleware, 24h TTL).
- Ed25519 device attestation with 60s freshness window (Python `security.py`).
- HttpOnly, SameSite=Lax session cookies on the merchant SaaS.

---

## Recommendations (prioritized, report only — no changes applied)

1. **Remove client-trusted inputs from trust scoring.** `extractReceiptEvidence` must not accept `shownTime`, `editArtifacts`, or `exifSoftware` from `req.body`. Treat all screenshot evidence as untrusted; require a bank-initiated confirmation (PSP `sign` parameter, webhook, or SMS/UTR match in the merchant's own app) before ledger settlement. Report the trust tier as advisory, not authoritative.
2. **Eliminate hardcoded secrets.** Make all signing keys, DB credentials, and API keys env-only; fail closed in production if unset. Fix the pydantic validator to reject the actual default string, not just a different placeholder. Rotate the `.env` postgres password and the personal UPI handle now exposed in this repo. Move CI secrets (`SecurePass123!`, `test-admin-key`, `test-n8n-key`, JWT keys) into GitHub Secrets/environments.
3. **Fix rate limiting for proxy deployments.** Enable `trust proxy` correctly (or derive per-client keys from a stable opaque identifier), use Redis-backed shared sliding windows, and document the single-replica in-memory fallback limitation.
4. **Authenticate the WebSocket.** Require a valid merchant/session JWT bound to the `orderId` before admitting a `/ws?orderId=` subscriber.
5. **Deprecate amount-based session resolution.** `findSessionByAmount` allows session hijacking; require explicit `orderId`/`txnRef` for `/handle-share` and `/api/verify`. If kept, add rate limiting and first-claimer locking.
6. **Disable simulation by default everywhere.** Make `/simulate` and `/api/simulate-payment` opt-in only, gated behind admin credentials, and never reachable in production without explicit opt-in. Remove predictable mock UTR patterns.
7. **Add brute-force protection to `/auth/login`.** Rate limit per email/IP and lockout after repeated failures.
8. **Redact audit logs and make logging non-blocking.** Exclude `challenge_secret`, `challenge_id`, `signature`, and raw payloads from `api_access_log`/`audit_logs`, or hash them; run audit inserts off the event loop.
9. **Remove or label the forensics stubs.** Do not claim ELA/OCR/metadata results that are hardcoded; clearly mark triage as "not performed" when the analyzers are stubs.
10. **Resolve the dual-runtime ambiguity.** Node ("7-layer") and Python ("5-layer") implement diverging fraud/ledger logic; `render.yaml` points at the unintegrated FastAPI backend. Pick one production runtime, remove dead code paths, and align public security claims with the implemented engine.
11. **Harden transport and headers.** Drop `'unsafe-inline'` from CSP (use nonces/hashes or move scripts to external files), restrict CORS to explicit origins, add `Secure` to cookies, add CSRF tokens for cookie-authenticated state-changing endpoints, and return generic error messages instead of raw `err.message`.
12. **Fix Postgres session persistence** or make the engine choice explicit and fail fast at startup when the configured store cannot support sessions.

---

## Appendix: files audited

Node (root): `server.js`, `db.js`, `middleware/ip-whitelist.js`, `utils/ip-utils.js`, `utils/trust-score.js`, `utils/upi-intent.js`, `npci-intent.js`, `vpa-router.js`, `vpa-importer.js`, `routes/admin/ip-whitelist.js`, `schema.sql`, `.env`, `.env.example`, `.gitignore`, `package.json`, CI: `.github/workflows/{ci.yml,production-ci.yml,sharepay-ci.yml,forensic-upi-ci.yml,forensic-upi-intent-ci.yml}`.

Merchant SaaS: `disha-cinematic/server.js`, `disha-cinematic/db.js` (spot-checked: pbkdf2 hashing, session tokens).

Python twin: `app/main.py`, `app/core/{auth.py,security.py,config.py,challenge.py,fraud_engine.py,ledger.py}`, `app/api/{routes.py,auth_routes.py,websocket.py}`, `app/middleware/audit.py`, `app/models/database.py`, `app/services/{redis_service.py,vpa_router.py,vpa_health.py,n8n_webhook.py,forensics_service.py,ledger_service.py,compliance_service.py}`, migrations `alembic` versions 001/002.

Deliverable is this report only. No files were modified, no fixes implemented, nothing committed.
