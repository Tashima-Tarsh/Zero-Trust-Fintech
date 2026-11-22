'use strict';
/**
 * Additive checkout-session schema repair for existing PostgreSQL installations.
 * CREATE TABLE IF NOT EXISTS in schema.sql does not add columns to a table that
 * already exists. Railway production may therefore have a pre-upi_uri schema.
 *
 * No data migration, table recreation, index removal or financial-row mutation.
 * Safe to re-run after deploys; intentionally leaves old QR values NULL.
 */
async function ensureCheckoutSessionSchema(pg) {
  if (!pg || typeof pg.query !== 'function') throw new TypeError('PostgreSQL client required');
  await pg.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS upi_uri TEXT");
  await pg.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS payment_type TEXT CHECK(payment_type IN ('P2P','P2M'))");
  await pg.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'WAITING'");
  await pg.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS customer_id TEXT");

  // Fail at startup, not on the first customer's GET /api/session/new.
  const result = await pg.query(
    "SELECT column_name FROM information_schema.columns " +
    "WHERE table_schema=current_schema() AND table_name='sessions' " +
    "AND column_name IN ('upi_uri','state','customer_id','payment_type')"
  );
  const found = new Set(result.rows.map(row => row.column_name));
  for (const name of ['upi_uri', 'state', 'customer_id', 'payment_type']) {
    if (!found.has(name)) throw new Error('POSTGRES_CHECKOUT_SCHEMA_MISSING_' + name.toUpperCase());
  }
}
module.exports = { ensureCheckoutSessionSchema };
