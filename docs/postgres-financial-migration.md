# DISHA 8.2 PostgreSQL authority: tested migration, controlled cutover

## Status
The repository now implements a **feature-gated** PostgreSQL checkout state store:
`financial/postgres-store.js` and the existing PostgreSQL ledger.
`DB_BACKEND=postgres` skips SQLite completely and requires a verified
`disha_migration_control` marker in PostgreSQL. Without that marker,
the application refuses to start rather than silently issuing new payment
sessions against an empty database.

**Do not claim a production migration just because CI passes.**
CI exercises a disposable PostgreSQL 16 database, not the live Railway volume.
No automatic production migration or remote backup was performed.

## Proof obligations
- Exact amount representation: `rupeesToPaise("500.01") === "50001"`.
- Posted journals must contain one debit and one credit, each for exactly
  the journal amount, and must be immutable thereafter.
- A UTR, payment order and idempotency key cannot create duplicate journals.
- Ledger, session state, UTR and optional receipt hash commit or roll back together.
- Existing sessions, UTR bindings, passkeys and account records must be preserved.
- Checkout must be exercised with the new PostgreSQL backend, including HTTP,
  WebSocket, passkeys, fraud checks and restore/restart.

These invariants demonstrate **internal financial record integrity**, not
independent evidence that an external UPI payment has been received.

## Prerequisites before the live switch
1. Stop new production checkout writes in a controlled maintenance window.
2. Obtain and verify an **independent off-Railway backup** of
   `/data/disha82.db` plus any SQLite WAL. Also preserve the existing
   Railway volume snapshot. Do not delete the source.
3. Inspect current source SQLite row counts and pending sessions. Confirm the
   previous `/app/disha82.db` history was not lost on an earlier redeploy.
4. Confirm sufficient disk space in `/data` for the migration snapshot.
5. Confirm `DATABASE_URL` is the intended PostgreSQL service; do not paste
   credentials into GitHub or a public terminal.

## On the existing service container (Railway SSH)
Use a Railway CLI authenticated to your account:

```powershell
railway ssh --project 62335465-abaa-4269-ba72-e87ddbba908c --service a487c30e-0424-4bc9-af3a-0ccc9943cf70 --environment production
```

**Read-only inventory:**
```bash
node scripts/migrate-sqlite-to-postgres.js
```

**Only after your independent backup is verified and writes are frozen:**
```bash
MIGRATION_ACK=BACKUP_VERIFIED node scripts/migrate-sqlite-to-postgres.js --apply
```

The script opens SQLite read-only, performs `PRAGMA integrity_check`,
takes an online snapshot in the mounted volume, creates and imports PostgreSQL
tables inside a `SERIALIZABLE` transaction, compares every original field,
and commits the `disha_migration_control` marker only after successful parity.
Any conflict causes a rollback; the SQLite source remains.

Check for `POSTGRES_MIGRATION_VERIFIED` and independently validate the
source and target counts, ledger sums, UTR uniqueness and passkey counters.
If the script fails, do not enable PostgreSQL authority.

## Controlled production cutover
After verification, set the Railway environment variable
`DB_BACKEND=postgres` on the **Zero-Trust-Fintech** application service
and deploy the tested commit. The runtime must report:
`PostgreSQL is the sole checkout authority (DB_BACKEND=postgres)`.

Perform a no-money checkout smoke test and a real end-to-end audit before
enabling transaction traffic. Check historical sessions/passkeys and ledger
in PostgreSQL after restarting the service. Keep backup and maintenance
recovery procedures available.

**Rollback warning:** changing `DB_BACKEND` back to SQLite after new
PostgreSQL writes would strand those new records. Freeze writes and perform
a verified reverse migration or replay before rollback.

## CI coverage
`tests/test-financial-money.js`: exact integer paise.
`tests/test-postgres-financial-core.js`: atomic journal, concurrency,
immutability and FK isolation.
`tests/test-postgres-checkout-store.js`: sessions, passkeys, UTR and
ledger.
`tests/test-postgres-migration.js`: SQLite snapshot, seeded-row
reconciliation and PostgreSQL import parity.
`tests/test-postgres-switch.js`: required migration marker, no SQLite.
`tests/test-postgres-http.js`: Express HTTP checkout and session flow.
