from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache
import os
import logging

try:
    from pydantic import field_validator
    def validator_compat(*fields, **kwargs):
        return field_validator(*fields, mode='after', **kwargs)
except ImportError:
    from pydantic import validator
    def validator_compat(*fields, **kwargs):
        return validator(*fields, **kwargs)

logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://zerotrust:SecurePass123!@localhost:5432/zerotrust_ledger"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_RECYCLE: int = 3600
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_SSL: bool = False
    REDIS_CHALLENGE_TTL: int = 300
    CHALLENGE_TTL_SECONDS: int = 300
    
    # JWT Authentication
    JWT_SECRET_KEY: str = "zerotrust-fintech-jwt-secret-key-32bytes-minimum!"
    SECRET_KEY: str = "zerotrust-fintech-jwt-secret-key-32bytes-minimum!"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Security Thresholds
    SIGNATURE_MAX_AGE_SECONDS: int = 60
    FRESHNESS_WINDOW_SECONDS: int = 120
    
    # n8n Orchestrator
    N8N_WEBHOOK_URL: str = "http://localhost:5678/webhook"
    N8N_API_KEY: str = ""
    
    # External Services & Alerts
    BANK_SETTLEMENT_API: str = "https://api.bank.com/settlement"
    BANK_API_KEY: str = ""
    SLACK_WEBHOOK_URL: str = ""
    FCM_SERVER_KEY: str = ""
    
    # WebSocket Configuration
    WS_PING_INTERVAL: int = 30
    WS_PING_TIMEOUT: int = 10
    
    # Logging
    LOG_LEVEL: str = "INFO"
    AUDIT_LOG_PATH: str = "./logs/audit.log"
    
    # CORS Security
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5173",
    ]
    
    # Application Lifecycle
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    CLOUD_PROVIDER: Optional[str] = None
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "allow"
    
    @validator_compat('JWT_SECRET_KEY')
    def validate_jwt_secret(cls, v):
        if v == "CHANGE_THIS_TO_A_RANDOM_64_CHAR_STRING":
            raise ValueError("JWT_SECRET_KEY must be changed from default placeholder")
        if len(v) < 32:
            raise ValueError("JWT_SECRET_KEY must be at least 32 characters for security")
        return v
    
    @validator_compat('DATABASE_URL')
    def validate_database_url(cls, v):
        if "password" in v and "CHANGE_THIS" in v:
            raise ValueError("DATABASE_URL must be configured with actual production credentials")
        return v
    
    @validator_compat('N8N_API_KEY')
    def validate_n8n_key(cls, v):
        if v == "CHANGE_THIS":
            raise ValueError("N8N_API_KEY must be configured or left blank for unauthenticated dev")
        return v

@lru_cache()
def get_settings() -> Settings:
    try:
        return Settings()
    except Exception as e:
        logger.error(f"❌ Configuration error: {e}")
        raise
