# DISHA 8.2 — Ponytail repository audit and removal quarantine
Audit date: 2026-11-19

## What this repository does
DISHA is a direct UPI P2P/P2M checkout and merchant operations system: customer-specific payment URIs and QR, Android app handoff, transaction-reference evidence, anti-replay controls, financial reconciliation, double-entry ledger, merchant SaaS and owner operations. Railway's checked-in deployment starts the root Node/Express server; Cloudflare Pages serves the replicated frontend. A separate Python/FastAPI system remains in the repository with its own CI, but is **not** the entry point selected by `railway.json`.

**Expected stress load for this review:** the proposed 100,000 simultaneously active checkouts, not a measured number. This audit reviews the GitHub tree and high-risk source/callers/config, not the live Railway/Cloudflare runtime. Do not call it full production certification.

## What was inspected
- GitHub API recursive tree of `main` at `1031039d7fa333ee8530e950f6abd1a0acc07453`: **562 entries, 493 blobs; not truncated**.
- Main entry points/config: `server.js`, `db.js`, `merchant-api.js`, `platform-control.js`, `utils/upi-intent.js`, `financial/postgres-store.js`, `financial/reconciliation-webhook.js`, `financial/vault-evidence.js`, `railway.json`, `wrangler.toml`, `package.json`, `scripts/build.js`.
- CI and coverage: `.github/workflows/ci.yml`, `postgres-financial-core.yml`, `production-ci.yml`, `scripts/lint.js`, `tests/runner.js`, `tests/test-frontend-parity.js`.
- Existing audits and instructions: `AGENTS.md`, `.agents/skills/disha-android-debugging/SKILL.md`, November Ponytail audit documents, `README.md`, archived architecture reports.
- External methodology: `DietrichGebert/ponytail` `ponytail-audit`, `ponytail-review`, `ponytail-debt`: confirm concrete breakage before changing/deleting; trace callers, dynamic references, configs and tests.

## Must fix / verify before production release
1. **Multiple allowed origins were treated differently** (`server.js`, CSRF + WebSocket): CORS allows any configured origin, but CSRF and WebSocket allowed only `ALLOWED_ORIGINS[0]`. A legitimate second configured checkout origin could receive HTTP 403 or WS 4403. **Fixed on audit branch**, with a focused contract test. Preserve rejection of unknown origins.
2. **Financial tests had missing pull-request triggers** (`postgres-financial-core.yml`): a PR modifying `platform-control.js`, `utils/upi-intent.js` or another migration could skip PostgreSQL invariants even when its payment behavior changed. **Fixed on audit branch** by aligning PR path coverage with relevant push paths.
3. **Browser E2E is not a strict release gate** (`tests/runner.js`): Linux CI looks for Chrome at a hard-coded Windows executable path; missing Chrome or an exception skips test cases, and `npm test` remains green. A green build is not proof the checkout browser works. **Open**: create an explicit Playwright/native browser job and fail it on errors, rather than forcing existing optional suites to be mandatory without providing dependencies.
4. **WebSocket admission and fallback IP rate-limiting scan all recorded IP buckets on each request** (`server.js`, `wsRateLimit` and `createRateLimiter`). This work grows with the number of distinct clients; it is a real hot path for the 100K-checkout target. **Open on `main`**. PR #68 already contains a periodic-cleanup improvement; check integration before cherry-picking to avoid competing edits.
5. **100,000 active sessions and multi-instance event delivery are not load-proven**. Root `server.js` holds `orderWsClients` in a process-local `Map`; one replica cannot directly broadcast to another replica's listeners. **Open**: staging load tests, broker fan-out or shared messaging, connection resource budgets, database pool limits and restart/reconnect behavior.
6. **Quantum Signal #68 and three-tool audit #63 are draft PRs** as checked, not in `main`. Both must be audited separately before main/prod claims. A `qs=1` draft is not the default production checkout.
7. **Real-device UPI acceptance** is still an open external release gate. P2P and P2M Android app launch and real-app return need physical Google Pay/PhonePe evidence; Android simulator success is not a live payment.

## Should fix / lean
8. **Lint did not include `financial/` or `public/` JavaScript** (`scripts/lint.js`). Syntax errors in an important backend or browser file could be missed by the dedicated lint step. **Fixed on audit branch** by extending the directories.
9. **Build left deleted static files in output directories** (`scripts/build.js` copies without pruning). Removing a file from `public/` can leave an old output under `dist/` or `disha-cinematic/`. **Guard added on audit branch**: parity test also rejects extra files, without automatically deleting any asset.
10. **CI used `npm install` despite a checked-in lock file**. This can change resolved dependencies during a CI run. **Fixed on audit branch**: use `npm ci`.
11. **Historic architecture documents describe absent or superseded entry points**, including `disha-cinematic/server.js` in `AUDIT_REPORT.md` / `BACKEND_ARCHITECTURE_END_TO_END.md`, which is absent from the checked-in tree. **Candidate for documentation correction**; retain the reports as historical evidence until reconciled.
12. **Unqualified marketing language** in `package.json` says `Fraud-Proof` and lists a `fraud-proof` keyword. Automated evidence controls are real, but this absolute performance claim is not substantiated by a fraud-rate evaluation. **Candidate for copy correction** rather than code deletion.

## Potentially stale or redundant, but NOT confirmed safe to delete
These are *quarantined for ownership and dependency review*, not called unreferenced:

| Candidate | Evidence | Why it must remain for now | Safe deletion test |
| --- | --- | --- | --- |
| `zero-trust-fintech-production/` (56 files) | Separate FastAPI/Docker/Redis/n8n service, whereas root `railway.json` starts `node server.js` | `.github/workflows/production-ci.yml` actively targets its code; may support an independent integration | Confirm no external deploy, job or operator uses it; preserve schema/ledger history and passing Python CI |
| `workflows/n8n/` (4 JSON exports), Python n8n exports | Not imported by the active Node checkout | May be manually imported in an n8n instance; user intends to revisit after testing | Inspect remote n8n registrations and dependent webhooks before removal |
| `dist/`, `disha-cinematic/public/`, `disha-cinematic/dist/` | **66 files in each**, matching `public/` in Git blob identity; intentional replica generation | Cloudflare/legacy Pages configs and regression tests require parity | Confirm actual Pages build root and all edge routes; then change build + tests and deploy preview first |
| `.kilo/`, `.continue/`, `.vscode/`, `.agents/` | Development-agent settings rather than Node startup modules | May be used by local editors and external dev workflows | Confirm owners and active IDE/MCP configurations |
| Postman collections, older reports, test suites | Not necessarily used by server on each request | CI/manual tooling, forensic history and API compatibility may depend on them | Whole-tree/dynamic-reference inspection plus CI + operator sign-off |

**Zero unreferenced source files have been confirmed for deletion in this pass.** Do not equate "no import from server.js" with "safe to delete"; commands, CI, manual exports, Pages and external automation are also consumers.

## Preservation rules
- No deletion or reset of financial records, migration files, ledger schema, UTR bindings, customer/merchant records, test fixtures, compliance/security code, or production secrets.
- No removal of original UPI URI fields or forced P2P/P2M substitution.
- No n8n in the synchronous payment decision path.
- No automatic merge/deployment of a draft payment feature from this audit.
- Before any future delete: prove no references in source/test/config/external deploys; remove on a separate PR; run Node+Postgres+Android+merchant smoke+Pages parity; obtain explicit owner acceptance.

## Scope limits
Not every line of the 493 blobs was read. Binary assets, all archival UI assets, every Python module, remote n8n registrations, live Railway DB data/config, real PSP responses and 100K load testing were not inspected/executed. No source deletion is authorized by this report. This branch is a **quarantine and low-risk defect-fix branch**, not a release or a live cleanup action.

Verdict: **Address missing browser release testing and high-concurrency WebSocket delivery before the next payment release. Preserve unproven "unused" directories until a deployment and test dependency review.**
