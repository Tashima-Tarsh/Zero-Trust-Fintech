-- Table 4: VPA Health Log (For 20-Day Analysis)
CREATE TABLE IF NOT EXISTS vpa_health_log (
    id SERIAL PRIMARY KEY,
    vpa_address VARCHAR(255),
    event_type VARCHAR(50), -- 'canary_test', 'user_payment', 'block_detected'
    status VARCHAR(20),     -- 'success', 'failed', 'timeout'
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update upi_vpa_pool to include cooldown logic
ALTER TABLE upi_vpa_pool 
ADD COLUMN IF NOT EXISTS failure_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP WITH TIME ZONE;
