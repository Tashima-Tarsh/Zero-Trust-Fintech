from fastapi import APIRouter, status, Response
from sqlalchemy import text
from ..models.database import engine
from ..services.redis_service import redis_client
from ..core.config import get_settings
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """Basic health check for container orchestration and uptime monitoring"""
    return {"status": "healthy", "service": "zero-trust-fintech", "version": "2.0.0"}


@router.get("/health/detailed")
async def detailed_health_check(response: Response):
    """Detailed health check inspecting database, cache, and orchestration connectivity"""
    health_status = {"status": "healthy", "checks": {}}

    # 1. Check PostgreSQL
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        health_status["checks"]["database"] = {"status": "healthy"}
    except Exception as e:
        health_status["checks"]["database"] = {"status": "unhealthy", "error": str(e)}
        health_status["status"] = "unhealthy"

    # 2. Check Redis
    try:
        if hasattr(redis_client, "ping"):
            await redis_client.ping()
        health_status["checks"]["redis"] = {"status": "healthy"}
    except Exception as e:
        health_status["checks"]["redis"] = {"status": "unhealthy", "error": str(e)}
        health_status["status"] = "unhealthy"

    # 3. Check n8n Orchestrator
    try:
        import httpx

        settings = get_settings()
        n8n_url = getattr(settings, "N8N_WEBHOOK_URL", "http://n8n:5678")
        base_n8n = n8n_url.split("/webhook")[0] if "/webhook" in n8n_url else n8n_url
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{base_n8n}/healthz", timeout=2.0)
            if resp.status_code == 200:
                health_status["checks"]["n8n"] = {"status": "healthy"}
            else:
                health_status["checks"]["n8n"] = {"status": "degraded"}
    except Exception as e:
        health_status["checks"]["n8n"] = {"status": "optional", "info": str(e)}

    if health_status["status"] != "healthy":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return health_status


@router.get("/health/ready")
async def readiness_check(response: Response):
    """Kubernetes readiness probe - verifies app is ready to serve traffic"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        if hasattr(redis_client, "ping"):
            await redis_client.ping()
        return {"status": "ready"}
    except Exception as e:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready", "error": str(e)}


@router.get("/health/live")
async def liveness_check():
    """Kubernetes liveness probe - verifies process is running"""
    return {"status": "alive"}
