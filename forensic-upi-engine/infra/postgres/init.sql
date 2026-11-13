-- Runs on first creation of the postgres volume (fintech database).
CREATE DATABASE n8n;

CREATE TABLE IF NOT EXISTS vpa_pool (
  vpa TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','blocked')),
  leased_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vpa_available ON vpa_pool(merchant_id, leased_until) WHERE enabled AND health_status = 'healthy';

CREATE TABLE IF NOT EXISTS payment_sessions (
  id UUID PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  merchant_reference TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  vpa TEXT NOT NULL REFERENCES vpa_pool(vpa),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','REVIEW')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  provider_event_id TEXT UNIQUE,
  UNIQUE(merchant_id, merchant_reference)
);
CREATE INDEX IF NOT EXISTS idx_sessions_status_expiry ON payment_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS provider_events (
  event_id TEXT PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES payment_sessions(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_hash TEXT NOT NULL,
  decision TEXT NOT NULL
);
