import asyncio
import logging
import json
from datetime import datetime
from fastapi import Request
from ..models.database import AuditLog, SessionLocal

logger = logging.getLogger(__name__)

# Fields that must never be written verbatim into the audit trail.
REDACTED_FIELDS = {
    "challenge_id",
    "challenge_secret",
    "expected_hash",
    "utr",
    "signature",
    "device_id",
    "nonce",
    "password",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "api_secret",
}


def _redact(data):
    """Return a copy of `data` with sensitive fields replaced by [REDACTED]."""
    if not isinstance(data, dict):
        return data
    out = {}
    for k, v in data.items():
        if k.lower() in REDACTED_FIELDS:
            out[k] = "[REDACTED]"
        elif isinstance(v, (dict, list)):
            out[k] = _redact(v)
        else:
            out[k] = v
    return out


def _write_audit_log(event_type, device_id, ip_address, user_agent, request_data, response_status):
    """Blocking DB write, executed off the event loop."""
    db = SessionLocal()
    try:
        audit_log = AuditLog(
            event_type=event_type,
            device_id=device_id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_data=json.dumps(request_data) if request_data else None,
            response_status=response_status,
        )
        db.add(audit_log)
        db.commit()
        logger.info(f"Audit: {event_type} | Device: {device_id} | IP: {ip_address}")
    except Exception as e:
        logger.error(f"Failed to log audit event: {e}")
    finally:
        db.close()


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
    request: Request = None,
):
    """Log audit event to database without blocking the event loop.

    Sensitive payload fields are redacted before storage. The blocking SQLAlchemy
    write is dispatched to a thread executor so the async request path is not stalled.
    """
    try:
        if request:
            ip_address = request.client.host if request.client else ip_address
            user_agent = request.headers.get("user-agent", user_agent)

        safe_data = _redact(request_data) if request_data else None

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            loop.run_in_executor(
                None,
                _write_audit_log,
                event_type,
                device_id,
                ip_address,
                user_agent,
                safe_data,
                response_status,
            )
        else:
            _write_audit_log(
                event_type,
                device_id,
                ip_address,
                user_agent,
                safe_data,
                response_status,
            )
    except Exception as e:
        logger.error(f"Failed to schedule audit event: {e}")
