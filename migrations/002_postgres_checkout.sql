-- PostgreSQL checkout state additions, run only after a verified restore plan.
-- This migration is additive and safe to repeat; it does not import records.

ALTER TABLE vpa_pool ADD COLUMN IF NOT EXISTS mcc TEXT;
-- Existing Railway Postgres deployments may predate these session fields.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'WAITING';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS upi_uri TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS payment_type TEXT CHECK(payment_type IN ('P2P','P2M'));
DROP INDEX IF EXISTS idx_sessions_unique_active_amount;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_state_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_state_check
  CHECK (state IN ('WAITING','VERIFY_WINDOW','VERIFIED','EXPIRED','REJECTED','CANCELLED'));

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at BIGINT NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pg_passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS vpa_hourly_txns (
  vpa_address TEXT NOT NULL,
  hour_bucket BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY(vpa_address,hour_bucket)
);
CREATE TABLE IF NOT EXISTS session_cooldowns (
  order_id TEXT PRIMARY KEY,
  last_cancel_at BIGINT NOT NULL,
  cooldown_until BIGINT NOT NULL
);

-- Native Postgres journal accounts, same IDs as legacy accounts (projection).
INSERT INTO disha_core_accounts (account_id,merchant_id,account_type)
VALUES ('acc_bank_01','mer_default','ASSET'), ('acc_rev_01','mer_default','REVENUE')
ON CONFLICT (account_id) DO NOTHING;

-- UTR claims from untrusted sources (customer receipts, CFC, vault evidence)
-- Used by reconcileCreditWithUtrClaim to prevent UTR reuse across orders
CREATE TABLE IF NOT EXISTS disha_untrusted_utr_claims (
    order_id TEXT NOT NULL,
    utr TEXT NOT NULL,
    source TEXT NOT NULL,
    observed_at BIGINT NOT NULL,
    PRIMARY KEY (utr, order_id)
);
CREATE INDEX IF NOT EXISTS idx_disha_untrusted_utr_claims_utr ON disha_untrusted_utr_claims(utr);
CREATE INDEX IF NOT EXISTS idx_disha_untrusted_utr_claims_order ON disha_untrusted_utr_claims(order_id);
