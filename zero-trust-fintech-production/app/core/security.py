import time
import logging
import base64
import binascii
from typing import Optional
from datetime import datetime
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
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

HEX_CHARS = set("0123456789abcdefABCDEF")
B64_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_")

def decode_signature(signature: str) -> bytes:
    """
    Decodes signature string strictly from Hexadecimal or Base64/Base64URL.
    Rejects malformed, empty, unencoded strings, or invalid character sets.
    Never treats raw string characters directly as signature bytes.
    """
    if not signature or not isinstance(signature, str):
        raise SignatureVerificationError("Signature must be a non-empty string")
    
    clean_sig = signature.strip()
    if not clean_sig:
        raise SignatureVerificationError("Signature cannot be empty or whitespace")
    
    # Strictly reject any character not belonging to Hex or Base64/Base64URL
    if not all(c in B64_CHARS for c in clean_sig):
        raise SignatureVerificationError("Signature contains invalid characters (not valid Hex or Base64)")
    
    # 1. Try Hexadecimal decoding if string consists of valid hex digits and even length
    if len(clean_sig) % 2 == 0 and all(c in HEX_CHARS for c in clean_sig):
        if len(clean_sig) == 128 or len(clean_sig) >= 64:
            try:
                return bytes.fromhex(clean_sig)
            except ValueError:
                pass
            
    # 2. Try Base64 / Base64URL decoding with strict validation
    try:
        pad_len = len(clean_sig) % 4
        padded = clean_sig + ('=' * (4 - pad_len) if pad_len else '')
        
        standard_b64 = padded.replace('-', '+').replace('_', '/')
        decoded = base64.b64decode(standard_b64, validate=True)
        if not decoded:
            raise SignatureVerificationError("Decoded signature cannot be empty")
        return decoded
    except Exception as b64_err:
        if len(clean_sig) % 2 == 0 and all(c in HEX_CHARS for c in clean_sig):
            try:
                return bytes.fromhex(clean_sig)
            except ValueError:
                pass
        raise SignatureVerificationError(f"Malformed signature encoding (neither valid Base64 nor Hex): {b64_err}")

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
                    # Check if hex string (32 bytes = 64 hex chars for ed25519)
                    if len(pub_str) == 64 and all(c in "0123456789abcdefABCDEF" for c in pub_str):
                        key_bytes = bytes.fromhex(pub_str)
                    elif pub_str.startswith("-----BEGIN"):
                        key_bytes = pub_str.encode('utf-8')
                    else:
                        # Base64 encoded or raw bytes
                        try:
                            pad_len = len(pub_str) % 4
                            padded = pub_str + ('=' * (4 - pad_len) if pad_len else '')
                            key_bytes = base64.b64decode(padded)
                        except Exception:
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
        Verify cryptographic signature strictly and check for replay attacks.
        Enforces 64-byte length on Ed25519 and rejects raw string encodings.
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
        
        # 2. Reconstruct deterministic signed message
        message = self._construct_message(payload)
        
        # 3. Get public key
        public_key_bytes = await self.get_public_key(device_id)
        
        # 4. Strict decoding of signature bytes (never treat raw string as bytes)
        sig_bytes = decode_signature(signature)
        
        # 5. Algorithm-specific validation and cryptographic verification
        algo_lower = algorithm.lower().strip()
        
        if algo_lower == "ed25519":
            if len(sig_bytes) != 64:
                raise SignatureVerificationError(
                    f"Invalid Ed25519 signature length: expected 64 bytes, got {len(sig_bytes)}"
                )
            
            try:
                if len(public_key_bytes) == 32:
                    public_key = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)
                else:
                    public_key = serialization.load_pem_public_key(public_key_bytes)
                    if not isinstance(public_key, ed25519.Ed25519PublicKey):
                        raise SignatureVerificationError("Key is not an Ed25519 public key")
            except Exception as e:
                raise SignatureVerificationError(f"Invalid Ed25519 public key: {e}")
            
            try:
                public_key.verify(sig_bytes, message.encode('utf-8'))
            except InvalidSignature:
                logger.error(f"❌ Invalid Ed25519 signature for device {device_id}")
                raise SignatureVerificationError("Signature verification failed")
                
        elif algo_lower in ("ecdsa", "ecdsa-sha256", "p256", "secp256r1"):
            try:
                if public_key_bytes.startswith(b"-----BEGIN"):
                    public_key = serialization.load_pem_public_key(public_key_bytes)
                else:
                    public_key = serialization.load_der_public_key(public_key_bytes)
            except Exception as e:
                raise SignatureVerificationError(f"Invalid ECDSA public key: {e}")
            
            try:
                public_key.verify(
                    sig_bytes,
                    message.encode('utf-8'),
                    ec.ECDSA(hashes.SHA256())
                )
            except InvalidSignature:
                # Support raw IEEE P1363 (64 bytes: r[32] || s[32]) from Android KeyStore
                if len(sig_bytes) == 64:
                    try:
                        r = int.from_bytes(sig_bytes[:32], byteorder='big')
                        s = int.from_bytes(sig_bytes[32:], byteorder='big')
                        der_sig = encode_dss_signature(r, s)
                        public_key.verify(
                            der_sig,
                            message.encode('utf-8'),
                            ec.ECDSA(hashes.SHA256())
                        )
                    except Exception:
                        logger.error(f"❌ Invalid ECDSA signature for device {device_id}")
                        raise SignatureVerificationError("Signature verification failed")
                else:
                    logger.error(f"❌ Invalid ECDSA signature for device {device_id}")
                    raise SignatureVerificationError("Signature verification failed")
        else:
            raise SignatureVerificationError(f"Unsupported algorithm: {algorithm}")
            
        logger.info(f"✅ Signature verified for device {device_id}")
        return True
    
    def _construct_message(self, payload: dict) -> str:
        """Construct deterministic message string for signing"""
        sorted_items = sorted(payload.items())
        return "|".join(f"{k}={v}" for k, v in sorted_items if k != 'signature')

verifier = DeviceAttestationVerifier()

# =============================================================================
# JWT AUTHENTICATION FOR WEBSOCKET & MERCHANT ACCESS
# =============================================================================

import hmac

class JWTError(Exception):
    pass

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

def _b64url_decode(data_str: str) -> bytes:
    pad = len(data_str) % 4
    if pad:
        data_str += '=' * (4 - pad)
    return base64.urlsafe_b64decode(data_str)

def create_jwt_token(merchant_id: str, user_id: str = None, expires_in_seconds: int = 86400) -> str:
    """
    Create signed HS256 JWT token for authenticated WebSocket and API access.
    """
    secret = getattr(settings, "SECRET_KEY", "zerotrust-fintech-jwt-secret-key-32bytes-minimum!")
    user_id = user_id or merchant_id
    now = time.time()
    payload = {
        "sub": user_id,
        "merchant_id": merchant_id,
        "iat": int(now),
        "exp": int(now + expires_in_seconds)
    }
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = _b64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    p_b64 = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    msg = f"{h_b64}.{p_b64}"
    # Use hashlib.sha256 directly for hmac
    import hashlib
    sig = hmac.new(secret.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()
    return f"{msg}.{_b64url_encode(sig)}"

def verify_jwt_token(token: str) -> dict:
    """
    Verify and decode HS256 JWT token. Raises JWTError if signature mismatch or expired.
    """
    if not token or not isinstance(token, str):
        raise JWTError("Token missing or not a string")
    
    parts = token.strip().split('.')
    if len(parts) != 3:
        raise JWTError("Invalid JWT token format")
    
    h_b64, p_b64, s_b64 = parts
    secret = getattr(settings, "SECRET_KEY", "zerotrust-fintech-jwt-secret-key-32bytes-minimum!")
    msg = f"{h_b64}.{p_b64}"
    
    import hashlib
    expected_sig = hmac.new(secret.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64url_encode(expected_sig), s_b64):
        raise JWTError("JWT signature mismatch")
    
    try:
        payload = json.loads(_b64url_decode(p_b64).decode('utf-8'))
    except Exception as e:
        raise JWTError(f"Malformed JWT payload: {e}")
        
    exp = payload.get("exp")
    if exp and exp < time.time():
        raise JWTError("JWT token has expired")
        
    return payload
