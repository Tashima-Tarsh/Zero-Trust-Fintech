-- PHASE 2: Apply ONLY to the worker database created from infra/postgres/init.sql.
-- This is NOT compatible with the separate bare-metal database/schema.sql.
-- No trigger, procedure or worker endpoint in Phase 2 settles payments.

CREATE TABLE IF NOT EXISTS phase2_forensic_submissions (
  submission_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES payment_sessions(id),
  merchant_id VARCHAR(80) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  image_sha256 CHAR(64),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  decision VARCHAR(48) NOT NULL CHECK (decision = 'PENDING_RECONCILIATION'),
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase2_submissions_image_hash
  ON phase2_forensic_submissions(image_sha256) WHERE image_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS phase2_submissions_session
  ON phase2_forensic_submissions(session_id, created_at);

CREATE TABLE IF NOT EXISTS phase2_reconciliation_queue (
  session_id UUID PRIMARY KEY REFERENCES payment_sessions(id),
  merchant_id VARCHAR(80) NOT NULL,
  queue_status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (queue_status IN ('OPEN','INVESTIGATING','CLOSED')),
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase2_queue_open
  ON phase2_reconciliation_queue(merchant_id, first_seen_at)
  WHERE queue_status IN ('OPEN','INVESTIGATING');

-- Audit records are append-only; independent bank reconciliation is required.
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
