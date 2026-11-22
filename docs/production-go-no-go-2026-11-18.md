# DISHA 8.2 — Production Go/No-Go Assessment
18 November 2026 | Owner-controlled UPI P2P/P2M payment software

## Decision: **NO-GO for onboarding external merchants for real-money acceptance**

This is a release gate, not an assertion that the server is down. Code and PostgreSQL invariants passing are not a substitute for bank acceptance or a live end-to-end settlement test.

| Gate | Observed status | Evidence or remaining task |
|---|---|---|
| Repository static and unit tests | PASS | Root GitHub Actions DISHA 8.2 CI, commit 04171a56385b |
| PostgreSQL financial invariant suite | PASS | Actions PostgreSQL financial invariants, run 44372657708 |
| Railway production boot | PASS | Node and PostgreSQL checkout authority started, invite-only tenant control enabled |
| Canonical frontend distribution | PASS | All public assets synchronized across dist and legacy Pages roots; no-op builds replaced |
| Android intent emulator API 37 | PASS | Android CI fixture, no real bank transfer |
| Android intent emulator API 35 | RUNNING at inspection | Android CI fixture; check completion before release |
| P2P ₹1 real bank app, before-PIN | **NOT VERIFIED** | User reports a pre-PIN failure; confirm payee VPA is accepting requests and record actual bank/app reason |
| P2M real registered merchant & MCC | **NOT VERIFIED** | Bank/acquirer must confirm merchant registration and issued MCC; existing company tenant remains paused |
| Live financial credit callback/reconciliation | **NOT CONNECTED** | Production Railway configuration does not include RECONCILIATION_WEBHOOK_SECRET or RECONCILIATION_SOURCE_ID |
| Browser return does not create paid outcome | PASS (code/tests) | Vault evidence is observation only; false success prevented in regression tests |
| Three-minute payment session | PASS (source/tests) | Backend expiry applied; displayed on all stages; app return does not auto-create a failed status |
| Non-destructive data reset | PREPARED, NOT RUN | Requires verified PostgreSQL backup and maintenance mode; no historical records deleted |
| Security/IP authorization unit tests | PASS | Deterministic key/IP tests are now compulsory; obsolete seeded-key test removed |
| Penetration/security review | NOT VERIFIED | No external owner-authorized penetration test or independent security sign-off |

## Fixes applied

1. Removed the payment-description disguise and required valid P2M MCC at URI creation before saving payment sessions.
2. Personal P2P URI stays free of merchant-only parameters; public checkout rejects tenant/payee substitution.
3. Buyer-facing countdown now follows the server's session expiry on every stage.
4. Browser focus alone cannot be interpreted as an external UPI app return or financial failure.
5. Cloudflare/Railway copies are synchronized to `public/`; actual `npm run build` copies assets instead of falsely reporting success.
6. Hard-coded seeded IP security test removed and replaced with deterministic fail-closed checks.
7. Android and PostgreSQL workflow paths expanded so payment changes trigger specialized validation.
8. Full folder inventory is maintained in `docs/repository-folder-inventory-2026-11-18.md`.

## Required acceptance before an external merchant GO

- Live ₹1 P2P payment reaches the UPI PIN screen, succeeds and the beneficiary account balance/statement confirms credit; verify wrong PIN, app cancel, insufficient balance, and app not installed.
- Live bank-approved P2M VPA and MCC pass the same device matrix without changing into a personal transfer.
- Configure and test an authenticated financial event source, retry/idempotency handling and matching journal posting. No browser callback alone may create SUCCESS.
- Record and approve a complete Android device matrix and failure/expiry cases, including API 35 and 37 emulator results.
- Prove owner/merchant tenant isolation, secrets storage, backup/restore and error-monitoring coverage, then rerun full CI.

## Architectural constraints and remaining technical debt

The root Node service is deployed on Railway; the Python `zero-trust-fintech-production/` service is a separate codebase with its own workflow and is not evidence of an active Railway Python deployment. Editor agent folders (`.kilo/`, `.vscode/`, `.continue/`) were retained. Static site mirrors are generated deployment targets, not safe-to-delete clutter. Root server tests historically skipped some integration failures, so mandatory deterministic unit tests and specialized CI were strengthened, but this does not replace real-device payment testing.

## 19 November 2026 production hardening addendum

**Current decision remains NO-GO for unmonitored external real-money merchant onboarding.** Passing a checkout URL test and a simulated Android intent test is not a bank-side authorization or an authenticated funds-credit callback.

- **Immutable merchant intent:** New `saas_merchant_orders` rows snapshot `payee_name`, `payee_account_type`, and `payee_mcc`. Existing links no longer change P2P/P2M fields after a merchant edits a receiving account. Migration is additive and preserves historical records. Full PostgreSQL merchant integration tests were added and passed.
- **Pre-PIN fail closed:** Missing/invalid P2M MCC and unknown account types reject order creation before writing the session. P2P continues to carry only personal-payee parameters.
- **Public checkout isolation:** All `/api/session/new` requests default to the owner-configured personal receiving VPA, never the legacy shared pool; another tenant VPA in query is rejected.
- **Session recovery:** A cached but expired unpaid session cannot be reused when returning to the checkout. An already posted verified receipt can still be retrieved.
- **Visible bank-facing intent details:** Both checkout variants show configured payment type and receiving VPA below the amount. These are configuration details, **not a claim of verified bank onboarding**.
- **Owner release gate:** Owner Settings displays separate P2P, P2M, company activation, and financial-credit source status; it reports NO-GO until independent bank acceptance and reconciliation are verified.
- **Developer cleanup:** Removed empty VS Code extension file; replaced broken PowerShell tasks; kept the GitHub/Railway/Clerk/Cloudflare/n8n MCP settings and Kilo workflows because they are legitimate user IDE configurations. See `docs/dev-mcp-n8n-runtime-audit-2026-11-19.md`.
- **Production blocker:** Reconciliation credentials (credit evidence source ID and HMAC secret) are not present in Railway. The bank or acquirer must establish valid P2M merchant eligibility and UPI status infrastructure. This cannot be satisfied by installing n8n or adding frontend code alone.
- **Data cleanup:** Historical ledgers and settlements have **not** been deleted. The destructive reset remains gated by verified backup, maintenance mode and explicit execution.
