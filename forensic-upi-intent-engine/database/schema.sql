-- database/schema.sql
-- Phase 1 native PostgreSQL schema (separate from infra/postgres/init.sql).
-- Forensic findings are advisory, NOT proof of credited funds.

-- 1. The Rotating VPA Pool (approved merchant VPAs must be imported separately).
CREATE TABLE IF NOT EXISTS upi_vpa_pool (
    id SERIAL PRIMARY KEY,
    vpa_address VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'available', -- available, in_use, cooldown, blocked
    daily_tx_count INT DEFAULT 0,
    last_canary_check TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. The Forensic Session Log (The "Crime Scene").
CREATE TABLE IF NOT EXISTS payment_sessions (
    session_id VARCHAR(50) PRIMARY KEY,
    user_device_hash VARCHAR(255),
    assigned_vpa VARCHAR(255),
    amount DECIMAL(10, 2) NOT NULL,

    -- Intent & App-Switch Data
    target_package VARCHAR(255),
    time_in_app_ms INT,

    -- Evidence Storage: minimal, consented session-level data only.
    screenshot_url VARCHAR(500),
    telemetry_data JSONB,

    -- Forensic Analysis Results (not settlement decisions).
    extracted_utr VARCHAR(50),
    extracted_status VARCHAR(20),
    forensic_score INT DEFAULT 0,
    fraud_flags JSONB,

    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. The Financial Ledger. Entries must come from independently reconciled credits.
CREATE TABLE IF NOT EXISTS financial_ledger (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) REFERENCES payment_sessions(session_id),
    utr VARCHAR(50) UNIQUE,
    amount DECIMAL(10, 2),
    type VARCHAR(20) DEFAULT 'credit',
    balance_after DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Apply new Phase 1 fields even if the previous version of this file ran already.
ALTER TABLE payment_sessions
    ADD COLUMN IF NOT EXISTS telemetry_data JSONB,
    ADD COLUMN IF NOT EXISTS extracted_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS fraud_flags JSONB,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE financial_ledger
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'credit',
    ADD COLUMN IF NOT EXISTS balance_after DECIMAL(10, 2);

-- Add the requested FK for databases created with the earlier Phase 1 schema.
DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'financial_ledger'::regclass
          AND contype = 'f'
          AND confrelid = 'payment_sessions'::regclass
    ) THEN
        ALTER TABLE financial_ledger
            ADD CONSTRAINT phase1_ledger_session_fk
            FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id);
    END IF;
END
$migration$;

-- Indexes for performance.
CREATE INDEX IF NOT EXISTS idx_vpa_status ON upi_vpa_pool(status);
CREATE INDEX IF NOT EXISTS idx_session_status ON payment_sessions(status);

-- The pasted ledger had no immutability enforcement. Reject edits and truncation.
-- Production also requires restrictive DB permissions, reconciliation, and audit logging.
CREATE OR REPLACE FUNCTION phase1_reject_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql AS $block$
BEGIN
    RAISE EXCEPTION 'financial_ledger is append-only; write a reversing entry instead';
END
$block$;

DROP TRIGGER IF EXISTS phase1_ledger_no_update_delete ON financial_ledger;
CREATE TRIGGER phase1_ledger_no_update_delete
    BEFORE UPDATE OR DELETE ON financial_ledger
    FOR EACH ROW EXECUTE FUNCTION phase1_reject_ledger_mutation();

DROP TRIGGER IF EXISTS phase1_ledger_no_truncate ON financial_ledger;
CREATE TRIGGER phase1_ledger_no_truncate
    BEFORE TRUNCATE ON financial_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION phase1_reject_ledger_mutation();
