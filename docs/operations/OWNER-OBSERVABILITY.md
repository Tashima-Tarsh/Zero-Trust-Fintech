# DISHA 8.2 — Owner observability setup

This feature replaces **hardcoded** Not connected labels with owner-authorized read-only probes, plus a privacy-minimized browser error collector. It does **not** modify payout, ledger, UPI settlement, or transaction-state logic.

## Available without further external credentials

- **Platform API:** first-party `/health` check.
- **PostgreSQL:** read-only `pg_stat_activity` connection count, active count, max connections and query latency, using the existing DISHA database pool.
- **GitHub Actions:** public main-branch workflow runs for `Tashima-Tarsh/Zero-Trust-Fintech`; an optional token improves rate limits and supports private repos. Success here **does not** establish a production deploy or real payment acceptance.
- **Frontend errors:** `/api/platform/public/frontend-error` stores one sanitized category and canonical page per event in a new operational table; an OPEN WARNING incident is deduplicated for one hour. Rate-limited to 12 reports/hour/IP. Never record messages, raw URLs, user IDs, stacks, bank details, QR data, PINs, passkeys or tokens. Client reports remain untrusted.
- **Reconciliation webhook inbox:** existing `disha_reconciliation_inbox` rows are counted for the last 24 hours. This is **inbound processing**, not outbound delivery and not a bank-link guarantee. If schema is absent, explicitly show Not configured.

## Railway (deployment metadata)

Add the following environment variables **only to the DISHA backend Railway service** (not GitHub or Cloudflare public build variables):
- `DISHA_MONITOR_RAILWAY_TOKEN`: token with read-only access to the *actual DISHA* project/environment.
- `DISHA_MONITOR_RAILWAY_PROJECT_ID`
- `DISHA_MONITOR_RAILWAY_SERVICE_ID`
- `DISHA_MONITOR_RAILWAY_ENVIRONMENT_ID`

The owner backend uses Railway's official GraphQL `deployments` query. A connected probe reports the most recent deployment status and creation timestamp; it does not describe CPU/memory metrics or prove runtime payment health.

## Cloudflare (edge analytics)

- `DISHA_MONITOR_CLOUDFLARE_TOKEN`: token with zone read/GraphQL analytics access.
- `DISHA_MONITOR_CLOUDFLARE_ZONE_ID`: 32-char zone ID for `thenitishkr.in`.

The probe uses the `httpRequestsAdaptiveGroups` dataset for sampled eyeball requests and transferred bytes over the last hour. A missing or unauthorized dataset reports Unavailable, not healthy.

## n8n (workflow execution monitoring)

- `DISHA_MONITOR_N8N_URL`: public HTTPS origin of **your actual n8n instance**.
- `DISHA_MONITOR_N8N_API_KEY`: n8n API key with execution-read access.

The probe checks `/healthz/readiness`, then retrieves 20 recent `/api/v1/executions`. With URL only, it shows Partially connected (readiness ≠ workflow execution monitoring).

## What is intentionally not claimed

- No outbound webhook *delivery* queue was found in the project. The panel is correctly named **Reconciliation webhook intake**, and displays Partially connected where inbound receipts exist.
- Railway, Cloudflare and n8n cannot be marked connected until **their genuine deployment service credentials** are configured. Never paste them into ChatGPT messages, commits or client code.
- Errors in any probe return Unavailable. All reads are owner-only, cached for 45 seconds, and bounded by 4.5-second deadlines.
- The connected Railway account used in the earlier assessment exposed only `patient-presence`, **not DISHA**. Do not use its IDs or alter it.

Sources:
- Railway API: https://docs.railway.com/integrations/api/manage-deployments
- Cloudflare GraphQL: https://developers.cloudflare.com/analytics/graphql-api/migration-guides/graphql-api-analytics/
- n8n health: https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/monitor-n8n/
