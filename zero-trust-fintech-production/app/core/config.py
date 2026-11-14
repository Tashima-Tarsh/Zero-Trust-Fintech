from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/fintech_db"
    DATABASE_POOL_SIZE: int = 20
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_CHALLENGE_TTL: int = 300  # 5 minutes
    
    # Security
    SIGNATURE_MAX_AGE_SECONDS: int = 60
    FRESHNESS_WINDOW_SECONDS: int = 120
    
    # n8n
    N8N_WEBHOOK_URL: str = "http://n8n:5678/webhook"
    N8N_API_KEY: str = "default_n8n_key"
    
    # WebSocket
    WS_PING_INTERVAL: int = 30
    WS_PING_TIMEOUT: int = 10
    
    # Logging
    LOG_LEVEL: str = "INFO"
    
    class Config:
        env_file = ".env"
        case_sensitive = True

@lru_cache()
def get_settings() -> Settings:
    return Settings()
