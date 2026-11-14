import asyncio
from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from typing import Optional
from contextlib import asynccontextmanager
from .core.config import get_settings
from .core.health import router as health_router
from .api.routes import router as api_router
from .api.auth_routes import router as auth_router
from .api.websocket import websocket_endpoint
from .models.database import engine, Base
from .services.redis_service import init_redis, close_redis
from .services.notification_service import notification_service
from .services.forensics_service import forensics_service
from .middleware.audit import setup_audit_logging

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 Starting Zero-Trust Fintech API")
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.warning(f"Database schema init notice: {e}")
    await init_redis()
    setup_audit_logging()
    
    # Background workers (P1-4 Notification Retry & P2-2 Forensics Triage)
    retry_task = asyncio.create_task(notification_service.process_retry_queue())
    forensics_task = asyncio.create_task(forensics_service.process_forensics_queue())
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down Zero-Trust Fintech API")
    retry_task.cancel()
    forensics_task.cancel()
    try:
        await asyncio.gather(retry_task, forensics_task, return_exceptions=True)
    except Exception:
        pass
    await close_redis()

app = FastAPI(
    title="Zero-Trust Fintech API",
    description="SharePay MVP: Direct UPI checkout with 5-layer fraud detection, atomic challenge verification, and Merkle ledger",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=getattr(settings, "CORS_ORIGINS", None) or [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Core & Feature Routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(api_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")

@app.websocket("/ws/{merchant_id}")
async def websocket_route(
    websocket: WebSocket,
    merchant_id: str,
    token: Optional[str] = Query(None, description="JWT token with merchant authorization scope")
):
    """Authenticated WebSocket endpoint with merchant scoping (P0-1)"""
    await websocket_endpoint(websocket, merchant_id, token)

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
