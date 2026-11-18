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
