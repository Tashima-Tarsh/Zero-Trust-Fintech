import redis.asyncio as redis
from ..core.config import get_settings

settings = get_settings()

# Redis client with connection pooling
redis_client = redis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=False,
    max_connections=50
)

async def init_redis():
    """Initialize Redis connection"""
    try:
        await redis_client.ping()
        print("✅ Redis connected")
    except Exception as e:
        print(f"❌ Redis connection failed: {e}")
        # Allow running in local dev / mock mode if redis is not running
        pass

async def close_redis():
    """Close Redis connection"""
    try:
        await redis_client.close()
    except Exception:
        pass
