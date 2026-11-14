from fastapi import WebSocket, WebSocketDisconnect, status, Query
import logging
from typing import Dict, Set, Optional
from ..core.auth import verify_websocket_token, AuthError
from ..core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class ConnectionManager:
    """
    Manages authenticated WebSocket connections for real-time payment confirmations.
    """

    def __init__(self):
        # merchant_id -> set of active websocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # websocket -> merchant_id reverse map
        self.connection_merchant_map: Dict[WebSocket, str] = {}

    async def connect(
        self, websocket: WebSocket, merchant_id: str, merchant_user_id: str
    ):
        """Accept and register authenticated WebSocket connection"""
        await websocket.accept()
        if merchant_id not in self.active_connections:
            self.active_connections[merchant_id] = set()
        self.active_connections[merchant_id].add(websocket)
        self.connection_merchant_map[websocket] = merchant_id
        logger.info(
            f"✅ Authenticated WebSocket connected: merchant {merchant_id}, user {merchant_user_id}"
        )

    def disconnect(self, websocket: WebSocket):
        """Clean up connection upon close"""
        merchant_id = self.connection_merchant_map.get(websocket)
        if merchant_id and merchant_id in self.active_connections:
            self.active_connections[merchant_id].discard(websocket)
            if not self.active_connections[merchant_id]:
                del self.active_connections[merchant_id]
        if websocket in self.connection_merchant_map:
            del self.connection_merchant_map[websocket]
        logger.info(f"❌ WebSocket disconnected: merchant {merchant_id or 'unknown'}")

    async def broadcast_to_merchant(self, merchant_id: str, message: Dict):
        """
        Send instant confirmation to all connected sessions for a merchant
        """
        if merchant_id not in self.active_connections:
            logger.warning(f"No active connections for merchant {merchant_id}")
            return

        disconnected = set()
        for connection in list(self.active_connections[merchant_id]):
            try:
                await connection.send_json(message)
            except WebSocketDisconnect:
                disconnected.add(connection)
            except Exception as e:
                logger.error(f"Error sending to websocket: {e}")
                disconnected.add(connection)

        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()


async def websocket_endpoint(
    websocket: WebSocket,
    merchant_id: str,
    token: Optional[str] = Query(None, description="JWT token for authentication"),
):
    """
    WebSocket endpoint with JWT-based merchant authentication and scope checking
    """
    merchant_user_id = merchant_id

    # 1. Verify token if provided
    if token:
        try:
            payload = verify_websocket_token(token, merchant_id)
            merchant_user_id = payload.get("sub") or merchant_id
        except Exception as e:
            logger.warning(f"❌ WebSocket JWT authentication failed: {e}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    else:
        # In production, require authentication token
        if getattr(settings, "APP_ENV", "development").lower() == "production":
            logger.warning(
                f"❌ WebSocket rejected: Missing required auth token in production for '{merchant_id}'"
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    # 2. Register connection
    await manager.connect(websocket, merchant_id, merchant_user_id)

    # 3. Connection lifecycle loop
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket session closed: {e}")
        manager.disconnect(websocket)
