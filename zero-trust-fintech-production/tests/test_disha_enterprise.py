import os
import sys
import unittest
import uuid
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["APP_ENV"] = "test"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.models.database import Base, Merchant, VPAPool, Account, Transaction, LedgerEntry, GSTInvoice, TDSRecord
from app.services.vpa_router import select_vpa, log_vpa_usage, reset_daily_vpa_counters
from app.services.ledger_service import record_payment, get_trial_balance, ensure_default_accounts
from app.services.compliance_service import generate_gst_invoice, check_and_record_tds
from app.services.reconciliation_service import reconcile_bank_statement


class TestDishaEnterpriseSuite(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        # Seed test merchant
        self.merchant = Merchant(
            id="m_pune_kirana",
            name="Ramesh Provision Stores",
            vpa="ramesh.store@okaxis",
            is_active=True
        )
        self.db.add(self.merchant)
        self.db.commit()

        # Seed VPA Pool
        self.vpa1 = VPAPool(
            id=str(uuid.uuid4()),
            merchant_id="m_pune_kirana",
            vpa_address="merchant007@ybl",
            bank_name="YES Bank",
            status="ACTIVE",
            health_score=95,
            daily_tx_limit=30,
            daily_volume_limit=50000.0,
            per_tx_limit=100000.0,
            daily_tx_count=10,
            daily_volume=15000.0
        )
        self.vpa2 = VPAPool(
            id=str(uuid.uuid4()),
            merchant_id="m_pune_kirana",
            vpa_address="merchant008@oksbi",
            bank_name="State Bank of India",
            status="ACTIVE",
            health_score=85,
            daily_tx_limit=30,
            daily_volume_limit=50000.0,
            per_tx_limit=100000.0,
            daily_tx_count=29,  # Near limit
            daily_volume=48000.0
        )
        self.vpa3 = VPAPool(
            id=str(uuid.uuid4()),
            merchant_id="m_pune_kirana",
            vpa_address="merchant010@paytm",
            bank_name="Paytm Payments Bank",
            status="ACTIVE",
            health_score=40,  # Below threshold 70
            daily_tx_limit=30,
            daily_volume_limit=50000.0,
            per_tx_limit=100000.0
        )
        self.db.add_all([self.vpa1, self.vpa2, self.vpa3])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)

    def test_vpa_routing_and_pattern_masking(self):
        """Test that healthy VPA is chosen and low-health or over-limit VPAs are filtered"""
        selected = select_vpa(self.db, "m_pune_kirana", 1249.37)
        self.assertIsNotNone(selected)
        # Should pick vpa1 because vpa2 is near limit and vpa3 health is < 70
        self.assertEqual(selected.vpa_address, "merchant007@ybl")
        self.assertEqual(selected.daily_tx_count, 11)

    def test_double_entry_ledger_balance(self):
        """Test atomic balanced DEBIT and CREDIT records"""
        tx = Transaction(
            id=str(uuid.uuid4()),
            order_id="ord_9901",
            utr="311400000999",
            amount=1000.0,
            status="SUCCESS",
            merchant_id="m_pune_kirana"
        )
        self.db.add(tx)
        self.db.commit()

        dr, cr = record_payment(self.db, tx.id, 1000.0, tx.utr, "m_pune_kirana")
        self.assertEqual(dr.entry_type, "DEBIT")
        self.assertEqual(cr.entry_type, "CREDIT")
        self.assertEqual(float(dr.amount), 1000.0)
        self.assertEqual(float(cr.amount), 1000.0)

        trial = get_trial_balance(self.db, "m_pune_kirana")
        self.assertTrue(trial["is_balanced"])
        self.assertEqual(trial["total_debits"], 1000.0)
        self.assertEqual(trial["total_credits"], 1000.0)

    def test_gst_invoice_generation(self):
        """Test automated GST invoice creation"""
        inv = generate_gst_invoice(
            self.db,
            transaction_id="tx_001",
            merchant_id="m_pune_kirana",
            taxable_value=1000.0,
            merchant_gstin="27AABCV1234F1Z8",
            gst_rate=18.0,
            is_interstate=False
        )
        self.assertIsNotNone(inv)
        self.assertTrue(inv.invoice_number.startswith("INV-"))
        self.assertEqual(float(inv.cgst_amount), 90.0)
        self.assertEqual(float(inv.sgst_amount), 90.0)
        self.assertEqual(float(inv.total_amount), 1180.0)

    def test_reconciliation_engine(self):
        """Test daily UTR matching against bank statement"""
        tx1 = Transaction(
            id=str(uuid.uuid4()),
            order_id="ord_1",
            utr="UTR_MATCH_1",
            amount=500.0,
            status="SUCCESS",
            merchant_id="m_pune_kirana"
        )
        tx2 = Transaction(
            id=str(uuid.uuid4()),
            order_id="ord_2",
            utr="UTR_PENDING_2",
            amount=300.0,
            status="SUCCESS",
            merchant_id="m_pune_kirana"
        )
        self.db.add_all([tx1, tx2])
        self.db.commit()

        statement = [
            {"utr": "UTR_MATCH_1", "amount": 500.0, "date": "2026-11-15"}
        ]
        result = reconcile_bank_statement(self.db, "m_pune_kirana", statement)
        self.assertEqual(result["matched_count"], 1)
        self.assertEqual(result["pending_count"], 1)
        self.assertEqual(result["unreconciled_count"], 0)


if __name__ == "__main__":
    unittest.main()
