-- Table 1: The Rotating VPA Pool
CREATE TABLE upi_vpa_pool (
    id SERIAL PRIMARY KEY,
    vpa_address VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'available',
    daily_tx_count INT DEFAULT 0,
    last_canary_check TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table 2: The Forensic Session Log
CREATE TABLE payment_sessions (
    session_id VARCHAR(50) PRIMARY KEY,
    user_device_hash VARCHAR(255),
    assigned_vpa VARCHAR(255),
    amount DECIMAL(10, 2) NOT NULL,
    target_package VARCHAR(255),
    time_in_app_ms INT,
    screenshot_url VARCHAR(500),
    extracted_utr VARCHAR(50),
    forensic_score INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table 3: The Financial Ledger
CREATE TABLE financial_ledger (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50),
    utr VARCHAR(50) UNIQUE,
    amount DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
