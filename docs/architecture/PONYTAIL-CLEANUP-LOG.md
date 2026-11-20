# 19 November 2026 — Ponytail stale-data cleanup

## Changes in frontend PR #71

1. **Removed** `disha-local.postman_environment.json`: unused root-level Postman environment containing a prefilled dummy merchant identity and password.
2. **Removed** `disha-api.postman_collection.json`: duplicate root API collection describing obsolete settlement simulation workflows, not the active direct UPI runtime.
3. **Removed** `AUDIT_REPORT.md`: obsolete architecture inventory referencing nonexistent duplicate projects and an outdated SaaS server topology. The canonical TDD/IDD replaces it.
4. **Sanitized** `postman/DISHA_8.2_Local.postman_environment.json` and `postman/DISHA_8.2_Production.postman_environment.json`: no saved merchant email, password or receiving VPA.
5. **Guarded** `postman/test-runner.js`: local environment by default; live production requires an explicit flag.
6. **Added** `tests/test-postman-credentials.js` for automated regressions.

### Deletion limits

No production database, PostgreSQL table, migration, real payment session or receiving account was touched. Test fixtures within `tests/` and Android emulator receivers remain because they are necessary to prove failure behavior; fixture records are not production merchant data.

Do not remove `public/`, `dist/`, `disha-cinematic/public/`, `disha-cinematic/dist/` or `zero-trust-fintech-production/` until their deployed and external consumers are verified. The outstanding candidates remain tracked in [issue #69](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/69).

**Credential warning:** GitHub repository history retains earlier versions of removed or sanitized files. If any committed Postman value was an active credential, rotate it independently; deleting the file from the current branch does not erase history.

## 20 November 2026 — Zero-install checkout dead-asset cleanup (Ponytail)

- Removed two stale GitHub Actions workflows whose `forensic-upi-engine/` and `forensic-upi-intent-engine/` working directories are absent from the tracked repository. The real Android, Node, PostgreSQL and Python CI workflows remain.
- Removed the unreferenced legacy `app.js` controller from `public/` and three deployment mirrors. This controller registered a PWA service worker and exposed a manual receipt fallback; it was not loaded by active public or authenticated HTML entry points.
- Removed the blocked `debug.html` page from the four frontend roots; production already rejects this route.
- Removed four root `workflows/n8n/` JSON exports for webhook-driven VPA workflows. The Node checkout does not load these exports. Deleting stored JSON does **not** disable workflows that may already be imported into external n8n instances; inspect those separately before claiming a full webhook shutdown.
- Build now clears each *generated frontend mirror only* before syncing canonical `public/`, preventing retired assets from lingering after a local rebuild. No database or financial data is touched.
- Added `tests/test-ponytail-retired-paths.js` to the root unit suite to keep these paths retired.

**Deliberately retained:** `financial/reconciliation-webhook.js` and its ledger protections, `zero-trust-fintech-production/` (separately tested Python service), PWA `manifest.json` / `service-worker.js` (referenced by legacy integration tests), Android test receiver, and developer MCP/IDE settings. Removing those safely needs a separate dependency- and behavior-preserving migration. The intended checkout remains browser-first with no DISHA customer-app installation.

**Scope:** GitHub source cleanup only, via review branch; live Cloudflare, Railway, GitHub Actions and external n8n deployments are unchanged until a merge/deployment occurs. No real-payment acceptance is established by this cleanup.
