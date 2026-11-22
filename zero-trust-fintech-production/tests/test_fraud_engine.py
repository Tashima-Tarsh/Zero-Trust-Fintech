import os
import sys
import time
import unittest
import hashlib
from datetime import datetime, timezone

# Ensure project root is on path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["APP_ENV"] = "test"
os.environ["SIGNATURE_MAX_AGE_SECONDS"] = "60"

from app.core.fraud_engine import fraud_engine, GateStatus


class MockRedisEngine:
    """Mock Redis client for deterministic unit testing of gates and scoring"""
    def __init__(self):
        self.store = {}
        self.counters = {}
    
    async def get(self, key):
        return self.store.get(key)
        
    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return False
        self.store[key] = value if isinstance(value, bytes) else str(value).encode('utf-8')
        return True
        
    async def delete(self, key):
        if key in self.store:
            del self.store[key]
            return 1
        return 0
        
    async def eval(self, script, numkeys, key, meta_key, expected_hash, provided_response):
        stored = self.store.get(key)
        if not stored:
            return 0
        stored_str = stored.decode('utf-8') if isinstance(stored, bytes) else str(stored)
        if stored_str == expected_hash or provided_response == expected_hash:
            if key in self.store:
                del self.store[key]
            if meta_key and meta_key in self.store:
                del self.store[meta_key]
            return 1
        return -1
        
    async def incr(self, key):
        val = self.counters.get(key, 0) + 1
        self.counters[key] = val
        return val
        
    async def expire(self, key, ttl):
        return 1


class TestFraudEngineMandatoryGates(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.mock_redis = MockRedisEngine()
        fraud_engine.redis = self.mock_redis

    async def test_gate1_timestamp_freshness_pass(self):
        """Fresh timestamp within 60s passes Gate 1"""
        receipt_data = {
            "timestamp": time.time() - 5,
            "utr": "425010123456",
            "amount": 100.0
        }
        res = await fraud_engine._gate1_timestamp_freshness(receipt_data)
        self.assertEqual(res["status"], GateStatus.PASS)
        self.assertAlmostEqual(res["age_seconds"], 5, delta=2)

    async def test_gate1_timestamp_freshness_fail_old(self):
        """Timestamp older than 60s fails Gate 1"""
        receipt_data = {
            "timestamp": time.time() - 120,  # 2 minutes old
            "utr": "425010123456",
            "amount": 100.0
        }
        res = await fraud_engine._gate1_timestamp_freshness(receipt_data)
        self.assertEqual(res["status"], GateStatus.FAIL)
        self.assertEqual(res["reason"], "Timestamp outside acceptable window")

    async def test_gate1_timestamp_freshness_fail_future(self):
        """Timestamp in the future fails Gate 1"""
        receipt_data = {
            "timestamp": time.time() + 30,  # Future
            "utr": "425010123456",
            "amount": 100.0
        }
        res = await fraud_engine._gate1_timestamp_freshness(receipt_data)
        self.assertEqual(res["status"], GateStatus.FAIL)

    async def test_gate2_challenge_verification_atomic_pass(self):
        """Valid challenge is verified and consumed atomically"""
        cid = "cid_gate2_test"
        secret = "secret_hex_999"
        mid = "merchant_001"
        expected_hash = hashlib.sha256(f"{cid}|{mid}|{secret}".encode()).hexdigest()

        # Seed challenge in mock redis
        await self.mock_redis.set(f"challenge:{cid}", secret)

        res = await fraud_engine._gate2_challenge_verification({
            "challenge_id": cid,
            "challenge_response": expected_hash,
            "merchant_id": mid
        })
        self.assertEqual(res["status"], GateStatus.PASS)

        # Ensure challenge is now consumed (deleted from Redis)
        self.assertIsNone(await self.mock_redis.get(f"challenge:{cid}"))

    async def test_gate2_challenge_verification_fail_expired(self):
        """Missing or expired challenge fails Gate 2"""
        res = await fraud_engine._gate2_challenge_verification({
            "challenge_id": "nonexistent_challenge",
            "challenge_response": "any_hash",
            "merchant_id": "merchant_001"
        })
        self.assertEqual(res["status"], GateStatus.FAIL)
        self.assertIn("expired", res["reason"].lower())

    async def test_gate3_replay_detection(self):
        """First submission passes Gate 3; identical submission is blocked as duplicate"""
        receipt_data = {
            "utr": "425010998877",
            "amount": 100.50,
            "device_id": "dev_test_01"
        }

        # 1. First submission succeeds
        res1 = await fraud_engine._gate3_replay_detection(receipt_data)
        self.assertEqual(res1["status"], GateStatus.PASS)

        # 2. Second submission with exact same fingerprint fails
        res2 = await fraud_engine._gate3_replay_detection(receipt_data)
        self.assertEqual(res2["status"], GateStatus.FAIL)
        self.assertIn("replay detected", res2["reason"].lower())

    async def test_mandatory_gates_block_on_failure(self):
        """Failing any mandatory gate immediately halts processing with blocked=True"""
        receipt_data = {
            "timestamp": time.time() - 180,  # Old timestamp: fails Gate 1
            "utr": "425010111222",
            "amount": 100.0,
            "device_id": "dev_01",
            "challenge_id": "cid_test",
            "challenge_response": "resp_test",
            "merchant_id": "merchant_001"
        }

        is_valid, report = await fraud_engine.verify_receipt(receipt_data)
        self.assertFalse(is_valid)
        self.assertTrue(report["blocked"])
        self.assertEqual(report["block_reason"], "Timestamp validation failed")
        self.assertIn("GATE_TIMESTAMP_FAILED", report["flags"])

    async def test_all_gates_pass_full_scoring(self):
        """When all mandatory gates pass, scoring layers evaluate confidence"""
        cid = "cid_full_pass"
        secret = "secret_pass_123"
        mid = "merchant_001"
        expected_hash = hashlib.sha256(f"{cid}|{mid}|{secret}".encode()).hexdigest()

        await self.mock_redis.set(f"challenge:{cid}", secret)
        await self.mock_redis.set("device_key:dev_trusted_01", "some_public_key")

        receipt_data = {
            "timestamp": time.time() - 2,
            "utr": "425010333444",
            "amount": 100.0,
            "device_id": "dev_trusted_01",
            "challenge_id": cid,
            "challenge_response": expected_hash,
            "merchant_id": mid,
            "source_type": "native_share",
            "metadata": {"intent_action": "android.intent.action.SEND"},
            "ip_address": "127.0.0.1"
        }

        is_valid, report = await fraud_engine.verify_receipt(receipt_data)
        self.assertTrue(is_valid)
        self.assertFalse(report["blocked"])
        self.assertGreaterEqual(report["overall_score"], 60)
        self.assertEqual(report["layers"]["screenshot"]["status"], "native")


if __name__ == "__main__":
    unittest.main()
