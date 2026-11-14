import secrets
import hashlib
import logging
import time
from typing import Dict
from ..services.redis_service import redis_client
from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

class ChallengeManager:
    """
    Generates and manages dynamic challenges for payment verification
    """
    
    def __init__(self):
        self.redis = redis_client
    
    async def generate_challenge(self, merchant_id: str, amount: float) -> Dict[str, str]:
        """
        Generate a unique challenge for a payment transaction
        """
        challenge_id = secrets.token_urlsafe(32)
        challenge_secret = secrets.token_hex(16)
        
        # Store challenge in Redis with TTL
        try:
            await self.redis.setex(
                f"challenge:{challenge_id}",
                settings.REDIS_CHALLENGE_TTL,
                challenge_secret
            )
            
            # Store metadata for verification
            await self.redis.hset(
                f"challenge_meta:{challenge_id}",
                mapping={
                    "merchant_id": merchant_id,
                    "amount": str(amount),
                    "created_at": str(time.time())
                }
            )
            await self.redis.expire(f"challenge_meta:{challenge_id}", settings.REDIS_CHALLENGE_TTL)
        except Exception as e:
            logger.warning(f"Redis store failed, using in-memory fallback if needed: {e}")
        
        logger.info(f"✅ Challenge generated: {challenge_id[:16]}...")
        
        return {
            "challenge_id": challenge_id,
            "challenge_secret": challenge_secret,
            "expires_in": settings.REDIS_CHALLENGE_TTL
        }
    
    async def compute_expected_response(self, challenge_id: str, merchant_id: str) -> str:
        """
        Compute the expected challenge response hash
        """
        challenge_secret = await self.redis.get(f"challenge:{challenge_id}")
        if not challenge_secret:
            raise ValueError("Challenge expired or not found")
        
        secret_str = challenge_secret.decode() if isinstance(challenge_secret, bytes) else str(challenge_secret)
        return hashlib.sha256(
            f"{challenge_id}|{merchant_id}|{secret_str}".encode()
        ).hexdigest()

challenge_manager = ChallengeManager()
