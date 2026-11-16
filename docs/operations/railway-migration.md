# Railway migration and agent connections

Status as of 2026-11-16: PREPARATION ONLY. No migration, DNS cutover, database restore, or Clerk integration has been completed.

## Confirmed blockers

- Railway workspace NITISH KUMAR's Projects shows Trial expired; project brave-gratitude has 0 of 2 services online. An account owner must restore an active plan before deployment.
- This change configures MCP endpoints, not authenticated sessions. Complete each editor's OAuth flow, then verify a read-only account/project call.
- The original Windows checkout at D:\Downloads\Zero-Trust-Fintech is outside this session's writable directories. These changes are on the ops/railway-agent-connections branch, not installed in that checkout.

## Tool connections

Kilo 7.8 uses .kilo/kilo.jsonc with a top-level mcp object. VS Code uses .vscode/mcp.json with a servers object. Both contain GitHub, Railway, Cloudflare, Clerk, and Resend remote endpoints; the existing VS Code n8n connection is retained. No access tokens or secrets belong in these files. Each client maintains its own authentication; one client's login does not authenticate all agents.

In Kilo, run `kilo mcp list`, authenticate each pending server with `kilo mcp auth <name>`, and run the list command again. OAuth access must be reviewed by the account owner. In VS Code, start the configured MCP servers and complete their authentication prompts. Validate repository access, Railway project listing, Cloudflare account/domain access, Clerk application access, and Resend domain listing with read-only tool calls before attempting writes. A model must support tool calling; adding MCP cannot fix a provider/model that rejects tools.

## Data inventory before migration

The repository has TWO SQLite stores in addition to optional PostgreSQL and Redis:

1. Root db.js always initializes disha82.db in the application directory. PostgreSQL is additive, not a replacement for this store. A Railway persistent-volume path change is required before relying on redeploy persistence.
2. disha-cinematic/db.js stores disha.db under DATA_DIR (or disha-cinematic/data). Preserve merchant accounts, sessions, VPAs, orders and notifications. Set DATA_DIR to the persistent volume mount.
3. Inspect the actual Render service definitions, environment variables, disk contents, PostgreSQL data, Redis keys and any background processes. render.yaml alone does not establish what is deployed.

Do not copy live SQLite database files without a consistent backup: use SQLite's online backup mechanism or stop writes and checkpoint/copy the complete database safely. Keep a tested rollback backup.

## Execution sequence after access is restored

1. Resolve and confirm the actual Render services tied to this GitHub repository; inventory domains, deployment branches, databases and disk mounts.
2. Create Railway services matching that inventory. Configure Node compatible with node:sqlite, exact service roots/start commands, /health checks, private PostgreSQL/Redis networking, and persistent SQLite volumes. Start with one replica per SQLite store.
3. Back up and restore PostgreSQL and both SQLite stores; handle Redis according to its actual use. Compare schemas, row counts and application reads. Freeze writes for final synchronization so Render and Railway cannot diverge.
4. Transfer required secrets directly into Railway variables. Never commit them. Check variable references, allowed origins, proxy handling and public URLs.
5. Implement Clerk SDK session verification and a stable Clerk-user-to-merchant mapping; do not treat a browser-provided email or user ID as authenticated. Preserve existing merchant ownership. Configure production domains and test sign-up, verified email, sign-in, sign-out, expired sessions and denied cross-merchant requests.
6. Implement server-side Resend email calls using the verified mail.thenitishkr.in sender domain and a secret API key. Keep authentication email handling explicit: Clerk's built-in email delivery does not automatically use Resend. Test sending to the owner's approved address before enabling application notifications.
7. Link the chosen GitHub branch to Railway autodeploy and Cloudflare Pages deployment. Configure checks so unverified changes do not automatically reach production. Verify fresh commits actually deploy.
8. Change Cloudflare's /api proxy upstream from disha-merchant-saas.onrender.com only after Railway passes health, login, merchant setup, dashboard, API and persistence checks. Verify cookies, CORS, CSP and redirect URLs through the public domain.
9. Exercise restart/redeploy persistence and verify data again. Keep Render available for rollback. Stop old workloads only after final verification and an agreed cutover; do not delete the backups or services as part of preparation.
