from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
import logging
import json
import hmac
import hashlib
import base64
from ..models.database import get_db, Merchant, MerchantUser
from ..core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
security = HTTPBearer(auto_error=False)

class AuthError(Exception):
    pass

# Helper functions for RFC 7519 JWT encoding/decoding without hard dependency on jose
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

def _b64url_decode(data_str: str) -> bytes:
    pad = len(data_str) % 4
    if pad:
        data_str += '=' * (4 - pad)
    return base64.urlsafe_b64decode(data_str)

def _get_jwt_secret() -> str:
    return getattr(settings, "JWT_SECRET_KEY", None) or getattr(settings, "SECRET_KEY", "zerotrust-fintech-jwt-secret-key-32bytes-minimum!")

def _jwt_encode(payload: dict, secret: str, algorithm: str = "HS256") -> str:
    try:
        from jose import jwt
        return jwt.encode(payload, secret, algorithm=algorithm)
    except ImportError:
        header = {"alg": algorithm, "typ": "JWT"}
        h_b64 = _b64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
        p_b64 = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
        msg = f"{h_b64}.{p_b64}"
        sig = hmac.new(secret.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()
        return f"{msg}.{_b64url_encode(sig)}"

def _jwt_decode(token: str, secret: str, algorithms: list = None) -> dict:
    try:
        from jose import jwt, JWTError
        return jwt.decode(token, secret, algorithms=algorithms or ["HS256"])
    except ImportError:
        if not token or not isinstance(token, str):
            raise AuthError("Token missing or not a string")
        parts = token.strip().split('.')
        if len(parts) != 3:
            raise AuthError("Invalid JWT token format")
        
        h_b64, p_b64, s_b64 = parts
        try:
            header = json.loads(_b64url_decode(h_b64).decode("utf-8"))
        except (ValueError, UnicodeError) as e:
            raise AuthError("Malformed JWT header") from e
        if header.get("alg") != "HS256" or header.get("typ") != "JWT":
            raise AuthError("Unsupported JWT header")
        msg = f"{h_b64}.{p_b64}"
        expected_sig = hmac.new(secret.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_encode(expected_sig), s_b64):
            raise AuthError("JWT signature mismatch")
        
        try:
            payload = json.loads(_b64url_decode(p_b64).decode('utf-8'))
        except Exception as e:
            raise AuthError(f"Malformed JWT payload: {e}")
        
        exp = payload.get("exp")
        if isinstance(exp, bool) or not isinstance(exp, (int, float)):
            raise AuthError("JWT expiration missing or invalid")
        if exp <= datetime.now(timezone.utc).timestamp():
            raise AuthError("JWT token has expired")
        return payload
    except Exception as e:
        raise AuthError(f"Invalid token: {str(e)}")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=getattr(settings, "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 60)))
    token_type = to_encode.get("type", "access")
    if token_type not in ("access", "websocket"):
        raise ValueError("Unsupported access token purpose")
    to_encode.update({"exp": int(expire.timestamp()), "iat": int(now.timestamp()), "type": token_type})
    secret = _get_jwt_secret()
    return _jwt_encode(to_encode, secret, algorithm=getattr(settings, "JWT_ALGORITHM", "HS256"))

def create_refresh_token(data: dict) -> str:
    """Create JWT refresh token"""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=getattr(settings, "JWT_REFRESH_TOKEN_EXPIRE_DAYS", 7))
    to_encode.update({"exp": int(expire.timestamp()), "iat": int(now.timestamp()), "type": "refresh"})
    secret = _get_jwt_secret()
    return _jwt_encode(to_encode, secret, algorithm=getattr(settings, "JWT_ALGORITHM", "HS256"))

def verify_token(token: str) -> dict:
    """Verify and decode JWT token"""
    secret = _get_jwt_secret()
    try:
        return _jwt_decode(token, secret, algorithms=[getattr(settings, "JWT_ALGORITHM", "HS256")])
    except Exception as e:
        raise AuthError(f"Invalid token: {str(e)}")

async def get_current_merchant_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> MerchantUser:
    """Get authenticated merchant user from JWT token"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = verify_token(credentials.credentials)
        user_id = payload.get("sub")
        merchant_id = payload.get("merchant_id")
        
        if not user_id or not merchant_id or payload.get("type") != "access":
            raise AuthError("Invalid access token scope or purpose")
        
        # Verify user exists and is active
        user = db.query(MerchantUser).filter(
            MerchantUser.id == user_id,
            MerchantUser.merchant_id == merchant_id,
            MerchantUser.is_active == True
        ).first()
        
        if not user:
            raise AuthError("User not found or inactive")
        
        return user
        
    except AuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_merchant(
    current_user: MerchantUser = Depends(get_current_merchant_user),
    db: Session = Depends(get_db)
) -> Merchant:
    """Get authenticated merchant from user credentials"""
    merchant = db.query(Merchant).filter(
        Merchant.id == current_user.merchant_id,
        Merchant.is_active == True
    ).first()
    
    if not merchant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Merchant not found or inactive"
        )
    
    return merchant

def verify_websocket_token(token: str, merchant_id: str) -> dict:
    """Verify WebSocket token with merchant scope"""
    try:
        payload = verify_token(token)
        token_merchant = payload.get("merchant_id")
        token_user = payload.get("sub")
        
        # Check merchant scope
        if token_merchant != merchant_id or not token_user:
            raise AuthError("Token not authorized for this merchant")
        
        # WebSocket tokens cannot be exchanged for ordinary API access.
        token_type = payload.get("type")
        if token_type != "websocket":
            raise AuthError(f"Invalid token type for WebSocket: {token_type}")
        
        return payload
        
    except AuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
