# Railway production: controlled SQLite -> PostgreSQL cutover

## Preflight evidence (2026-11-18)
`SQLITE_INTEGRITY_OK` on the mounted `/data/disha82.db` reported:
3 accounts, 5 VPA records, 0 sessions, 0 passkeys, 0 transactions,
0 ledger entries, 0 UTR bindings, and 0 rows in the remaining tracked tables.
Earlier ephemeral `/app/disha82.db` history is not necessarily recovered.
Do not represent these counts as proof of complete historical preservation.

## Safety sequence
1. Pin Railpack to Node 22.16.0 (node:sqlite is absent from Node 20).
2. Deploy `node scripts/migration-maintenance.js`, where /health returns
   200 while all other requests return 503. Confirm the previous application
   deployment is retired and payments cannot create new sessions.
3. Run `MIGRATION_ACK=BACKUP_VERIFIED node scripts/migrate-sqlite-to-postgres.js --apply`
   from the Railway instance that has the mounted `/data` volume and
   DATABASE_URL. The importer snapshots source SQLite to the volume, checks
   source integrity, writes the snapshot into PostgreSQL's **separate storage
   volume** as a bytea archive with a verified SHA-256, imports transactionally,
   compares all source records, checks no source drift, and writes
   `disha_migration_control` only on commit. A failed import rolls back.
4. Start the application with `DB_BACKEND=postgres node server.js`.
   It refuses startup unless the migration marker exists.
5. Check Railway logs for `POSTGRES_ARCHIVE_VERIFIED`,
   `POSTGRES_MIGRATION_VERIFIED`, and
   `PostgreSQL is the sole checkout authority`.
6. Validate merchant routing, checkout creation/status, WebAuthn, ledger,
   UTR anti-replay, and persistence through a new deploy.
7. Restore the permanent command to `node server.js` with the
   **DB_BACKEND=postgres** environment variable set.
8. Do not delete the source SQLite file, its volume snapshot, or the SQL
   archive. Preserve them for audited recovery.

## Recoverability
If the migration fails, keep the maintenance server live, investigate logs,
and restore the previous SQLite deployment only after checking whether any
new checkout writes were committed to PostgreSQL.
The SQLite volume is independent from PostgreSQL's volume; the archive inside
PostgreSQL is **not an off-provider backup**, and a third independent backup
remains recommended for disaster recovery.

Never treat green CI as equivalent to live data-parity evidence.
