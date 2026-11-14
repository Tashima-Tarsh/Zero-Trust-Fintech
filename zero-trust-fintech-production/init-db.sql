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
