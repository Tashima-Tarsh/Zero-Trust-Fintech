-- ═══════════════════════════════════════════════════════════════════
-- DISHA 8.2 — Enterprise Sovereign Payment Rail Schema
-- Compatible with PostgreSQL 13+ and SQLite
-- ═══════════════════════════════════════════════════════════════════

-- 1. Double-Entry Chart of Accounts
CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(16) NOT NULL CHECK(type IN ('ASSET', 'REVENUE', 'EXPENSE', 'LIABILITY')),
    merchant_id VARCHAR(64) NOT NULL DEFAULT 'mer_default',
    created_at BIGINT NOT NULL
);

-- Seed Default Accounts for Double-Entry Bookkeeping
INSERT INTO accounts (id, code, name, type, merchant_id, created_at)
VALUES 
    ('acc_bank_01', '1010-BANK', 'Direct Bank Settlement Account', 'ASSET', 'mer_default', 1700000000000),
    ('acc_rev_01', '4010-REVENUE', 'Zero-Commission Merchant Sales', 'REVENUE', 'mer_default', 1700000000000),
    ('acc_fee_01', '5010-FEES', 'Aggregator Gateway Fees (Zero in DISHA)', 'EXPENSE', 'mer_default', 1700000000000)
ON CONFLICT (code) DO NOTHING;

-- 2. VPA Pool for Ban Prevention and Smart Rotation
CREATE TABLE IF NOT EXISTS vpa_pool (
    id VARCHAR(64) PRIMARY KEY,
    vpa_address VARCHAR(128) UNIQUE NOT NULL,
    bank_name VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED', 'COOLDOWN')),
    health_score INT NOT NULL DEFAULT 95 CHECK(health_score BETWEEN 0 AND 100),
    daily_tx_limit INT NOT NULL DEFAULT 30,
    daily_volume_limit NUMERIC(12, 2) NOT NULL DEFAULT 50000.00,
    daily_tx_count INT NOT NULL DEFAULT 0,
    daily_volume NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    last_used_at BIGINT,
    cooldown_until BIGINT NOT NULL DEFAULT 0,
    merchant_id VARCHAR(64) NOT NULL DEFAULT 'mer_default',
    created_at BIGINT NOT NULL
);

-- Seed Primary Merchant VPAs
INSERT INTO vpa_pool (id, vpa_address, bank_name, status, health_score, daily_tx_limit, daily_volume_limit, merchant_id, created_at)
VALUES 
    ('vpa_axis_01', 'disha82@okaxis', 'Axis Bank', 'ACTIVE', 98, 30, 50000.00, 'mer_default', 1700000000000),
    ('vpa_icici_02', 'disha82@icici', 'ICICI Bank', 'ACTIVE', 96, 30, 50000.00, 'mer_default', 1700000000000),
    ('vpa_yes_03', 'disha82@ybl', 'YES Bank', 'ACTIVE', 94, 30, 50000.00, 'mer_default', 1700000000000)
ON CONFLICT (vpa_address) DO NOTHING;

-- 3. Sessions & Orders
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) UNIQUE NOT NULL,
    challenge_amount NUMERIC(10, 2) NOT NULL,
    base_amount NUMERIC(10, 2) NOT NULL,
    txn_ref VARCHAR(128) UNIQUE NOT NULL,
    vpa_address VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SUCCESS', 'EXPIRED', 'FAILED')),
    utr VARCHAR(32),
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    qr_refresh_at BIGINT NOT NULL
);

-- 4. Transactions Ledger
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL,
    utr VARCHAR(32) UNIQUE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(32) NOT NULL,
    vpa_used VARCHAR(128) NOT NULL,
    created_at BIGINT NOT NULL
);

-- 5. Double-Entry Ledger Postings
CREATE TABLE IF NOT EXISTS ledger_entries (
    id VARCHAR(64) PRIMARY KEY,
    transaction_id VARCHAR(64) NOT NULL,
    account_id VARCHAR(64) NOT NULL REFERENCES accounts(id),
    entry_type VARCHAR(16) NOT NULL CHECK(entry_type IN ('DEBIT', 'CREDIT')),
    amount NUMERIC(10, 2) NOT NULL,
    created_at BIGINT NOT NULL
);

-- 6. UTR Blacklist for Replay Attack Prevention
CREATE TABLE IF NOT EXISTS blacklist_utrs (
    utr VARCHAR(32) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    blacklisted_at BIGINT NOT NULL,
    reason VARCHAR(256) NOT NULL
);

-- Indexes for Microsecond Performance
CREATE INDEX IF NOT EXISTS idx_sessions_order_id ON sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_txn_ref ON sessions(txn_ref);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_vpa_pool_status ON vpa_pool(status, daily_tx_count);
