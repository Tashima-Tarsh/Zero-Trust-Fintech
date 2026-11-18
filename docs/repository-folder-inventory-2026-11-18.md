# DISHA 8.2 — Repository Folder Inventory and Production Debt Register

Date: 18 November 2026. Source: GitHub repository tree `main`, files: **479**, nested directories: **76**.

**Change policy:** This is an inventory and risk classification, **not evidence a folder can be deleted**. In particular, the three frontend mirrors and the separate Python backend remain referenced by builds or workflows. No financial data is deleted by this report.

## Functional directory classification

| Directory | Tracked files below | Role | Recommendation |
|---|---:|---|---|
| `public/` | 71 | Canonical live checkout, merchant SaaS, Cloudflare edge and assets | KEEP; edit this source, rebuild copies |
| `dist/` | 71 | Frontend deployment output | GENERATED; keep until Pages config is migrated |
| `disha-cinematic/public/` | 71 | Legacy Cloudflare Pages public root | MIRROR; retain while legacy deployment references it |
| `disha-cinematic/dist/` | 71 | Legacy Cloudflare Pages dist root | MIRROR; retain while legacy deployment references it |
| `zero-trust-fintech-production/` | 56 | Independent Python/Alembic/Redis/n8n stack | REVIEW separately; not root Railway Node runtime |
| `tests/` | 53 | Node tests, PostgreSQL integration and Android emulator fixture | KEEP; different CI workflows cover distinct tests |
| `.github/workflows/` | 6 | Root, financial, forensic, Android and Python CI | KEEP; hardening trigger coverage |
| `.vscode/` | 3 | .vscode IDE tasks/extensions/MCP | DEV ONLY; retain user environment |
| `.kilo/` | 3 | Kilo agent definitions and MCP settings | DEV ONLY; retain user agent workflow |
| `.continue/` | 1 | Continue editor MCP settings | DEV ONLY; retain user agent workflow |
| `financial/` | 7 | Exact paise, PostgreSQL authority, WebAuthn Vault and reconciliation | CRITICAL; no deletion without migration |
| `migrations/` | 2 | Node checkout and financial schema migrations | CRITICAL; preserve |
| `utils/` | 7 | Clerk, UPI, trust and temporal safeguards | CRITICAL; preserve |
| `scripts/` | 7 | Build, schema, migration, reset tooling | KEEP; reset script is guarded |
| `postman/` | 5 | Live API testing collections/environments | CONSOLIDATE later, verify references first |
| `workflows/n8n/` | 4 | Workflow definitions | REVIEW orchestration and deployment status |
| `docs/` | 9 | Audit notes and runbooks | KEEP as history |
| `routes/` | 1 | Administrative routing | REVIEW authentication |
| `middleware/` | 1 | IP protections | KEEP until replacement tested |
| `assets/` | 4 | Shared brand/design source | KEEP |

## Technical debt and actions

1. **Four frontend roots:** Keep `public/` authoritative, run the real `npm run build`, and fail CI if any binary, CSS, JavaScript or HTML differs in the three mirrors. Do not delete them until both Pages and local build output paths are updated.
2. **Node vs Python:** Root `server.js` is the Railway service runtime. `zero-trust-fintech-production/` is a separately tested Python/Alembic service; it is not proof that Railway runs that stack. Preserve unless deployment and integration ownership are resolved.
3. **Tests:** PostgreSQL integration test files omitted from `tests/runner.js` run in `.github/workflows/postgres-financial-core.yml`. Android tests use the device-fixture workflow; they do not prove a real bank PIN payment.
4. **IDE config:** `.kilo/`, `.vscode/`, `.continue/` are user development configuration, not production code. Do not delete or echo tokens from them.
5. **MCC and VPA classification:** P2M must carry a valid acquirer-issued MCC; a personal account must not be disguised as a merchant or vice versa. Classification not verified by bank requires a production NO-GO.
6. **Session expiry:** Server-created three-minute expiry is authoritative; browser timer and QR/App handoff must respect it. Browser focus alone is not financial evidence or proof an external UPI app opened.
7. **Financial cleanup:** A production data reset requires verified backups and a scoped maintenance operation; migration tables and owner configuration must survive. No reset has been performed in this audit.
8. **Retired files:** `public/debug.html`, old Postman copies, and legacy frontend mirrors are investigation candidates only; a deletion PR should include dependency traces and rollback tests.
9. **CI scope:** Full root tests, PostgreSQL transaction invariants, Android emulator fixture and Python workflows must pass; bank-side acceptance remains a separate production condition.

## Complete directory list (76)

- `.continue/` — 1 files below
- `.continue/mcpServers/` — 1 files below
- `.github/` — 6 files below
- `.github/workflows/` — 6 files below
- `.kilo/` — 3 files below
- `.kilo/agents/` — 2 files below
- `.vscode/` — 3 files below
- `assets/` — 4 files below
- `disha-cinematic/` — 144 files below
- `disha-cinematic/dist/` — 71 files below
- `disha-cinematic/dist/assets/` — 23 files below
- `disha-cinematic/dist/assets/icons/` — 6 files below
- `disha-cinematic/dist/checkout/` — 1 files below
- `disha-cinematic/dist/css/` — 1 files below
- `disha-cinematic/dist/js/` — 2 files below
- `disha-cinematic/dist/pay/` — 1 files below
- `disha-cinematic/dist/vendor/` — 1 files below
- `disha-cinematic/public/` — 71 files below
- `disha-cinematic/public/assets/` — 23 files below
- `disha-cinematic/public/assets/icons/` — 6 files below
- `disha-cinematic/public/checkout/` — 1 files below
- `disha-cinematic/public/css/` — 1 files below
- `disha-cinematic/public/js/` — 2 files below
- `disha-cinematic/public/pay/` — 1 files below
- `disha-cinematic/public/vendor/` — 1 files below
- `dist/` — 71 files below
- `dist/assets/` — 23 files below
- `dist/assets/icons/` — 6 files below
- `dist/checkout/` — 1 files below
- `dist/css/` — 1 files below
- `dist/js/` — 2 files below
- `dist/pay/` — 1 files below
- `dist/vendor/` — 1 files below
- `docs/` — 9 files below
- `financial/` — 7 files below
- `middleware/` — 1 files below
- `migrations/` — 2 files below
- `postman/` — 5 files below
- `public/` — 71 files below
- `public/assets/` — 23 files below
- `public/assets/icons/` — 6 files below
- `public/checkout/` — 1 files below
- `public/css/` — 1 files below
- `public/js/` — 2 files below
- `public/pay/` — 1 files below
- `public/vendor/` — 1 files below
- `routes/` — 1 files below
- `routes/admin/` — 1 files below
- `scripts/` — 7 files below
- `tests/` — 53 files below
- `tests/android/` — 9 files below
- `tests/android/upi-receiver/` — 6 files below
- `tests/android/upi-receiver/app/` — 4 files below
- `tests/android/upi-receiver/app/src/` — 3 files below
- `tests/android/upi-receiver/app/src/main/` — 3 files below
- `tests/android/upi-receiver/app/src/main/java/` — 2 files below
- `tests/android/upi-receiver/app/src/main/java/ai/` — 2 files below
- `tests/android/upi-receiver/app/src/main/java/ai/disha/` — 2 files below
- `tests/android/upi-receiver/app/src/main/java/ai/disha/testupi/` — 2 files below
- `utils/` — 7 files below
- `workflows/` — 4 files below
- `workflows/n8n/` — 4 files below
- `zero-trust-fintech-production/` — 56 files below
- `zero-trust-fintech-production/app/` — 30 files below
- `zero-trust-fintech-production/app/api/` — 4 files below
- `zero-trust-fintech-production/app/core/` — 9 files below
- `zero-trust-fintech-production/app/middleware/` — 2 files below
- `zero-trust-fintech-production/app/models/` — 3 files below
- `zero-trust-fintech-production/app/services/` — 10 files below
- `zero-trust-fintech-production/migrations/` — 4 files below
- `zero-trust-fintech-production/migrations/versions/` — 2 files below
- `zero-trust-fintech-production/n8n/` — 5 files below
- `zero-trust-fintech-production/n8n/workflows/` — 4 files below
- `zero-trust-fintech-production/n8n/workflows/production/` — 2 files below
- `zero-trust-fintech-production/scripts/` — 1 files below
- `zero-trust-fintech-production/tests/` — 4 files below
