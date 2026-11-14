from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from contextlib import asynccontextmanager
from .core.config import get_settings
from .api.routes import router
from .api.websocket import websocket_endpoint
from .models.database import engine, Base
from .services.redis_service import init_redis, close_redis
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
    yield
    # Shutdown
    logger.info("🛑 Shutting down Zero-Trust Fintech API")
    await close_redis()

app = FastAPI(
    title="Zero-Trust Fintech API",
    description="SharePay MVP: Direct UPI checkout with 5-layer fraud detection and instant confirmation",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")

# WebSocket endpoint for instant merchant confirmation
@app.websocket("/ws/{merchant_id}")
async def websocket_route(websocket: WebSocket, merchant_id: str):
    await websocket_endpoint(websocket, merchant_id)

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "zero-trust-fintech", "version": "2.0.0"}
