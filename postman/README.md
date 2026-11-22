# DISHA 8.2 — Legacy API collections (manual review only)

The current implementation contract is maintained in [TDD/IDD](../docs/architecture/SYSTEM-ARCHITECTURE.md), [flow](../docs/architecture/END-TO-END-FLOW.md), and [release plan](../docs/architecture/TEST-AND-RELEASE.md).

The collection and runner here are **legacy diagnostic helpers**. They may describe retired Render endpoints or unimplemented routes. They are not evidence that a live UPI transaction succeeded, and are not used by the standard Node/PostgreSQL/Android CI acceptance gates.

## Safe operation

- Local Postman environment is the default; all merchant identity, password and VPA values are intentionally empty. Supply your own authorized values **locally**, never commit them.
- The runner refuses the production-named environment unless the operator explicitly sets `DISHA_ALLOW_PROD_POSTMAN=1`. Review every request and side effect before using that override.
- Never execute a simulated settlement or a state-changing test against a live merchant database. Never enter customer UPI PIN, passkeys or production secrets into tracked files.
- The former root-level duplicate `disha-api.postman_collection.json` and its sample-password environment were retired from the working tree. See the cleanup log.

Use `node postman/test-runner.js DISHA_8.2_Local.postman_environment.json` only with an isolated local backend after verifying the test URLs. Keep Postman manual API exploration separate from physical UPI app acceptance and production release authorization.
