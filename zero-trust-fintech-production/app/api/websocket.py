from fastapi import WebSocket, WebSocketDisconnect
import logging
from typing import Dict, Set

logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Manages WebSocket connections for real-time payment confirmations
    """
    
    def __init__(self):
        # merchant_id -> set of websocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, merchant_id: str):
        await websocket.accept()
        if merchant_id not in self.active_connections:
            self.active_connections[merchant_id] = set()
        self.active_connections[merchant_id].add(websocket)
        logger.info(f"✅ WebSocket connected: merchant {merchant_id}")
    
    def disconnect(self, websocket: WebSocket, merchant_id: str):
        if merchant_id in self.active_connections:
            self.active_connections[merchant_id].discard(websocket)
            if not self.active_connections[merchant_id]:
                del self.active_connections[merchant_id]
        logger.info(f"❌ WebSocket disconnected: merchant {merchant_id}")
    
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
        
        # Clean up disconnected sockets
        for conn in disconnected:
            self.active_connections[merchant_id].discard(conn)

manager = ConnectionManager()

async def websocket_endpoint(websocket: WebSocket, merchant_id: str):
    """
    WebSocket endpoint for real-time payment confirmations
    """
    await manager.connect(websocket, merchant_id)
    
    try:
        while True:
            # Keep connection alive with ping/pong
            data = await websocket.receive_text()
            
            # Handle client messages
            if data == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, merchant_id)
    except Exception as e:
        logger.warning(f"WebSocket closed: {e}")
        manager.disconnect(websocket, merchant_id)
