import os
import sys
import time
import base64
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

# Ensure project root is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Set test environment variables before importing app
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["APP_ENV"] = "test"
os.environ["SIGNATURE_MAX_AGE_SECONDS"] = "60"

from cryptography.hazmat.primitives.asymmetric import ed25519, ec
from cryptography.hazmat.primitives import hashes, serialization

from app.core.security import (
    decode_signature,
    SignatureVerificationError,
    ReplayAttackError,
    DeviceAttestationVerifier
)
from app.models.database import Base, engine, SessionLocal, TransactionBlock, DeviceKey
from app.core.ledger import MerkleTreeLedger
from app.core.fraud_engine import FraudDetectionEngine


class TestSignatureDecodingAndAttestation(unittest.IsolatedAsyncioTestCase):
    """H-01: Positive and negative verification tests for signature decoding"""

    def setUp(self):
        # Generate Ed25519 keypair for tests
        self.ed_private_key = ed25519.Ed25519PrivateKey.generate()
        self.ed_public_key = self.ed_private_key.public_key()
        self.ed_public_bytes = self.ed_public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw
        )

    def test_decode_signature_hex(self):
        """Valid 64-byte Ed25519 signature encoded as 128 hex chars"""
        dummy_raw = b"\x01" * 64
        hex_sig = dummy_raw.hex()
        decoded = decode_signature(hex_sig)
        self.assertEqual(len(decoded), 64)
        self.assertEqual(decoded, dummy_raw)

    def test_decode_signature_base64(self):
        """Valid 64-byte signature encoded as standard Base64"""
        dummy_raw = b"\x02" * 64
        b64_sig = base64.b64encode(dummy_raw).decode("utf-8")
        decoded = decode_signature(b64_sig)
        self.assertEqual(len(decoded), 64)
        self.assertEqual(decoded, dummy_raw)

    def test_decode_signature_urlsafe_base64(self):
        """Valid 64-byte signature encoded as URL-safe Base64"""
        dummy_raw = b"\xfe\xff" * 32
        url_sig = base64.urlsafe_b64encode(dummy_raw).decode("utf-8")
        decoded = decode_signature(url_sig)
        self.assertEqual(len(decoded), 64)
        self.assertEqual(decoded, dummy_raw)

    def test_reject_empty_or_whitespace_signature(self):
        """Rejects empty string or whitespace"""
        with self.assertRaises(SignatureVerificationError):
            decode_signature("")
        with self.assertRaises(SignatureVerificationError):
            decode_signature("   ")
        with self.assertRaises(SignatureVerificationError):
            decode_signature(None)

    def test_reject_malformed_signature_encoding(self):
        """Rejects strings that are not valid Base64 or Hex"""
        with self.assertRaises(SignatureVerificationError):
            decode_signature("@@not-valid-base64-or-hex@@")

    async def test_ed25519_positive_verification(self):
        """Cryptographically valid Ed25519 signature succeeds"""
        verifier = DeviceAttestationVerifier()
        # Mock public key lookup
        verifier.get_public_key = lambda device_id: self._async_return(self.ed_public_bytes)

        payload = {
            "timestamp": time.time(),
            "amount": 100.50,
            "utr": "425010123456",
            "device_id": "dev_test_01"
        }
        msg = verifier._construct_message(payload)
        sig_raw = self.ed_private_key.sign(msg.encode("utf-8"))

        # Test both Hex and Base64 representations
        for sig_str in [sig_raw.hex(), base64.b64encode(sig_raw).decode()]:
            result = await verifier.verify_signature(
                payload=payload,
                signature=sig_str,
                device_id="dev_test_01",
                algorithm="ed25519"
            )
            self.assertTrue(result)

    async def test_ed25519_reject_wrong_signature_length(self):
        """Rejects Ed25519 signatures that are not exactly 64 bytes"""
        verifier = DeviceAttestationVerifier()
        verifier.get_public_key = lambda device_id: self._async_return(self.ed_public_bytes)

        payload = {"timestamp": time.time(), "device_id": "dev_test_01"}
        # 32-byte signature (invalid for Ed25519)
        short_sig_hex = (b"\x01" * 32).hex()

        with self.assertRaises(SignatureVerificationError) as ctx:
            await verifier.verify_signature(
                payload=payload,
                signature=short_sig_hex,
                device_id="dev_test_01",
                algorithm="ed25519"
            )
        self.assertIn("64 bytes", str(ctx.exception))

    async def test_ed25519_reject_tampered_signature(self):
        """Rejects forged or tampered signatures"""
        verifier = DeviceAttestationVerifier()
        verifier.get_public_key = lambda device_id: self._async_return(self.ed_public_bytes)

        payload = {"timestamp": time.time(), "amount": 100.0, "device_id": "dev_test_01"}
        tampered_sig = (b"\x99" * 64).hex()

        with self.assertRaises(SignatureVerificationError):
            await verifier.verify_signature(
                payload=payload,
                signature=tampered_sig,
                device_id="dev_test_01",
                algorithm="ed25519"
            )

    async def test_reject_expired_signature_replay(self):
        """Rejects signatures older than SIGNATURE_MAX_AGE_SECONDS"""
        verifier = DeviceAttestationVerifier()
        verifier.get_public_key = lambda device_id: self._async_return(self.ed_public_bytes)

        # 120 seconds old (max age is 60s)
        old_payload = {"timestamp": time.time() - 120, "device_id": "dev_test_01"}
        dummy_sig = (b"\x00" * 64).hex()

        with self.assertRaises(ReplayAttackError):
            await verifier.verify_signature(
                payload=old_payload,
                signature=dummy_sig,
                device_id="dev_test_01",
                algorithm="ed25519"
            )

    async def test_ecdsa_positive_verification(self):
        """Verifies ECDSA P-256 signatures with PEM public key"""
        ec_private = ec.generate_private_key(ec.SECP256R1())
        ec_public = ec_private.public_key()
        ec_pem = ec_public.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )

        verifier = DeviceAttestationVerifier()
        verifier.get_public_key = lambda device_id: self._async_return(ec_pem)

        payload = {"timestamp": time.time(), "utr": "425010999999", "device_id": "dev_ecdsa"}
        msg = verifier._construct_message(payload)
        sig_der = ec_private.sign(msg.encode("utf-8"), ec.ECDSA(hashes.SHA256()))

        # Pass as Base64 encoded DER
        sig_b64 = base64.b64encode(sig_der).decode()
        result = await verifier.verify_signature(
            payload=payload,
            signature=sig_b64,
            device_id="dev_ecdsa",
            algorithm="ecdsa"
        )
        self.assertTrue(result)

    async def _async_return(self, val):
        return val


class TestLedgerConcurrencyAndIntegrity(unittest.TestCase):
    """H-02: Concurrent ledger commit race condition tests"""

    def setUp(self):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        db.query(TransactionBlock).delete()
        db.commit()
        db.close()

    def test_concurrent_commits_maintain_unbroken_chain(self):
        """10 concurrent threads committing to ledger must produce a linear unbroken chain"""
        num_transactions = 10

        def commit_worker(idx):
            db = SessionLocal()
            try:
                ledger = MerkleTreeLedger(db)
                tx_data = {
                    "tx_id": f"tx_concurrent_{idx}",
                    "amount": 100.0 + idx,
                    "utr": f"425010{idx:06d}"
                }
                return ledger.commit_transaction(tx_data)
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=5) as executor:
            blocks = list(executor.map(commit_worker, range(num_transactions)))

        self.assertEqual(len(blocks), num_transactions)

        # Verify integrity of the entire chain
        db = SessionLocal()
        try:
            ledger = MerkleTreeLedger(db)
            report = ledger.verify_integrity()
            self.assertEqual(report["status"], "verified")
            self.assertEqual(report["total_blocks"], num_transactions)
            self.assertEqual(len(report.get("tampered_blocks", [])), 0)
        finally:
            db.close()

    def test_tampering_detection(self):
        """Ledger detects deliberate block tampering"""
        db = SessionLocal()
        try:
            ledger = MerkleTreeLedger(db)
            ledger.commit_transaction({"tx_id": "tx_1", "amount": 50})
            b2 = ledger.commit_transaction({"tx_id": "tx_2", "amount": 60})
            ledger.commit_transaction({"tx_id": "tx_3", "amount": 70})

            # Tamper block 2 hash directly in DB
            b2.prev_hash = "deadbeef" * 8
            db.commit()

            report = ledger.verify_integrity()
            self.assertEqual(report["status"], "tampered")
            self.assertIn(b2.id, report["tampered_blocks"])
        finally:
            db.close()


    def test_payload_tampering_is_detected_even_if_hash_links_are_unchanged(self):
        """Changing stored transaction details must invalidate block integrity."""
        db = SessionLocal()
        try:
            ledger = MerkleTreeLedger(db)
            block = ledger.commit_transaction({
                "tx_id": "payload-integrity-test", "amount": 200
            })
            block.tx_data = '{"amount": 1, "tx_id": "payload-integrity-test"}'
            db.commit()
            report = ledger.verify_integrity()
            self.assertEqual(report["status"], "tampered")
            self.assertIn(block.id, report["tampered_blocks"])
        finally:
            db.close()


class TestFraudEngineFailClosed(unittest.IsolatedAsyncioTestCase):
    """M-01: Fail-closed policy and atomic challenge verification"""

    async def test_challenge_missing_or_expired_fails_closed(self):
        engine = FraudDetectionEngine()
        
        # 1. Missing challenge data fails with 0 points
        res1 = await engine._layer2_challenge_verification({})
        self.assertEqual(res1["score"], 0)
        self.assertEqual(res1["details"]["status"], "missing_challenge")

        # 2. Redis returns None (challenge expired or already consumed atomically)
        class MockRedisExpired:
            async def eval(self, *args, **kwargs):
                return None
            async def getdel(self, *args, **kwargs):
                return None
            async def get(self, *args, **kwargs):
                return None

        engine.redis = MockRedisExpired()
        res2 = await engine._layer2_challenge_verification({
            "challenge_id": "test_challenge_id",
            "challenge_response": "some_hash",
            "merchant_id": "merchant_123"
        })
        self.assertEqual(res2["score"], 0)
        self.assertEqual(res2["details"]["status"], "challenge_expired_or_used")

        # 3. Redis connection failure fails closed (score == 0, never verified_offline)
        class MockRedisBroken:
            async def eval(self, *args, **kwargs):
                raise ConnectionError("Redis server unreachable")
            async def getdel(self, *args, **kwargs):
                raise ConnectionError("Redis server unreachable")
            async def get(self, *args, **kwargs):
                raise ConnectionError("Redis server unreachable")

        engine.redis = MockRedisBroken()
        res3 = await engine._layer2_challenge_verification({
            "challenge_id": "test_challenge_id",
            "challenge_response": "some_hash",
            "merchant_id": "merchant_123"
        })
        self.assertEqual(res3["score"], 0)
        self.assertEqual(res3["details"]["status"], "error")
        self.assertNotEqual(res3["details"].get("status"), "verified_offline")

    async def test_challenge_atomic_success_and_replay(self):
        import hashlib
        engine = FraudDetectionEngine()
        
        challenge_id = "cid_999"
        secret = "secret_key_123"
        merchant_id = "merchant_abc"
        expected_hash = hashlib.sha256(f"{challenge_id}|{merchant_id}|{secret}".encode()).hexdigest()

        class MockRedisSuccess:
            def __init__(self):
                self.consumed = False
            async def get(self, key):
                if not self.consumed:
                    return secret.encode()
                return None
            async def eval(self, *args, **kwargs):
                if not self.consumed:
                    self.consumed = True
                    return 1
                return 0  # Subsequent request sees empty (atomic consumption)

        mock_redis = MockRedisSuccess()
        engine.redis = mock_redis

        # First request succeeds
        res1 = await engine._layer2_challenge_verification({
            "challenge_id": challenge_id,
            "challenge_response": expected_hash,
            "merchant_id": merchant_id
        })
        self.assertEqual(res1["score"], 25)
        self.assertEqual(res1["details"]["status"], "verified")

        # Second concurrent or replay request with same challenge fails immediately
        res2 = await engine._layer2_challenge_verification({
            "challenge_id": challenge_id,
            "challenge_response": expected_hash,
            "merchant_id": merchant_id
        })
        self.assertEqual(res2["score"], 0)
        self.assertEqual(res2["details"]["status"], "challenge_expired_or_used")


if __name__ == "__main__":
    unittest.main()
