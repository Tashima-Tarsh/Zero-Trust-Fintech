import time
import hashlib
import logging
from typing import Dict, Any, Tuple
from datetime import datetime, timezone
from ..services.redis_service import redis_client
from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Lua script for atomic challenge consumption (eliminates race conditions and replay)
LUA_ATOMIC_CONSUME_CHALLENGE = """
local key = KEYS[1]
local meta_key = KEYS[2]
local val = redis.call('GET', key)
if val then
    redis.call('DEL', key)
    redis.call('DEL', meta_key)
    return val
else
    return nil
end
"""

class FraudDetectionEngine:
    """
    5-Layer Fraud-Proof Engine for UPI Receipt Verification
    with Atomic Challenge Consumption and Fail-Closed Security.
    """
    
    def __init__(self):
        self.redis = redis_client
    
    async def verify_receipt(self, receipt_data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """
        Run all 5 layers of fraud detection
        Returns: (is_valid, analysis_report)
        """
        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "layers": {},
            "overall_score": 0,
            "flags": []
        }
        
        # Layer 1: Mathematical Freshness Decoding
        layer1_result = await self._layer1_freshness_check(receipt_data)
        report["layers"]["freshness"] = layer1_result
        report["overall_score"] += layer1_result["score"]
        
        # Layer 2: Dynamic Challenge Matching (Atomic & Fail-Closed)
        layer2_result = await self._layer2_challenge_verification(receipt_data)
        report["layers"]["challenge"] = layer2_result
        report["overall_score"] += layer2_result["score"]
        
        # Layer 3: Replay Attack Detection (Atomic SET NX)
        layer3_result = await self._layer3_replay_detection(receipt_data)
        report["layers"]["replay"] = layer3_result
        report["overall_score"] += layer3_result["score"]
        
        # Layer 4: Screenshot/Photo Analysis
        layer4_result = await self._layer4_screenshot_detection(receipt_data)
        report["layers"]["screenshot"] = layer4_result
        report["overall_score"] += layer4_result["score"]
        
        # Layer 5: Behavioral Anomaly Detection
        layer5_result = await self._layer5_behavioral_analysis(receipt_data)
        report["layers"]["behavioral"] = layer5_result
        report["overall_score"] += layer5_result["score"]
        
        # Determine overall validity (threshold: 80/100)
        is_valid = report["overall_score"] >= 80
        
        if not is_valid:
            report["flags"].append("FRAUD_DETECTED")
            logger.warning(f"🚨 Fraud detected: {report}")
        
        return is_valid, report
    
    async def _layer1_freshness_check(self, receipt_data: Dict) -> Dict:
        """
        Layer 1: Mathematical Freshness Decoding
        Validates that the receipt timestamp is within acceptable window
        and matches expected payment timing patterns
        """
        receipt_timestamp = receipt_data.get("timestamp", 0)
        current_time = time.time()
        age = current_time - receipt_timestamp
        
        score = 0
        details = {}
        
        # Check if within freshness window
        if 0 <= age <= settings.FRESHNESS_WINDOW_SECONDS:
            score = 30  # Max score for this layer
            details["status"] = "fresh"
            details["age_seconds"] = age
        elif age > settings.FRESHNESS_WINDOW_SECONDS:
            score = 0
            details["status"] = "stale"
            details["age_seconds"] = age
            details["reason"] = "Receipt too old"
        else:
            score = 0
            details["status"] = "future_timestamp"
            details["reason"] = "Timestamp in future"
        
        # Additional freshness pattern analysis
        try:
            hour = datetime.fromtimestamp(receipt_timestamp, tz=timezone.utc).hour
            if 6 <= hour <= 23:  # Normal banking hours
                score += 5
                details["banking_hours"] = True
            else:
                details["banking_hours"] = False
        except Exception:
            details["banking_hours"] = False
        
        return {
            "score": min(score, 35),
            "details": details
        }
    
    async def _layer2_challenge_verification(self, receipt_data: Dict) -> Dict:
        """
        Layer 2: Dynamic Challenge Matching (Atomic One-Time Consumption)
        Atomically checks and consumes the challenge secret from Redis using Lua script.
        Strict fail-closed policy: never falls back to verified_offline on error.
        """
        challenge_id = receipt_data.get("challenge_id")
        challenge_response = receipt_data.get("challenge_response")
        merchant_id = receipt_data.get("merchant_id")
        
        score = 0
        details = {}
        
        if not challenge_id or not challenge_response:
            return {
                "score": 0,
                "details": {"status": "missing_challenge", "reason": "No challenge data"}
            }
        
        try:
            # Atomically fetch and consume challenge to prevent race conditions and replay
            try:
                expected_challenge = await self.redis.eval(
                    LUA_ATOMIC_CONSUME_CHALLENGE,
                    2,
                    f"challenge:{challenge_id}",
                    f"challenge_meta:{challenge_id}"
                )
            except Exception:
                # Fallback to GETDEL or get + del if eval is unavailable
                try:
                    expected_challenge = await self.redis.getdel(f"challenge:{challenge_id}")
                except Exception:
                    expected_challenge = await self.redis.get(f"challenge:{challenge_id}")
                    if expected_challenge:
                        await self.redis.delete(f"challenge:{challenge_id}")
            
            if not expected_challenge:
                return {
                    "score": 0,
                    "details": {"status": "challenge_expired_or_used", "reason": "Challenge not found, expired, or already consumed"}
                }
            
            # Verify challenge response
            secret_str = expected_challenge.decode() if isinstance(expected_challenge, bytes) else str(expected_challenge)
            expected_hash = hashlib.sha256(
                f"{challenge_id}|{merchant_id}|{secret_str}".encode()
            ).hexdigest()
            
            if challenge_response == expected_hash:
                score = 25  # Max score for this layer
                details["status"] = "verified"
            else:
                score = 0
                details["status"] = "mismatch"
                details["reason"] = "Challenge response incorrect"
                
        except Exception as e:
            logger.error(f"❌ Challenge verification error (failing closed): {e}")
            score = 0
            details["status"] = "error"
            details["reason"] = f"Challenge verification failed: {str(e)}"
        
        return {
            "score": score,
            "details": details
        }
    
    async def _layer3_replay_detection(self, receipt_data: Dict) -> Dict:
        """
        Layer 3: Replay Attack Detection (Atomic SET NX)
        Atomically sets receipt fingerprint key only if it does not already exist.
        """
        utr = receipt_data.get("utr")
        amount = receipt_data.get("amount")
        device_id = receipt_data.get("device_id")
        
        score = 0
        details = {}
        
        # Create unique receipt fingerprint
        receipt_fingerprint = hashlib.sha256(
            f"{utr}|{amount}|{device_id}".encode()
        ).hexdigest()
        
        try:
            # Atomically claim fingerprint with NX (Set if Not Exists)
            acquired = await self.redis.set(
                f"receipt:{receipt_fingerprint}",
                datetime.now(timezone.utc).isoformat(),
                nx=True,
                ex=86400
            )
            
            if not acquired:
                return {
                    "score": 0,
                    "details": {
                        "status": "duplicate",
                        "reason": "Receipt already processed (replay detected)"
                    }
                }
            
            score = 20  # Max score for this layer
            details["status"] = "unique"
            
        except Exception as e:
            logger.error(f"❌ Redis replay check error (failing closed): {e}")
            score = 0
            details["status"] = "error"
            details["reason"] = f"Replay check failed: {str(e)}"
        
        return {
            "score": score,
            "details": details
        }
    
    async def _layer4_screenshot_detection(self, receipt_data: Dict) -> Dict:
        """
        Layer 4: Screenshot/Photo Analysis
        Detects if receipt is from a screenshot vs native share action
        """
        source_type = receipt_data.get("source_type")  # "native_share" or "screenshot"
        metadata = receipt_data.get("metadata", {})
        
        score = 0
        details = {}
        
        # Native Android/iOS share action indicators
        if source_type == "native_share":
            score = 15  # Max score for this layer
            details["status"] = "native"
            
            # Additional checks for native share integrity
            if metadata.get("intent_action") == "android.intent.action.SEND":
                score += 5
                details["intent_verified"] = True
        else:
            score = 0
            details["status"] = "screenshot"
            details["reason"] = "Receipt from screenshot"
        
        return {
            "score": min(score, 20),
            "details": details
        }
    
    async def _layer5_behavioral_analysis(self, receipt_data: Dict) -> Dict:
        """
        Layer 5: Behavioral Anomaly Detection
        Analyzes patterns that indicate fraudulent behavior
        """
        device_id = receipt_data.get("device_id")
        ip_address = receipt_data.get("ip_address")
        user_agent = receipt_data.get("user_agent")
        
        score = 0
        details = {}
        
        try:
            # Check device reputation
            device_attempts = await self.redis.incr(f"device_attempts:{device_id}")
            await self.redis.expire(f"device_attempts:{device_id}", 3600)
            
            if device_attempts > 10:
                details["device_flagged"] = True
                details["reason"] = "Too many attempts from device"
            else:
                score += 5
                details["device_flagged"] = False
            
            # Check IP reputation
            ip_attempts = await self.redis.incr(f"ip_attempts:{ip_address}")
            await self.redis.expire(f"ip_attempts:{ip_address}", 3600)
            
            if ip_attempts > 20:
                details["ip_flagged"] = True
                details["reason"] = "Suspicious IP activity"
            else:
                score += 5
                details["ip_flagged"] = False
        except Exception as e:
            logger.warning(f"Behavioral check degraded: {e}")
            score += 0
            details["device_flagged"] = False
            details["ip_flagged"] = False
        
        # User agent consistency
        if user_agent and "mobile" in user_agent.lower():
            score += 5
            details["mobile_ua"] = True
        
        return {
            "score": min(score, 15),
            "details": details
        }

fraud_engine = FraudDetectionEngine()
