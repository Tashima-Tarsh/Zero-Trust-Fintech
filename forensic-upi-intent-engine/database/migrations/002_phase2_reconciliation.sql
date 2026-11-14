-- PHASE 2: Apply to the worker schema; records immutable device-integrity decisions.
CREATE TABLE IF NOT EXISTS phase2_forensic_submissions (
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
CREATE INDEX IF NOT EXISTS phase2_submissions_image_hash
  ON phase2_forensic_submissions(image_sha256) WHERE image_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS phase2_submissions_session
  ON phase2_forensic_submissions(session_id, created_at);

-- Audit records are append-only.
CREATE OR REPLACE FUNCTION phase2_reject_submissions_update_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Forensic submissions are immutable';
END
$$;
DROP TRIGGER IF EXISTS phase2_forensic_immutable ON phase2_forensic_submissions;
CREATE TRIGGER phase2_forensic_immutable
  BEFORE UPDATE OR DELETE ON phase2_forensic_submissions
  FOR EACH ROW EXECUTE FUNCTION phase2_reject_submissions_update_delete();
