import logging
from typing import Dict, Any, Optional
from fastapi import Request
from ..models.database import SessionLocal, AuditLog

logger = logging.getLogger(__name__)

def setup_audit_logging():
    logger.info("🛡️ Audit logging middleware initialized")

def log_audit_event(
    event_type: str,
    device_id: Optional[str],
    request_data: Dict[str, Any],
    response_status: int,
    request: Request
):
    try:
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")
        
        db = SessionLocal()
        try:
            log_entry = AuditLog(
                event_type=event_type,
                device_id=device_id,
                ip_address=client_ip,
                user_agent=user_agent,
                request_data=request_data,
                response_status=response_status
            )
            db.add(log_entry)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Audit event recording failed: {e}")
