from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import timedelta
import logging
import secrets
import hashlib
import hmac
from ..models.database import get_db, Merchant, MerchantUser
from ..core.auth import (
    create_access_token,
    create_refresh_token,
    verify_token,
    get_current_merchant_user,
    AuthError,
)
from ..core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/auth", tags=["authentication"])


# Password hashing abstraction with robust direct bcrypt support and PBKDF2-HMAC-SHA256 fallback
class PasswordManager:
    """Production-grade password hashing manager supporting direct bcrypt,
    NIST-compliant PBKDF2-HMAC-SHA256, and safe fallback verification."""

    def __init__(self):
        self._bcrypt = None
        try:
            import bcrypt

            self._bcrypt = bcrypt
        except ImportError:
            self._bcrypt = None

    def hash(self, password: str) -> str:
        if not password:
            raise ValueError("Password cannot be empty")
        if self._bcrypt is not None:
            try:
                pw_bytes = password.encode("utf-8")
                if len(pw_bytes) > 72:
                    pw_bytes = pw_bytes[:72]
                salt = self._bcrypt.gensalt(rounds=12)
                return self._bcrypt.hashpw(pw_bytes, salt).decode("utf-8")
            except Exception as e:
                logger.warning(f"Bcrypt hashing error, falling back to PBKDF2: {e}")

        salt = secrets.token_hex(16)
        key = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000
        )
        return f"pbkdf2_sha256${salt}${key.hex()}"

    def verify(self, password: str, hashed: str) -> bool:
        if not password or not hashed:
            return False

        # 1. Bcrypt hash check ($2a$, $2b$, $2y$)
        if hashed.startswith(("$2a$", "$2b$", "$2y$")):
            if self._bcrypt is not None:
                try:
                    pw_bytes = password.encode("utf-8")
                    if len(pw_bytes) > 72:
                        pw_bytes = pw_bytes[:72]
                    return self._bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))
                except Exception:
                    pass
            try:
                from passlib.context import CryptContext

                ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
                return ctx.verify(password, hashed)
            except Exception:
                pass
            return False

        # 2. PBKDF2-HMAC-SHA256 check
        if hashed.startswith("pbkdf2_sha256$"):
            parts = hashed.split("$")
            if len(parts) == 3:
                salt, expected_hex = parts[1], parts[2]
                computed = hashlib.pbkdf2_hmac(
                    "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000
                )
                return hmac.compare_digest(computed.hex(), expected_hex)
            return False

        # 3. Direct SHA-256 fallback for testing / legacy compatibility
        try:
            return hmac.compare_digest(
                hashlib.sha256(password.encode("utf-8")).hexdigest(), hashed
            )
        except Exception:
            return False


pwd_context = PasswordManager()


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate merchant user and issue access & refresh tokens"""
    user = db.query(MerchantUser).filter(MerchantUser.email == request.email).first()

    if not user or not pwd_context.verify(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive"
        )

    # Create tokens
    access_token = create_access_token(
        data={"sub": user.id, "merchant_id": user.merchant_id}
    )
    refresh_token = create_refresh_token(
        data={"sub": user.id, "merchant_id": user.merchant_id}
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=getattr(settings, "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 60) * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: RefreshRequest, db: Session = Depends(get_db)):
    """Refresh expired access token using valid refresh token"""
    try:
        payload = verify_token(request.refresh_token)

        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid refresh token type",
            )

        user_id = payload.get("sub")
        merchant_id = payload.get("merchant_id")

        # Verify user still exists and is active
        user = (
            db.query(MerchantUser)
            .filter(
                MerchantUser.id == user_id,
                MerchantUser.merchant_id == merchant_id,
                MerchantUser.is_active.is_(True),
            )
            .first()
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )

        # Create new tokens
        new_access_token = create_access_token(
            data={"sub": user.id, "merchant_id": user.merchant_id}
        )
        new_refresh_token = create_refresh_token(
            data={"sub": user.id, "merchant_id": user.merchant_id}
        )

        return TokenResponse(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            expires_in=getattr(settings, "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 60) * 60,
        )

    except (AuthError, Exception) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid refresh token: {str(e)}",
        )


@router.post("/websocket-token")
async def get_websocket_token(
    current_user: MerchantUser = Depends(get_current_merchant_user),
):
    """Generate scoped WebSocket token for authenticated merchant session"""
    token = create_access_token(
        data={
            "sub": current_user.id,
            "merchant_id": current_user.merchant_id,
            "type": "websocket",
        },
        expires_delta=timedelta(hours=24),
    )

    return {
        "token": token,
        "expires_in": 86400,
        "merchant_id": current_user.merchant_id,
    }
