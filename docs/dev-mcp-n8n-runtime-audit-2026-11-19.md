# DISHA 8.2 — VS Code, Kilo, MCP and n8n Runtime Audit
Checked 19 November 2026 against the tracked repository tree and the Railway service deployment configuration.

## Decisions

| Path | Actual role | Action |
|---|---|---|
| `.vscode/mcp.json` | VS Code remote MCP endpoint declarations (GitHub, Railway, Cloudflare, Clerk, Resend, n8n Cloud) | **KEEP**: local agent development configuration, not server runtime |
| `.kilo/kilo.jsonc` | Kilo MCP definitions, including Railway CLI and GitHub | **KEEP**: user has active Kilo tooling; no evidence safe to delete |
| `.kilo/agents/` | Two design/content agents | **KEEP**: optional developer agents, not payment handlers |
| `.continue/mcpServers/n8n-cloud.yaml` | Windows-specific Continue n8n Cloud MCP connection | **KEEP**, but it is an editor configuration; endpoint authorization has not been verified |
| `.vscode/tasks.json` | Previously three dead PowerShell n8n tasks pointing to missing `forensic-upi-intent-engine/scripts/windows/n8n.ps1` | **FIXED**: replaced with actual build/lint/test commands |
| `.vscode/extensions.json` | Empty extension recommendations | **REMOVED**: no configured recommendations |
| `workflows/n8n/` | Four stored n8n workflow definitions | **KEEP DORMANT** until a reviewed n8n instance imports and verifies them |
| `zero-trust-fintech-production/n8n/` | Separate Python service workflow definitions | **KEEP**; not shown to be running in the Railway Node service |
| `zero-trust-fintech-production/app/services/n8n_webhook.py` | Python orchestrator with configured HTTP integration | **KEEP**; this Python service is independent of the deployed Node app |

## Actual production boundary

Railway starts `node server.js`. Root `package.json` does not start n8n. Neither a VS Code MCP declaration nor a workflow JSON file proves an n8n workflow is active, reachable, authorized or connected to bank statements. The Node financial reconciliation route initializes only when `RECONCILIATION_WEBHOOK_SECRET` and `RECONCILIATION_SOURCE_ID` are configured. These keys were absent from the accessible production Railway variable-name inventory.

**Do not remove n8n workflows to make a “clean” repository:** they represent design work but are not a verified production credit source. They also must never create a SUCCESS state from browser return, customer UTR input or a test-only receipt. A proper external credit source remains a release prerequisite.

## Protected production and agent assets

- Preserve `public/` as the canonical frontend. Keep `dist/` and `disha-cinematic/{public,dist}/` in sync until all deployed Pages configurations are migrated.
- Preserve `financial/`, `migrations/`, `db.js`, `server.js`, `merchant-api.js`, `platform-control.js`, and PostgreSQL integration tests.
- Do not commit MCP tokens, personal credentials, test credentials or bank account secrets to the repository.
- Account classification for the same payment is immutable after order creation. P2P is PERSONAL without `mc/tr`, and bank-approved P2M is MERCHANT with its genuine MCC and an order-specific `tr`.
- An emulator checks app handoff but cannot validate a bank or PSP's decision before PIN.
