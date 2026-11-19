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
