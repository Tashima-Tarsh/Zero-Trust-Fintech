import time
import hashlib
import logging
from typing import Dict, Any, Tuple, Optional
from datetime import datetime, timezone
from enum import Enum
from ..services.redis_service import redis_client
from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class GateStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    ERROR = "error"


# Lua script for atomic comparison and single-use consumption of payment challenges
LUA_ATOMIC_VERIFY_AND_CONSUME = """
local key = KEYS[1]
local meta_key = KEYS[2]
local expected_hash = ARGV[1]
local challenge_response = ARGV[2]

local stored = redis.call('GET', key)
if not stored then
    return 0  -- Challenge expired, not found, or already consumed
end

if stored == expected_hash or challenge_response == expected_hash then
    redis.call('DEL', key)
    if meta_key then
        redis.call('DEL', meta_key)
    end
    return 1  -- Verified and consumed atomically
else
    return -1 -- Response mismatch
end
"""


class FraudDetectionEngine:
    """
    5-Layer Fraud-Proof Engine with Mandatory Gates.
    Strictly prevents threshold bypass by enforcing binary pass/fail gates
    (Timestamp Freshness, Dynamic Challenge, Replay Defense) before scoring.
    """

    def __init__(self):
        self.redis = redis_client

    async def verify_receipt(
        self, receipt_data: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """
        Run all layers with mandatory gates.
        Returns: (is_valid, analysis_report)
        """
        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "gates": {},
            "layers": {},
            "overall_score": 0,
            "flags": [],
            "blocked": False,
            "block_reason": None,
        }

        # =====================================================================
        # MANDATORY GATES (Must pass before any scoring is considered)
        # =====================================================================

        # Gate 1: Timestamp Freshness (Hard Gate)
        gate1 = await self._gate1_timestamp_freshness(receipt_data)
        report["gates"]["timestamp_freshness"] = gate1
        if gate1["status"] != GateStatus.PASS:
            report["blocked"] = True
            report["block_reason"] = "Timestamp validation failed"
            report["flags"].append("GATE_TIMESTAMP_FAILED")
            logger.warning(f"🚨 Gate 1 Failed: {gate1}")
            return False, report

        # Gate 2: Dynamic Challenge Verification (Atomic Lua Gate)
        gate2 = await self._gate2_challenge_verification(receipt_data)
        report["gates"]["challenge_verification"] = gate2
        if gate2["status"] != GateStatus.PASS:
            report["blocked"] = True
            report["block_reason"] = "Challenge verification failed"
            report["flags"].append("GATE_CHALLENGE_FAILED")
            logger.warning(f"🚨 Gate 2 Failed: {gate2}")
            return False, report

        # Gate 3: Replay Detection (Atomic SET NX Gate)
        gate3 = await self._gate3_replay_detection(receipt_data)
        report["gates"]["replay_detection"] = gate3
        if gate3["status"] != GateStatus.PASS:
            report["blocked"] = True
            report["block_reason"] = "Replay attack detected"
            report["flags"].append("GATE_REPLAY_FAILED")
            logger.warning(f"🚨 Gate 3 Failed: {gate3}")
            return False, report

        # =====================================================================
        # SCORING LAYERS (Only evaluated if all mandatory gates pass)
        # =====================================================================

        # Layer 1: Screenshot & Intent Detection (Scoring, up to 35 pts)
        layer1 = await self._layer1_screenshot_detection(receipt_data)
        report["layers"]["screenshot"] = layer1
        report["overall_score"] += layer1["score"]

        # Layer 2: Behavioral Rate Analysis (Scoring, up to 25 pts)
        layer2 = await self._layer2_behavioral_analysis(receipt_data)
        report["layers"]["behavioral"] = layer2
        report["overall_score"] += layer2["score"]

        # Layer 3: Device Reputation & Trust (Scoring, up to 40 pts)
        layer3 = await self._layer3_device_reputation(receipt_data)
        report["layers"]["device_reputation"] = layer3
        report["overall_score"] += layer3["score"]

        # Confidence threshold: 60/100 after all gates pass
        is_valid = report["overall_score"] >= 60

        if not is_valid:
            report["flags"].append("LOW_CONFIDENCE_SCORE")
            logger.warning(f"⚠️ Low confidence score: {report['overall_score']}")

        return is_valid, report

    # -------------------------------------------------------------------------
    # MANDATORY GATES
    # -------------------------------------------------------------------------

    async def _gate1_timestamp_freshness(self, receipt_data: Dict) -> Dict:
        """
        GATE 1: Timestamp Freshness (MANDATORY)
        Rejects timestamps outside acceptable freshness window or in the future.
        """
        receipt_timestamp = receipt_data.get("timestamp", 0)
        current_time = time.time()
        age = current_time - receipt_timestamp

        if age < -10 or age > settings.SIGNATURE_MAX_AGE_SECONDS:
            logger.warning(
                f"❌ Gate 1 FAILED: Timestamp age {age:.2f}s out of allowed window"
            )
            return {
                "status": GateStatus.FAIL,
                "reason": "Timestamp outside acceptable window",
                "age_seconds": age,
            }

        return {"status": GateStatus.PASS, "age_seconds": age}

    async def _gate2_challenge_verification(self, receipt_data: Dict) -> Dict:
        """
        GATE 2: Dynamic Challenge Verification (MANDATORY + ATOMIC)
        Executes atomic Redis Lua script to prevent race conditions and replay.
        """
        challenge_id = receipt_data.get("challenge_id")
        challenge_response = receipt_data.get("challenge_response")
        merchant_id = receipt_data.get("merchant_id")

        if not challenge_id or not challenge_response:
            return {"status": GateStatus.FAIL, "reason": "Missing challenge data"}

        try:
            from .challenge import challenge_manager

            challenge_manager.redis = self.redis
            result = await challenge_manager.verify_and_consume_challenge(
                challenge_id=challenge_id,
                merchant_id=merchant_id,
                provided_response=challenge_response,
            )

            if result.get("status") == "success":
                return {
                    "status": GateStatus.PASS,
                    "reason": "Challenge verified and consumed atomically",
                }
            elif result.get("status") in ("not_found", "already_consumed"):
                return {
                    "status": GateStatus.FAIL,
                    "reason": "Challenge expired or already consumed",
                }
            else:
                return {
                    "status": GateStatus.FAIL,
                    "reason": result.get("message", "Challenge verification failed"),
                }
        except Exception as e:
            logger.error(f"❌ Challenge verification error (failing closed): {e}")
            return {"status": GateStatus.ERROR, "reason": str(e)}

    async def _gate3_replay_detection(self, receipt_data: Dict) -> Dict:
        """
        GATE 3: Replay Detection (MANDATORY + ATOMIC)
        Uses Redis SET NX to claim fingerprint key atomically.
        """
        utr = receipt_data.get("utr")
        amount = receipt_data.get("amount")
        device_id = receipt_data.get("device_id")

        receipt_fingerprint = hashlib.sha256(
            f"{utr}|{amount}|{device_id}".encode()
        ).hexdigest()

        key = f"receipt:{receipt_fingerprint}"
        timestamp = datetime.now(timezone.utc).isoformat()

        try:
            was_set = await self.redis.set(
                key,
                timestamp,
                nx=True,  # Set only if not exists
                ex=86400,  # 24 hour TTL
            )

            if not was_set:
                logger.warning(
                    f"❌ Gate 3 FAILED: Duplicate receipt fingerprint {receipt_fingerprint[:16]}..."
                )
                return {
                    "status": GateStatus.FAIL,
                    "reason": "Receipt already processed (replay detected)",
                }

            return {"status": GateStatus.PASS, "fingerprint": receipt_fingerprint[:16]}
        except Exception as e:
            logger.error(f"❌ Replay check error (failing closed): {e}")
            return {"status": GateStatus.ERROR, "reason": str(e)}

    # -------------------------------------------------------------------------
    # SCORING LAYERS
    # -------------------------------------------------------------------------

    async def _layer1_screenshot_detection(self, receipt_data: Dict) -> Dict:
        """Layer 1: Screenshot vs Native Share Intent Analysis (Scoring, up to 35)"""
        source_type = receipt_data.get("source_type")
        metadata = receipt_data.get("metadata", {})

        score = 0
        details = {}

        if source_type == "native_share":
            score = 25
            details["status"] = "native"
            if metadata.get("intent_action") == "android.intent.action.SEND":
                score += 10
                details["intent_verified"] = True
        else:
            score = 0
            details["status"] = "screenshot"
            details["reason"] = (
                "Receipt submitted via non-native share or manual screenshot"
            )

        return {
            "score": min(score, 35),
            "status": details.get("status", "unknown"),
            "details": details,
        }

    async def _layer2_behavioral_analysis(self, receipt_data: Dict) -> Dict:
        """Layer 2: Behavioral Rate & Attempt Velocity (Scoring, up to 25)"""
        device_id = receipt_data.get("device_id")
        ip_address = receipt_data.get("ip_address")

        score = 0
        details = {}

        try:
            # Device attempt velocity
            device_attempts = await self.redis.incr(f"device_attempts:{device_id}")
            await self.redis.expire(f"device_attempts:{device_id}", 3600)

            if device_attempts <= 5:
                score += 15
                details["device_attempts"] = device_attempts

            # IP attempt velocity
            ip_attempts = await self.redis.incr(f"ip_attempts:{ip_address}")
            await self.redis.expire(f"ip_attempts:{ip_address}", 3600)

            if ip_attempts <= 10:
                score += 10
                details["ip_attempts"] = ip_attempts
        except Exception as e:
            logger.warning(f"Behavioral check degraded: {e}")
            score += 0

        return {"score": min(score, 25), "status": "analyzed", "details": details}

    async def _layer3_device_reputation(self, receipt_data: Dict) -> Dict:
        """Layer 3: Registered Device Public Key Reputation (Scoring, up to 40)"""
        device_id = receipt_data.get("device_id")

        score = 0
        details = {}

        try:
            # Check if device public key exists in cache or db
            cached_key = await self.redis.get(f"device_key:{device_id}")
            if cached_key:
                score = 40
                details["registered"] = True
            else:
                score = 20
                details["registered"] = False
        except Exception:
            score = 20
            details["registered"] = False

        return {
            "score": min(score, 40),
            "status": "trusted" if details.get("registered") else "unregistered",
            "details": details,
        }

    # -------------------------------------------------------------------------
    # BACKWARD COMPATIBILITY HELPERS FOR EXISTING TEST SUITES
    # -------------------------------------------------------------------------

    async def _layer1_freshness_check(self, receipt_data: Dict) -> Dict:
        res = await self._gate1_timestamp_freshness(receipt_data)
        return {"score": 30 if res["status"] == GateStatus.PASS else 0, "details": res}

    async def _layer2_challenge_verification(self, receipt_data: Dict) -> Dict:
        res = await self._gate2_challenge_verification(receipt_data)
        return {
            "score": 25 if res["status"] == GateStatus.PASS else 0,
            "details": {
                "status": (
                    "verified"
                    if res["status"] == GateStatus.PASS
                    else (
                        "missing_challenge"
                        if res.get("reason") == "Missing challenge data"
                        else (
                            "error"
                            if res["status"] == GateStatus.ERROR
                            else "challenge_expired_or_used"
                        )
                    )
                ),
                "reason": res.get("reason", ""),
            },
        }

    async def _layer3_replay_detection(self, receipt_data: Dict) -> Dict:
        res = await self._gate3_replay_detection(receipt_data)
        return {
            "score": 20 if res["status"] == GateStatus.PASS else 0,
            "details": {
                "status": (
                    "unique"
                    if res["status"] == GateStatus.PASS
                    else ("error" if res["status"] == GateStatus.ERROR else "duplicate")
                ),
                "reason": res.get("reason", ""),
            },
        }


fraud_engine = FraudDetectionEngine()
