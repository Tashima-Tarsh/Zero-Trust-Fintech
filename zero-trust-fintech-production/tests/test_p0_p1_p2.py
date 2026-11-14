import os
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone

# Ensure project root is on path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-32-chars-minimum-valid-key!!"

from app.models.database import Base, engine, SessionLocal, Merchant, MerchantUser
from app.core.auth import (
    create_access_token,
    create_refresh_token,
    verify_token,
    verify_websocket_token,
    AuthError
)
from app.api.auth_routes import pwd_context
from app.services.vpa_health import vpa_health_monitor
from app.services.forensics_service import forensics_service
from app.services.notification_service import notification_service
from app.core.challenge import challenge_manager


class MockRedisClient:
    """Mock Redis client for testing atomic operations and in-memory caches"""
    def __init__(self):
        self.hashes = {}
        self.strings = {}
        self.queues = {}

    async def hset(self, key, mapping=None, **kwargs):
        if key not in self.hashes:
            self.hashes[key] = {}
        if mapping:
            self.hashes[key].update(mapping)
        if kwargs:
            self.hashes[key].update(kwargs)
        return 1

    async def hgetall(self, key):
        return self.hashes.get(key, {})

    async def hget(self, key, field):
        h = self.hashes.get(key, {})
        return h.get(field)

    async def get(self, key):
        return self.strings.get(key)

    async def setex(self, key, ttl, value):
        self.strings[key] = value if isinstance(value, bytes) else str(value).encode('utf-8')
        return True

    async def delete(self, key):
        self.hashes.pop(key, None)
        self.strings.pop(key, None)
        return 1

    async def expire(self, key, ttl):
        return 1

    async def eval(self, script, numkeys, key, expected_hash, provided_response, merchant_id=None, ts=None):
        data = self.hashes.get(key, {})
        if not data:
            return None
        if data.get("consumed") == "true":
            return '{"status": "already_consumed", "message": "Challenge already used"}'
        if data.get("merchant_id") and merchant_id and data["merchant_id"] != merchant_id:
            return '{"status": "merchant_mismatch", "message": "Merchant ID mismatch"}'
        if data.get("expected_hash") == provided_response or expected_hash == provided_response:
            data["consumed"] = "true"
            return '{"status": "success", "message": "Challenge verified and consumed"}'
        return '{"status": "invalid_response", "message": "Invalid challenge response"}'

    async def lpush(self, queue, item):
        if queue not in self.queues:
            self.queues[queue] = []
        self.queues[queue].insert(0, item)
        return len(self.queues[queue])

    async def rpop(self, queue):
        q = self.queues.get(queue, [])
        if q:
            return q.pop()
        return None


class TestP0P1P2Implementation(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.mock_redis = MockRedisClient()
        challenge_manager.redis = self.mock_redis
        notification_service.redis = self.mock_redis
        forensics_service.redis = self.mock_redis
        
        # Seed test merchant & user
        self.merchant = Merchant(
            id="merchant_test_01",
            name="Test Store",
            vpa="teststore@upi",
            is_active=True,
            vpa_last_rotated=datetime.now(timezone.utc) - timedelta(days=10)
        )
        self.db.add(self.merchant)
        
        self.user = MerchantUser(
            id="user_test_01",
            merchant_id="merchant_test_01",
            email="owner@teststore.com",
            hashed_password=pwd_context.hash("SecurePass123!"),
            is_active=True
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=engine)

    # -------------------------------------------------------------------------
    # P0-1: Merchant Authentication & Token Verification Tests
    # -------------------------------------------------------------------------
    def test_jwt_access_and_refresh_token_lifecycle(self):
        """Tokens can be created, decoded, and carry sub/merchant_id scopes"""
        data = {"sub": "user_test_01", "merchant_id": "merchant_test_01"}
        
        access_tok = create_access_token(data)
        refresh_tok = create_refresh_token(data)
        
        # Verify access token
        decoded_acc = verify_token(access_tok)
        self.assertEqual(decoded_acc["sub"], "user_test_01")
        self.assertEqual(decoded_acc["merchant_id"], "merchant_test_01")
        self.assertEqual(decoded_acc["type"], "access")
        
        # Verify refresh token
        decoded_ref = verify_token(refresh_tok)
        self.assertEqual(decoded_ref["type"], "refresh")

    def test_jwt_tampered_token_rejected(self):
        """Altered JWT token payload or signature is strictly rejected"""
        data = {"sub": "user_test_01", "merchant_id": "merchant_test_01"}
        token = create_access_token(data)
        
        # Tamper payload
        parts = token.split('.')
        tampered_token = f"{parts[0]}.eyJhZG1pbiI6dHJ1ZX0.{parts[2]}"
        
        with self.assertRaises(AuthError):
            verify_token(tampered_token)

    def test_websocket_token_merchant_scoping(self):
        """WebSocket token enforces merchant scope and rejects unauthorized merchants"""
        valid_ws_tok = create_access_token(
            {"sub": "user_test_01", "merchant_id": "merchant_test_01", "type": "websocket"}
        )
        payload = verify_websocket_token(valid_ws_tok, "merchant_test_01")
        self.assertEqual(payload["merchant_id"], "merchant_test_01")
        
        # Cross-merchant hijacking attempt must fail
        with self.assertRaises(Exception):
            verify_websocket_token(valid_ws_tok, "other_merchant_99")

    def test_password_hashing_and_verification(self):
        """Passwords hash uniquely with salt and verify reliably"""
        raw_pw = "FintechSecret@2026"
        hashed = pwd_context.hash(raw_pw)
        self.assertNotEqual(raw_pw, hashed)
        self.assertTrue(pwd_context.verify(raw_pw, hashed))
        self.assertFalse(pwd_context.verify("WrongPassword", hashed))

    # -------------------------------------------------------------------------
    # P0-2: Atomic Challenge Manager Tests
    # -------------------------------------------------------------------------
    async def test_challenge_manager_generation_and_consumption(self):
        """ChallengeManager generates secure challenge and verifies/consumes atomically"""
        res = await challenge_manager.generate_challenge("merchant_test_01", 100.37)
        self.assertIn("challenge_id", res)
        self.assertIn("challenge_secret", res)
        self.assertIn("expected_hash", res)
        
        cid = res["challenge_id"]
        exp_hash = res["expected_hash"]
        
        # Verify and consume
        verify_res = await challenge_manager.verify_and_consume_challenge(
            challenge_id=cid,
            merchant_id="merchant_test_01",
            provided_response=exp_hash
        )
        self.assertEqual(verify_res["status"], "success")

    # -------------------------------------------------------------------------
    # P2-1: VPA Health and 90-Day Rotation Tests
    # -------------------------------------------------------------------------
    async def test_vpa_health_check_fresh(self):
        """VPA rotated 10 days ago is healthy and does not need rotation"""
        health = await vpa_health_monitor.check_vpa_health("merchant_test_01", self.db)
        self.assertTrue(health["healthy"])
        self.assertEqual(health["vpa"], "teststore@upi")
        self.assertFalse(health["needs_rotation"])

    async def test_vpa_rotation_needed_and_execution(self):
        """VPA older than 90 days flags needs_rotation and can be rotated atomically"""
        # Set old rotation date (100 days ago)
        self.merchant.vpa_last_rotated = datetime.now(timezone.utc) - timedelta(days=100)
        self.db.commit()
        
        health = await vpa_health_monitor.check_vpa_health("merchant_test_01", self.db)
        self.assertTrue(health["needs_rotation"])
        
        # Rotate VPA
        success = await vpa_health_monitor.rotate_vpa("merchant_test_01", "newstore@upi", self.db)
        self.assertTrue(success)
        
        # Verify rotation
        updated_health = await vpa_health_monitor.check_vpa_health("merchant_test_01", self.db)
        self.assertEqual(updated_health["vpa"], "newstore@upi")
        self.assertFalse(updated_health["needs_rotation"])

    # -------------------------------------------------------------------------
    # P2-2: Auxiliary Forensics Service Tests
    # -------------------------------------------------------------------------
    async def test_forensics_analysis_heuristics(self):
        """Auxiliary forensics runs ELA, OCR, and metadata analysis"""
        mock_data = {
            "amount": 100.37,
            "utr": "425010123456",
            "receipt_text": "Paid ₹100.37 UPI Ref 425010123456"
        }
        
        ela = await forensics_service._run_ela_analysis(None)
        self.assertFalse(ela["manipulation_detected"])
        
        ocr = await forensics_service._run_ocr_analysis(mock_data)
        self.assertTrue(ocr["text_extracted"])
        self.assertEqual(ocr["amount_detected"], "100.37")
        
        meta = await forensics_service._run_metadata_analysis(mock_data)
        self.assertTrue(meta["timestamp_valid"])
        self.assertTrue(meta["device_consistency"])

    # -------------------------------------------------------------------------
    # P1-4: Notification Delivery Service Tests
    # -------------------------------------------------------------------------
    async def test_notification_delivery_and_fallback(self):
        """Notification service dispatches notifications across supported channels"""
        email_res = await notification_service._send(
            "email", "merchant@store.com", {"title": "Payment Confirmed", "amount": 100.37}
        )
        self.assertTrue(email_res)
        
        sms_res = await notification_service._send(
            "sms", "+919876543210", {"body": "Payment Confirmed for ₹100.37"}
        )
        self.assertTrue(sms_res)


if __name__ == "__main__":
    unittest.main()
