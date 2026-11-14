-- Run against an existing worker database after backing it up.
-- For brand-new volumes infra/postgres/init.sql already contains these objects.
BEGIN;
ALTER TABLE payment_sessions DROP CONSTRAINT IF EXISTS payment_sessions_status_check;
ALTER TABLE payment_sessions ADD CONSTRAINT payment_sessions_status_check
  CHECK (status IN ('PENDING','CLIENT_ATTESTED','EXPIRED','REVIEW'));
ALTER TABLE payment_sessions
  ADD COLUMN IF NOT EXISTS client_user_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS client_device_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS client_device_signature VARCHAR(256),
  ADD COLUMN IF NOT EXISTS attestation_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS client_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_client_finalized BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS client_device_keys (
  user_id VARCHAR(128) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  public_key_b64 VARCHAR(64) NOT NULL,
  hardware_attested BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,device_id)
);
CREATE TABLE IF NOT EXISTS client_attestation_ledger (
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
CREATE OR REPLACE FUNCTION reject_attestation_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client_attestation_ledger is append-only';
END $$;
DROP TRIGGER IF EXISTS prevent_client_attestation_update_delete ON client_attestation_ledger;
CREATE TRIGGER prevent_client_attestation_update_delete
BEFORE UPDATE OR DELETE ON client_attestation_ledger
FOR EACH ROW EXECUTE FUNCTION reject_attestation_ledger_mutation();
DROP TRIGGER IF EXISTS prevent_client_attestation_truncate ON client_attestation_ledger;
CREATE TRIGGER prevent_client_attestation_truncate
BEFORE TRUNCATE ON client_attestation_ledger
FOR EACH STATEMENT EXECUTE FUNCTION reject_attestation_ledger_mutation();
-- Legacy components no longer participate in runtime paths.
DROP TABLE IF EXISTS provider_events;
DROP TABLE IF EXISTS phase2_reconciliation_queue;
ALTER TABLE payment_sessions DROP COLUMN IF EXISTS provider_event_id;
COMMIT;
