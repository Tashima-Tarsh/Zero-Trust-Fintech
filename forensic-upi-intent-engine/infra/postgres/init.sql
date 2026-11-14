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
    CHECK (status IN ('PENDING','CLIENT_ATTESTED','EXPIRED','REVIEW')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  client_user_id VARCHAR(128),
  client_device_id VARCHAR(128),
  client_device_signature VARCHAR(256),
  attestation_hash VARCHAR(64),
  client_verified_at TIMESTAMPTZ,
  is_client_finalized BOOLEAN NOT NULL DEFAULT FALSE,
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

-- Registered raw Ed25519 public keys, enrolled only after validating device key
-- provenance. Enrollment is an administrative operation, not a public API.
CREATE TABLE client_device_keys (
  user_id VARCHAR(128) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  public_key_b64 VARCHAR(64) NOT NULL,
  hardware_attested BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

-- This records signed client actions; it is not a monetary balance ledger.
CREATE TABLE client_attestation_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES payment_sessions(id),
  user_id VARCHAR(128) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  utr VARCHAR(50) NOT NULL UNIQUE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  attestation_hash CHAR(64) NOT NULL UNIQUE,
  signature VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_attestation_ledger_created_idx ON client_attestation_ledger(id);
CREATE FUNCTION reject_attestation_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  RAISE EXCEPTION 'client_attestation_ledger is append-only';
END $;
CREATE TRIGGER prevent_client_attestation_update_delete
BEFORE UPDATE OR DELETE ON client_attestation_ledger
FOR EACH ROW EXECUTE FUNCTION reject_attestation_ledger_mutation();
CREATE TRIGGER prevent_client_attestation_truncate
BEFORE TRUNCATE ON client_attestation_ledger
FOR EACH STATEMENT EXECUTE FUNCTION reject_attestation_ledger_mutation();

-- Durable device-integrity diagnostic submissions on fresh deployments.
CREATE TABLE phase2_forensic_submissions (
  submission_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES payment_sessions(id),
  merchant_id VARCHAR(80) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  image_sha256 CHAR(64),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  decision VARCHAR(48) NOT NULL CHECK (decision IN ('DEVICE_INTEGRITY_PASS','DEVICE_INTEGRITY_REJECT')),
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX phase2_submissions_image_hash ON phase2_forensic_submissions(image_sha256)
  WHERE image_sha256 IS NOT NULL;
CREATE FUNCTION reject_device_integrity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'phase2_forensic_submissions is append-only';
END $$;
CREATE TRIGGER forbid_device_integrity_update_delete
BEFORE UPDATE OR DELETE ON phase2_forensic_submissions
FOR EACH ROW EXECUTE FUNCTION reject_device_integrity_mutation();
