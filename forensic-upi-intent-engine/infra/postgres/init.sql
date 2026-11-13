-- New development volume only. Never re-run database initialization against a live database.
CREATE DATABASE n8n;

CREATE TABLE upi_vpa_pool (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vpa_address VARCHAR(255) NOT NULL UNIQUE,
  merchant_id VARCHAR(80) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','in_use','cooldown','blocked')),
  health_status VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown','healthy','degraded','blocked')),
  daily_tx_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_tx_count >= 0),
  last_canary_check TIMESTAMPTZ,
  leased_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX upi_vpa_pool_available_idx ON upi_vpa_pool (merchant_id, leased_until)
  WHERE enabled AND health_status='healthy' AND status='available';

CREATE TABLE payment_sessions (
  id UUID PRIMARY KEY,
  merchant_id VARCHAR(80) NOT NULL,
  merchant_reference VARCHAR(128) NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  vpa VARCHAR(255) NOT NULL REFERENCES upi_vpa_pool(vpa_address),
  note VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PAID','EXPIRED','REVIEW')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  provider_event_id VARCHAR(128) UNIQUE,
  -- Optional low-confidence, consented client observations. No secrets/biometrics.
  user_device_hash VARCHAR(255),
  target_package VARCHAR(255),
  time_in_app_ms INTEGER CHECK (time_in_app_ms >= 0),
  screenshot_url VARCHAR(500),
  extracted_utr VARCHAR(50),
  extracted_status VARCHAR(20),
  forensic_score INTEGER NOT NULL DEFAULT 0 CHECK (forensic_score BETWEEN 0 AND 100),
  fraud_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (merchant_id, merchant_reference)
);
CREATE INDEX payment_sessions_expiry_idx ON payment_sessions(status, expires_at);

CREATE TABLE provider_events (
  event_id VARCHAR(128) PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES payment_sessions(id),
  event_hash CHAR(64) NOT NULL,
  decision VARCHAR(60) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Accounting movements should be posted only by verified bank reconciliation.
-- Two entries (merchant receivable and clearing) must balance before authorization.
CREATE TABLE financial_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_group UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES payment_sessions(id),
  bank_event_id VARCHAR(128) NOT NULL,
  account VARCHAR(80) NOT NULL,
  direction VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_event_id, account, direction)
);
CREATE INDEX ledger_session_idx ON financial_ledger(session_id, created_at);
CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'financial_ledger is append-only; post a compensating entry';
END
$$;
CREATE TRIGGER forbid_financial_ledger_update_delete
BEFORE UPDATE OR DELETE ON financial_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- Restrict direct INSERT grants to the dedicated reconciliation service role in production.
-- The prototype worker intentionally exposes no ledger posting endpoint.
