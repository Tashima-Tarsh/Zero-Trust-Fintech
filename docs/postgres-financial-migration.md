# PostgreSQL authority migration: financial correctness first

## Decision

Make the existing Railway PostgreSQL service the **single authoritative store** for merchant payments. Do not declare the migration complete by setting DATABASE_URL: current db.js still initializes SQLite first and writes sessions, passkeys, UTR bindings, and journals there.

This change introduces a new **additive, not yet live** PostgreSQL financial journal with transactional invariants and real-Postgres CI. Its SQL is under `migrations/001_financial_core.sql`, its private application API under `financial/postgres-ledger.js`. Existing checkout and ledger remain unchanged until full migration.

## Mathematical invariants implemented

For each posted journal `j`:

1. **Exact representation:** `amount_paise(j)` is a strictly positive 64-bit integer. Input decimal amounts are parsed as strings, never binary floating point; `rupeesToPaise("500.01") = "50001"`.
2. **Conservation:** `sum(DEBIT.amount_paise) = sum(CREDIT.amount_paise) = j.amount_paise`. This version requires exactly two postings: one debit and one credit. The database enforces this at transaction commit using a deferred constraint trigger.
3. **Non-duplication:** `UNIQUE(utr)`, `UNIQUE(idempotency_key)`, `UNIQUE(merchant_id, order_id)` prevent replay of a payment reference or order.
4. **Atomicity:** a `SERIALIZABLE` transaction inserts a journal and its postings and marks the journal posted. An error, a concurrent collision, or an unbalanced journal rolls the transaction back entirely.
5. **Immutability:** once a journal is posted, its fields and posting rows cannot be changed.
6. **Isolation:** both postings must reference accounts belonging to the journal's merchant.

These are enforceable **accounting consistency guarantees**. They do not cryptographically prove an external UPI transfer: a passkey signature attests to a device/user action, while an internal ledger entry attests to the application writing a balanced journal. Keeping the two meanings separate is essential to an auditable system.

## Migration sequence before production cutover

**Safety gate:** the current Railway service has a volume at `/data`, but the live SQLite file is under `/app/disha82.db`. A new deployment may replace that ephemeral file. Obtain a consistent SQLite backup from the running container and take an independent protected backup before any cutover. Confirm recovery by opening the backup read-only and checking `PRAGMA integrity_check` and table counts. If the old container has already been replaced, investigate recoverability rather than inventing missing history.

1. **Inventory:** count rows and SHA-256 canonicalized exports for `sessions`, `passkeys`, `utr_order_bindings`, `transactions`, `ledger_entries`, `vpa_pool`, and fraud/audit tables. Resolve duplicates, foreign key discrepancies and money rounding *before* import.
2. **Stage:** run migrations only against a backup/restored staging PostgreSQL, never the production instance as an unreviewed command. Import records with stable IDs and exact integer paise, verify counts, sums, duplicates, orphaned references and passkey counters. Do not mark legacy records POSTED without provenance and a balanced journal.
3. **Replace all synchronous SQLite clients:** refactor `db.js`, `server.js`, `vpa-router.js`, `vpa-importer.js`, IP-whitelist/admin routes, and downstream tests to fully asynchronous PostgreSQL queries. Do not leave SQLite as an implicit fallthrough. Explicitly reject unavailable PostgreSQL at startup when `DB_BACKEND=postgres`.
4. **Guarantee checkout semantics:** authenticated registration/access to passkeys, per-order ownership, session token restrictions, replay-resistant UTR binding, and no update that can bypass posted-journal immutability. Commit related ledger and state mutations in one transaction.
5. **Rehearse:** test checkout, passkey registration and authentication, duplicate UTR and concurrent callbacks, bank-app cancellation, anti-replay, power loss/redeploy, rollback, and restore against staging. Run PostgreSQL integration CI on every change.
6. **Cut over:** schedule a write freeze, make final delta export, verify source/target parity, point the app at PostgreSQL under an explicit `DB_BACKEND=postgres` feature gate, and verify runtime logs plus historical state. Keep the SQLite backup unchanged for rollback/forensics.

**Do not merge or deploy this branch to production merely because CI is green.** The core is intentionally not wired to public checkout endpoints and is not a completed SQLite-to-PostgreSQL data migration.

## Running tests

```bash
node tests/test-financial-money.js
TEST_DATABASE_URL=postgresql://disha_test:test_only_not_production@127.0.0.1:5432/disha_financial_ci node tests/test-postgres-financial-core.js
```

The integration test explicitly rejects non-local database hosts. The GitHub workflow `.github/workflows/postgres-financial-core.yml` creates an isolated PostgreSQL 16 instance and executes the SQL constraints against a real database.
