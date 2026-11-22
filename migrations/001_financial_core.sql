-- DISHA 8.2 financial core (additive migration; does NOT switch live traffic).
-- Monetary representation: integer paise, never IEEE-754 floating-point rupees.
-- A POSTED journal has exactly two entries, one debit and one credit,
-- each equal to the journal amount. No partial or unbalanced commit can succeed.
-- Existing public.sessions/transactions/ledger_entries remain untouched.

CREATE TABLE IF NOT EXISTS disha_core_accounts (
    account_id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, account_id)
);

CREATE TABLE IF NOT EXISTS disha_core_journals (
    journal_id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    utr TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','POSTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_at TIMESTAMPTZ,
    UNIQUE (merchant_id, order_id),
    UNIQUE (merchant_id, journal_id),
    CHECK ((state = 'DRAFT' AND posted_at IS NULL) OR
           (state = 'POSTED' AND posted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS disha_core_postings (
    posting_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (merchant_id, journal_id)
        REFERENCES disha_core_journals (merchant_id, journal_id) ON DELETE RESTRICT,
    FOREIGN KEY (merchant_id, account_id)
        REFERENCES disha_core_accounts (merchant_id, account_id) ON DELETE RESTRICT,
    UNIQUE (journal_id, side)
);

CREATE INDEX IF NOT EXISTS idx_disha_core_postings_journal
    ON disha_core_postings (journal_id);

-- Once posted, neither the journal nor its entries may be changed.
CREATE OR REPLACE FUNCTION disha_core_guard_journal_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.state = 'POSTED' THEN
        RAISE EXCEPTION 'Posted journal is immutable: %', OLD.journal_id
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Journal deletion is prohibited'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_disha_core_guard_journal ON disha_core_journals;
CREATE TRIGGER trg_disha_core_guard_journal
BEFORE UPDATE OR DELETE ON disha_core_journals
FOR EACH ROW EXECUTE FUNCTION disha_core_guard_journal_mutation();

CREATE OR REPLACE FUNCTION disha_core_guard_posting_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    journal_state TEXT;
BEGIN
    SELECT state INTO journal_state FROM disha_core_journals
    WHERE journal_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_id ELSE NEW.journal_id END
    FOR UPDATE;
    IF journal_state IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'Posting mutation requires DRAFT journal'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.journal_id IS DISTINCT FROM OLD.journal_id
          OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
            RAISE EXCEPTION 'Posting ownership is immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_disha_core_guard_posting ON disha_core_postings;
CREATE TRIGGER trg_disha_core_guard_posting
BEFORE INSERT OR UPDATE OR DELETE ON disha_core_postings
FOR EACH ROW EXECUTE FUNCTION disha_core_guard_posting_mutation();

-- Deferred constraint trigger checks the final transactional state at COMMIT.
CREATE OR REPLACE FUNCTION disha_core_assert_balanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    journal_record RECORD;
    entry_count BIGINT;
    debit_amount NUMERIC;
    credit_amount NUMERIC;
BEGIN
    SELECT state, amount_paise INTO journal_record
    FROM disha_core_journals WHERE journal_id = NEW.journal_id;
    IF journal_record.state = 'POSTED' THEN
        SELECT COUNT(*),
            COALESCE(SUM(amount_paise) FILTER (WHERE side = 'DEBIT'), 0),
            COALESCE(SUM(amount_paise) FILTER (WHERE side = 'CREDIT'), 0)
        INTO entry_count, debit_amount, credit_amount
        FROM disha_core_postings WHERE journal_id = NEW.journal_id;
        IF entry_count <> 2 OR
           debit_amount <> credit_amount OR
           debit_amount <> journal_record.amount_paise THEN
            RAISE EXCEPTION
                'UNBALANCED_JOURNAL %: entries %, debits %, credits %, expected %',
                NEW.journal_id, entry_count, debit_amount,
                credit_amount, journal_record.amount_paise
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_disha_core_balance ON disha_core_journals;
CREATE CONSTRAINT TRIGGER trg_disha_core_balance
AFTER INSERT OR UPDATE ON disha_core_journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION disha_core_assert_balanced();

COMMENT ON TABLE disha_core_journals IS
'Financial bookkeeping entries, not independent evidence of a completed interbank transfer. Enable live writes only after data migration and authorization checks.';
