import logging
import json
from datetime import datetime
from fastapi import Request
from ..models.database import AuditLog, SessionLocal

logger = logging.getLogger(__name__)

def setup_audit_logging():
    """Setup audit logging"""
    logging.getLogger("audit").setLevel(logging.INFO)

def log_audit_event(
    event_type: str,
    device_id: str = None,
    ip_address: str = None,
    user_agent: str = None,
    request_data: dict = None,
    response_status: int = None,
    request: Request = None
):
    """Log audit event to database"""
    try:
        db = SessionLocal()
        
        # Extract IP and user agent from request if available
        if request:
            ip_address = request.client.host if request.client else ip_address
            user_agent = request.headers.get("user-agent", user_agent)
        
        audit_log = AuditLog(
            event_type=event_type,
            device_id=device_id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_data=json.dumps(request_data) if request_data else None,
            response_status=response_status
        )
        
        db.add(audit_log)
        db.commit()
        db.close()
        
        logger.info(f"Audit: {event_type} | Device: {device_id} | IP: {ip_address}")
    except Exception as e:
        logger.error(f"Failed to log audit event: {e}")
