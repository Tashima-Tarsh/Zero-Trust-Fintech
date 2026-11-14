import time
import logging
from typing import Optional
from datetime import datetime
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.exceptions import InvalidSignature
import redis.asyncio as redis
import json
from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

class SignatureVerificationError(Exception):
    pass

class ReplayAttackError(Exception):
    pass

class DeviceAttestationVerifier:
    def __init__(self):
        self.redis = redis.from_url(settings.REDIS_URL, decode_responses=False)
    
    async def get_public_key(self, device_id: str) -> bytes:
        """Fetch device public key from cache or database"""
        cache_key = f"device_key:{device_id}"
        try:
            cached_key = await self.redis.get(cache_key)
            if cached_key:
                return cached_key if isinstance(cached_key, bytes) else cached_key.encode('utf-8')
        except Exception:
            pass
        
        # Fetch from database
        try:
            from ..models.database import SessionLocal, DeviceKey
            db = SessionLocal()
            try:
                device = db.query(DeviceKey).filter_by(device_id=device_id, is_active=True).first()
                if device and device.public_key:
                    pub_str = device.public_key.strip()
                    # If raw hex string, convert or return bytes
                    if len(pub_str) == 64:
                        key_bytes = bytes.fromhex(pub_str)
                    else:
                        key_bytes = pub_str.encode('utf-8')
                    try:
                        await self.redis.setex(cache_key, 3600, key_bytes)
                    except Exception:
                        pass
                    return key_bytes
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Database lookup for device key failed: {e}")
        
        raise SignatureVerificationError(f"Device not registered: {device_id}")
    
    async def verify_signature(
        self,
        payload: dict,
        signature: str,
        device_id: str,
        algorithm: str = "ed25519"
    ) -> bool:
        """
        Verify cryptographic signature and check for replay attacks
        """
        # 1. Check timestamp freshness
        timestamp = payload.get('timestamp')
        if not timestamp:
            raise SignatureVerificationError("Missing timestamp")
        
        current_time = time.time()
        age = current_time - timestamp
        
        if age > settings.SIGNATURE_MAX_AGE_SECONDS:
            logger.warning(f"Replay attack detected: payload age {age}s")
            raise ReplayAttackError(f"Payload expired: {age} seconds old")
        
        if age < -10:
            raise SignatureVerificationError("Future timestamp detected")
        
        # 2. Reconstruct signed message
        message = self._construct_message(payload)
        
        # 3. Get public key
        public_key_bytes = await self.get_public_key(device_id)
        
        # 4. Verify signature
        try:
            sig_bytes = bytes.fromhex(signature) if all(c in "0123456789abcdefABCDEF" for c in signature) else signature.encode('utf-8')
            
            if algorithm.lower() == "ed25519":
                public_key = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)
                public_key.verify(
                    sig_bytes,
                    message.encode('utf-8')
                )
            elif algorithm.lower() == "ecdsa":
                public_key = serialization.load_pem_public_key(public_key_bytes)
                public_key.verify(
                    sig_bytes,
                    message.encode('utf-8'),
                    ec.ECDSA(hashes.SHA256())
                )
            else:
                raise SignatureVerificationError(f"Unsupported algorithm: {algorithm}")
            
            logger.info(f"✅ Signature verified for device {device_id}")
            return True
            
        except InvalidSignature:
            logger.error(f"❌ Invalid signature for device {device_id}")
            raise SignatureVerificationError("Signature verification failed")
    
    def _construct_message(self, payload: dict) -> str:
        """Construct deterministic message string for signing"""
        sorted_items = sorted(payload.items())
        return "|".join(f"{k}={v}" for k, v in sorted_items if k != 'signature')

verifier = DeviceAttestationVerifier()
