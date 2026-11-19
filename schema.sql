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

-- 2. VPA Pool for 1000-VPA Anti-Ban Smart Rotation & Personal Accounts
CREATE TABLE IF NOT EXISTS vpa_pool (
    id VARCHAR(64) PRIMARY KEY,
    vpa_address VARCHAR(128) UNIQUE NOT NULL,
    holder_name VARCHAR(128),
    bank_name VARCHAR(64) NOT NULL,
    account_type VARCHAR(20) NOT NULL DEFAULT 'PERSONAL',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'COOLDOWN', 'FLAGGED', 'BANNED', 'RETIRED', 'PAUSED')),
    health_score INT NOT NULL DEFAULT 100 CHECK(health_score BETWEEN 0 AND 100),
    risk_level VARCHAR(10) NOT NULL DEFAULT 'LOW' CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    preferred_time_slot VARCHAR(20) NOT NULL DEFAULT 'ANY' CHECK(preferred_time_slot IN ('MORNING', 'AFTERNOON', 'EVENING', 'ANY')),
    active_hours_start INT NOT NULL DEFAULT 8,
    active_hours_end INT NOT NULL DEFAULT 22,
    daily_tx_limit INT NOT NULL DEFAULT 15,
    daily_volume_limit NUMERIC(12, 2) NOT NULL DEFAULT 25000.00,
    per_tx_limit NUMERIC(12, 2) NOT NULL DEFAULT 5000.00,
    unique_senders_daily_limit INT NOT NULL DEFAULT 12,
    daily_tx_count INT NOT NULL DEFAULT 0,
    daily_volume NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    unique_senders_today INT NOT NULL DEFAULT 0,
    min_gap_minutes INT NOT NULL DEFAULT 8,
    last_used_at BIGINT,
    cooldown_until BIGINT NOT NULL DEFAULT 0,
    merchant_id VARCHAR(64) NOT NULL DEFAULT 'mer_default',
    notes TEXT,
    excel_row_id VARCHAR(50),
    created_at BIGINT NOT NULL
);

-- VPA Usage Log for pattern analysis and anti-ban telemetry
CREATE TABLE IF NOT EXISTS vpa_usage_log (
    id VARCHAR(64) PRIMARY KEY,
    vpa_id VARCHAR(64) NOT NULL,
    merchant_id VARCHAR(64) NOT NULL,
    transaction_id VARCHAR(64),
    amount NUMERIC(12, 2) NOT NULL,
    customer_vpa VARCHAR(128),
    customer_region VARCHAR(64),
    time_slot VARCHAR(20),
    used_at BIGINT NOT NULL
);

-- VPA Health Events for warning signs and degradation
CREATE TABLE IF NOT EXISTS vpa_health_events (
    id VARCHAR(64) PRIMARY KEY,
    vpa_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT,
    health_impact INT DEFAULT 0,
    created_at BIGINT NOT NULL
);

-- VPA Sender Tracking (Prevent same sender hitting same VPA multiple times per day)
CREATE TABLE IF NOT EXISTS vpa_sender_tracking (
    id VARCHAR(64) PRIMARY KEY,
    vpa_id VARCHAR(64) NOT NULL,
    customer_vpa VARCHAR(128) NOT NULL,
    tracking_date VARCHAR(10) NOT NULL,
    tx_count INT DEFAULT 1,
    last_seen BIGINT NOT NULL,
    UNIQUE(vpa_id, customer_vpa, tracking_date)
);

-- Production intentionally has no fabricated receiving UPI accounts.
-- The platform owner's real receiving VPAs are provisioned from secured
-- Railway environment configuration into an isolated internal tenant.

-- 3. Sessions & Orders
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) UNIQUE NOT NULL,
    challenge_amount NUMERIC(10, 2) NOT NULL,
    base_amount NUMERIC(10, 2) NOT NULL,
    txn_ref VARCHAR(128) UNIQUE NOT NULL,
    vpa_address VARCHAR(128) NOT NULL,
    upi_uri TEXT, -- Immutable issued bank-scannable QR and native intent payload
    payment_type VARCHAR(3) CHECK(payment_type IN ('P2P','P2M')), -- Explicit immutable issued mode; NULL for unclassifiable historical sessions
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SUCCESS', 'EXPIRED', 'FAILED')),
    utr VARCHAR(32),
    state VARCHAR(32) NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING', 'VERIFY_WINDOW', 'VERIFIED', 'EXPIRED')),
    customer_id VARCHAR(128),
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    qr_refresh_at BIGINT NOT NULL
);
-- Uniqueness is enforced by order_id, txn_ref and UTR binding, not by amount.
-- Different customers may legitimately pay the same amount to the same VPA.

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

-- 7. UTR-Order Binding (Layer 4: Cross-Order UTR Reuse Prevention)
-- A UTR is bound to the first order it is submitted for. It can never be
-- used on a different order, even with the same amount.
CREATE TABLE IF NOT EXISTS utr_order_bindings (
    utr VARCHAR(32) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL,
    bound_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_utr_order_bindings_order ON utr_order_bindings(order_id);

-- UTR claims from untrusted sources (customer receipts, CFC, vault evidence)
CREATE TABLE IF NOT EXISTS disha_untrusted_utr_claims (
    order_id VARCHAR(64) NOT NULL,
    utr VARCHAR(32) NOT NULL,
    source VARCHAR(64) NOT NULL,
    observed_at BIGINT NOT NULL,
    PRIMARY KEY (utr, order_id)
);
CREATE INDEX IF NOT EXISTS idx_disha_untrusted_utr_claims_utr ON disha_untrusted_utr_claims(utr);
CREATE INDEX IF NOT EXISTS idx_disha_untrusted_utr_claims_order ON disha_untrusted_utr_claims(order_id);

-- Indexes for Microsecond Performance
CREATE INDEX IF NOT EXISTS idx_sessions_order_id ON sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_txn_ref ON sessions(txn_ref);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_vpa_pool_status ON vpa_pool(status, daily_tx_count);

-- Receipt image hash dedup (prevents same-image replay across orders)
CREATE TABLE IF NOT EXISTS image_hashes (
    id VARCHAR(64) PRIMARY KEY,
    image_hash VARCHAR(64) UNIQUE NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    seen_at BIGINT NOT NULL,
    reason VARCHAR(256) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_hashes_hash ON image_hashes(image_hash);
CREATE INDEX IF NOT EXISTS idx_image_hashes_order ON image_hashes(order_id);

-- Gaming Companies (Tenants)
CREATE TABLE IF NOT EXISTS gaming_companies (
    id VARCHAR(64) PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    contact_email VARCHAR(200) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_secret VARCHAR(128) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
    created_at BIGINT NOT NULL,
    last_active_at BIGINT
);

-- IP Whitelist per Gaming Company
CREATE TABLE IF NOT EXISTS ip_whitelist (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL REFERENCES gaming_companies(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    ip_range VARCHAR(50),
    description VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    added_by VARCHAR(64),
    added_at BIGINT NOT NULL,
    last_used_at BIGINT,
    UNIQUE(company_id, ip_address)
);

-- API Access Logs (Audit Trail)
CREATE TABLE IF NOT EXISTS api_access_log (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) REFERENCES gaming_companies(id),
    ip_address VARCHAR(45) NOT NULL,
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER NOT NULL,
    request_body TEXT,
    response_body TEXT,
    user_agent TEXT,
    accessed_at BIGINT NOT NULL
);

-- Blocked IP Attempts (Security Monitoring)
CREATE TABLE IF NOT EXISTS blocked_ip_attempts (
    id VARCHAR(64) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    company_id VARCHAR(64) REFERENCES gaming_companies(id),
    endpoint VARCHAR(200) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    attempt_count INTEGER DEFAULT 1,
    first_attempt BIGINT NOT NULL,
    last_attempt BIGINT NOT NULL,
    UNIQUE(ip_address, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_whitelist_company ON ip_whitelist(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_whitelist_ip ON ip_whitelist(ip_address);
CREATE INDEX IF NOT EXISTS idx_access_log_company ON api_access_log(company_id, accessed_at);
CREATE INDEX IF NOT EXISTS idx_blocked_ip ON blocked_ip_attempts(ip_address, last_attempt);
