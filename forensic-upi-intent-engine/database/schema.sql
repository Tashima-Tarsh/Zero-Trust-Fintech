-- database/schema.sql
-- Native PostgreSQL schema for independently maintained client event records.

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

    client_user_id VARCHAR(128),
    client_device_id VARCHAR(128),
    client_device_signature VARCHAR(256),
    attestation_hash VARCHAR(64),
    client_verified_at TIMESTAMP WITH TIME ZONE,
    is_client_finalized BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Append-only signed client-attestation record.
CREATE TABLE IF NOT EXISTS client_device_keys (
    user_id VARCHAR(128) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    public_key_b64 VARCHAR(64) NOT NULL,
    hardware_attested BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY(user_id, device_id)
);
CREATE TABLE IF NOT EXISTS client_attestation_ledger (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL UNIQUE REFERENCES payment_sessions(session_id),
    utr VARCHAR(50) NOT NULL UNIQUE,
    attestation_hash CHAR(64) NOT NULL UNIQUE,
    signature VARCHAR(256) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Apply new Phase 1 fields even if the previous version of this file ran already.
ALTER TABLE payment_sessions
    ADD COLUMN IF NOT EXISTS telemetry_data JSONB,
    ADD COLUMN IF NOT EXISTS extracted_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS fraud_flags JSONB,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE payment_sessions
    ADD COLUMN IF NOT EXISTS client_user_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS client_device_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS client_device_signature VARCHAR(256),
    ADD COLUMN IF NOT EXISTS attestation_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS client_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_client_finalized BOOLEAN NOT NULL DEFAULT FALSE;

-- Indexes for performance.
CREATE INDEX IF NOT EXISTS idx_vpa_status ON upi_vpa_pool(status);
CREATE INDEX IF NOT EXISTS idx_session_status ON payment_sessions(status);

-- Prevent tampering with signed client action history.
CREATE OR REPLACE FUNCTION phase1_reject_attestation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $block$
BEGIN
    RAISE EXCEPTION 'client_attestation_ledger is append-only';
END
$block$;
DROP TRIGGER IF EXISTS phase1_ledger_no_update_delete ON client_attestation_ledger;
CREATE TRIGGER phase1_ledger_no_update_delete
    BEFORE UPDATE OR DELETE ON client_attestation_ledger
    FOR EACH ROW EXECUTE FUNCTION phase1_reject_attestation_mutation();
DROP TRIGGER IF EXISTS phase1_ledger_no_truncate ON client_attestation_ledger;
CREATE TRIGGER phase1_ledger_no_truncate
    BEFORE TRUNCATE ON client_attestation_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION phase1_reject_attestation_mutation();
