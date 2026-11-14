-- ============================================================================
-- Zero-Trust Fintech Production Database Schema Isolation
-- Isolated schema 'production' prevents collisions with forensic-upi-intent-engine
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS production;
SET search_path TO production, public;

-- Immutable ledger table with hash chaining
CREATE TABLE IF NOT EXISTS production.merkle_ledger (
    id SERIAL PRIMARY KEY,
    tx_data JSONB NOT NULL,
    prev_hash VARCHAR(64) NOT NULL,
    block_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast chain verification
CREATE INDEX IF NOT EXISTS idx_block_chain ON production.merkle_ledger(prev_hash, block_hash);
CREATE INDEX IF NOT EXISTS idx_block_created ON production.merkle_ledger(created_at DESC);

-- Device keys table
CREATE TABLE IF NOT EXISTS production.device_keys (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(255) UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    algorithm VARCHAR(50) NOT NULL DEFAULT 'ed25519',
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_device_id ON production.device_keys(device_id);

-- Audit logs table
CREATE TABLE IF NOT EXISTS production.audit_logs (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    device_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data JSONB,
    response_status INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_event ON production.audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON production.audit_logs(created_at DESC);

-- Function to verify ledger integrity (PLpgSQL)
CREATE OR REPLACE FUNCTION production.verify_ledger_integrity()
RETURNS TABLE(
    status VARCHAR,
    total_blocks INTEGER,
    tampered_blocks INTEGER[]
) AS $$
DECLARE
    block RECORD;
    prev_block RECORD;
    expected_hash VARCHAR(64);
    tampered INTEGER[] := ARRAY[]::INTEGER[];
    block_count INTEGER := 0;
BEGIN
    FOR block IN SELECT * FROM production.merkle_ledger ORDER BY id LOOP
        block_count := block_count + 1;
        
        IF block.id > 1 THEN
            SELECT * INTO prev_block FROM production.merkle_ledger WHERE id = block.id - 1;
            
            IF block.prev_hash != prev_block.block_hash THEN
                tampered := array_append(tampered, block.id);
            END IF;
        END IF;
    END LOOP;
    
    IF array_length(tampered, 1) IS NULL THEN
        RETURN QUERY SELECT 'verified'::VARCHAR, block_count, ARRAY[]::INTEGER[];
    ELSE
        RETURN QUERY SELECT 'tampered'::VARCHAR, block_count, tampered;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Public compatibility views if queries omit the 'production.' schema prefix
CREATE OR REPLACE VIEW public.merkle_ledger AS SELECT * FROM production.merkle_ledger;
CREATE OR REPLACE VIEW public.device_keys AS SELECT * FROM production.device_keys;
CREATE OR REPLACE VIEW public.audit_logs AS SELECT * FROM production.audit_logs;


-- ============================================================================
-- DISHA 8.2 Production Ledger, Smart VPA Routing & Compliance Schema
-- ============================================================================

-- VPA Pool: Smart rotation pool with health scoring and daily caps
CREATE TABLE IF NOT EXISTS production.vpa_pool (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id         VARCHAR(255) NOT NULL,
    vpa_address         VARCHAR(100) UNIQUE NOT NULL,
    bank_name           VARCHAR(50),
    account_number_hash VARCHAR(64),
    ifsc_code           VARCHAR(15),
    status              VARCHAR(20) DEFAULT 'ACTIVE',
    health_score        INTEGER DEFAULT 100,
    priority            INTEGER DEFAULT 50,
    daily_tx_limit      INTEGER DEFAULT 30,
    daily_volume_limit  DECIMAL(15,2) DEFAULT 50000.00,
    per_tx_limit        DECIMAL(15,2) DEFAULT 100000.00,
    daily_tx_count      INTEGER DEFAULT 0,
    daily_volume        DECIMAL(15,2) DEFAULT 0.00,
    last_reset_date     DATE DEFAULT CURRENT_DATE,
    last_used_at        TIMESTAMP WITH TIME ZONE,
    cooldown_until      TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_vpa_merchant_status ON production.vpa_pool(merchant_id, status);

-- Chart of Accounts for Double-Entry Bookkeeping
CREATE TABLE IF NOT EXISTS production.accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(100) NOT NULL,
    type            VARCHAR(20) NOT NULL,
    vpa_id          UUID REFERENCES production.vpa_pool(id),
    merchant_id     VARCHAR(255),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_code ON production.accounts(code);
CREATE INDEX IF NOT EXISTS idx_accounts_merchant ON production.accounts(merchant_id);

-- Transactions Table
CREATE TABLE IF NOT EXISTS production.transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        VARCHAR(255) NOT NULL,
    utr             VARCHAR(20) UNIQUE NOT NULL,
    amount          DECIMAL(15,2) NOT NULL,
    status          VARCHAR(20) DEFAULT 'PENDING',
    vpa_used        UUID REFERENCES production.vpa_pool(id),
    merchant_id     VARCHAR(255) NOT NULL,
    customer_vpa    VARCHAR(100),
    raw_receipt     TEXT,
    verified_at     TIMESTAMP WITH TIME ZONE,
    settled_at      TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tx_utr ON production.transactions(utr);
CREATE INDEX IF NOT EXISTS idx_tx_merchant ON production.transactions(merchant_id);

-- The Ledger: Double-entry debit/credit events
CREATE TABLE IF NOT EXISTS production.ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES production.transactions(id),
    account_id      UUID NOT NULL REFERENCES production.accounts(id),
    entry_type      VARCHAR(10) NOT NULL,
    amount          DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'INR',
    description     TEXT,
    reference_type  VARCHAR(50),
    reference_id    VARCHAR(100),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_entry_type CHECK (entry_type IN ('DEBIT', 'CREDIT'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_tx ON production.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON production.ledger_entries(account_id);

-- VPA Usage Log for pattern analysis and masking
CREATE TABLE IF NOT EXISTS production.vpa_usage_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vpa_id          UUID NOT NULL REFERENCES production.vpa_pool(id),
    transaction_id  UUID NOT NULL REFERENCES production.transactions(id),
    amount          DECIMAL(15,2) NOT NULL,
    customer_vpa    VARCHAR(100),
    customer_region VARCHAR(50),
    used_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vpa_usage_vpa ON production.vpa_usage_log(vpa_id, used_at DESC);

-- VPA Health Events
CREATE TABLE IF NOT EXISTS production.vpa_health_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vpa_id          UUID NOT NULL REFERENCES production.vpa_pool(id),
    event_type      VARCHAR(50) NOT NULL,
    severity        VARCHAR(20) NOT NULL,
    description     TEXT,
    health_impact   INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- GST Invoices
CREATE TABLE IF NOT EXISTS production.gst_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number      VARCHAR(50) UNIQUE NOT NULL,
    transaction_id      UUID REFERENCES production.transactions(id),
    merchant_id         VARCHAR(255) NOT NULL,
    merchant_gstin      VARCHAR(15),
    merchant_name       VARCHAR(200),
    taxable_value       DECIMAL(15,2) NOT NULL,
    cgst_rate           DECIMAL(5,2) DEFAULT 0,
    sgst_rate           DECIMAL(5,2) DEFAULT 0,
    igst_rate           DECIMAL(5,2) DEFAULT 0,
    cgst_amount         DECIMAL(15,2) DEFAULT 0,
    sgst_amount         DECIMAL(15,2) DEFAULT 0,
    igst_amount         DECIMAL(15,2) DEFAULT 0,
    total_amount        DECIMAL(15,2) NOT NULL,
    invoice_date        DATE NOT NULL,
    financial_year      VARCHAR(9) DEFAULT '2026-27',
    hsn_code            VARCHAR(10) DEFAULT '997199',
    status              VARCHAR(20) DEFAULT 'GENERATED',
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gst_invoice_num ON production.gst_invoices(invoice_number);

-- TDS Tracking (Section 194Q - 0.1% over ₹50L/year)
CREATE TABLE IF NOT EXISTS production.tds_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     VARCHAR(255) NOT NULL,
    financial_year  VARCHAR(9) NOT NULL,
    quarter         VARCHAR(5) NOT NULL,
    total_volume    DECIMAL(15,2) NOT NULL,
    tds_amount      DECIMAL(15,2) NOT NULL,
    deducted_at     TIMESTAMP WITH TIME ZONE,
    deposited       BOOLEAN DEFAULT false,
    deposited_at    TIMESTAMP WITH TIME ZONE,
    challan_number  VARCHAR(50)
);

-- Public Compatibility Views
CREATE OR REPLACE VIEW public.vpa_pool AS SELECT * FROM production.vpa_pool;
CREATE OR REPLACE VIEW public.accounts AS SELECT * FROM production.accounts;
CREATE OR REPLACE VIEW public.transactions AS SELECT * FROM production.transactions;
CREATE OR REPLACE VIEW public.ledger_entries AS SELECT * FROM production.ledger_entries;
CREATE OR REPLACE VIEW public.gst_invoices AS SELECT * FROM production.gst_invoices;
CREATE OR REPLACE VIEW public.tds_records AS SELECT * FROM production.tds_records;
