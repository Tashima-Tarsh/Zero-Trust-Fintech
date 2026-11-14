from pydantic_settings import BaseSettings
from functools import lru_cache
import os

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://zerotrust:SecurePass123!@localhost:5432/zerotrust_ledger"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_CHALLENGE_TTL: int = 300
    
    # Security
    SIGNATURE_MAX_AGE_SECONDS: int = 60
    FRESHNESS_WINDOW_SECONDS: int = 120
    SECRET_KEY: str = "zerotrust-fintech-jwt-secret-key-32bytes-minimum!"
    JWT_ALGORITHM: str = "HS256"
    
    # n8n
    N8N_WEBHOOK_URL: str = "http://localhost:5678/webhook"
    N8N_API_KEY: str = ""
    
    # WebSocket
    WS_PING_INTERVAL: int = 30
    WS_PING_TIMEOUT: int = 10
    
    # Logging
    LOG_LEVEL: str = "INFO"
    AUDIT_LOG_PATH: str = "./logs/audit.log"
    
    # Application
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    
    class Config:
        env_file = ".env"
        case_sensitive = True

@lru_cache()
def get_settings() -> Settings:
    return Settings()
