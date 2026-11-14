from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache
import os


class CloudSettings(BaseSettings):
    """Cloud-native configuration for zero-trust fintech backend"""

    # Database (supports cloud providers such as AWS RDS, GCP Cloud SQL, Supabase)
    DATABASE_URL: str = (
        "postgresql://zerotrust:SecurePass123!@localhost:5432/zerotrust_ledger"
    )
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_RECYCLE: int = (
        3600  # Important for managed cloud DBs to prevent stale connections
    )

    # Redis (supports managed Redis: ElastiCache, Upstash, Redis Enterprise)
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_SSL: bool = False
    REDIS_POOL_SIZE: int = 50

    # Cloud provider detection
    CLOUD_PROVIDER: Optional[str] = None  # aws, gcp, azure

    # Health check
    HEALTH_CHECK_INTERVAL: int = 30

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "allow"


@lru_cache()
def get_cloud_settings() -> CloudSettings:
    return CloudSettings()
