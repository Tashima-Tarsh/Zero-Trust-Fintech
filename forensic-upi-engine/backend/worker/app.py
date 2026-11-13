"""Server-only UPI session allocator and mock provider-event adapter.

All payment completion must ultimately be checked against a contracted bank/PSP.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from typing import Literal

from python_nodes.behavior_scorer import score_behavior
from python_nodes.utl_validator import validate_utr

app = FastAPI(title="Forensic UPI Engine", version="0.1.0", docs_url=None, redoc_url=None)
SESSION_TTL_MINUTES = 10


class SessionRequest(BaseModel):
    merchant_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    merchant_reference: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    amount_paise: int = Field(gt=0, le=100_000_000)
    note: str = Field(default="", max_length=100)
    currency: Literal["INR"] = "INR"


class ForensicRequest(BaseModel):
    elapsed_ms: int | None = Field(default=None, ge=0, le=86_400_000)
    retry_count: int = Field(default=0, ge=0, le=100)
    utr: str | None = Field(default=None, max_length=64)
    image_ela_score: float | None = Field(default=None, ge=0, le=100)


class ProviderEvent(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    session_id: UUID
    merchant_id: str = Field(min_length=1, max_length=80)
    merchant_reference: str = Field(min_length=1, max_length=128)
    amount_paise: int = Field(gt=0)
    currency: Literal["INR"] = "INR"
    vpa: str = Field(min_length=3, max_length=255)
    status: Literal["SUCCESS", "FAILED", "PENDING"]


def check_api_key(authorization: str | None) -> None:
    expected = os.getenv("WORKER_API_KEY", "")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Server authentication unconfigured")
    if not authorization or not hmac.compare_digest(authorization, "Bearer " + expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unauthorized")


def database():
    # Uses PGHOST / PGUSER / PGPASSWORD / PGDATABASE from container env.
    return psycopg.connect(connect_timeout=5, row_factory=dict_row)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict:
    with database() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1")
    return {"status": "ready"}


@app.post("/v1/sessions")
def create_session(body: SessionRequest, authorization: str | None = Header(default=None)):
    check_api_key(authorization)
    with database() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (body.merchant_id + ":" + body.merchant_reference,),
        )
        cur.execute(
            "SELECT * FROM payment_sessions WHERE merchant_id = %s AND merchant_reference = %s",
            (body.merchant_id, body.merchant_reference),
        )
        previous = cur.fetchone()
        if previous:
            if previous["amount_paise"] != body.amount_paise or previous["note"] != body.note:
                raise HTTPException(409, "Idempotency key reused with different payment details")
            return previous

        cur.execute(
            """SELECT vpa FROM vpa_pool
               WHERE merchant_id = %s AND enabled = TRUE AND health_status = 'healthy'
                 AND (leased_until IS NULL OR leased_until <= now())
               ORDER BY leased_until NULLS FIRST, vpa
               FOR UPDATE SKIP LOCKED LIMIT 1""",
            (body.merchant_id,),
        )
        candidate = cur.fetchone()
        if not candidate:
            raise HTTPException(409, "No approved, healthy VPA currently available")

        session_id = uuid4()
        expiry = datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES)
        cur.execute(
            "UPDATE vpa_pool SET leased_until = %s WHERE vpa = %s",
            (expiry, candidate["vpa"]),
        )
        cur.execute(
            """INSERT INTO payment_sessions
               (id, merchant_id, merchant_reference, amount_paise, currency, vpa, note, expires_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (
                session_id, body.merchant_id, body.merchant_reference, body.amount_paise,
                body.currency, candidate["vpa"], body.note, expiry,
            ),
        )
        return cur.fetchone()


@app.get("/v1/sessions/{session_id}")
def get_session(session_id: UUID, authorization: str | None = Header(default=None)):
    check_api_key(authorization)
    with database() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE payment_sessions SET status = 'EXPIRED'
               WHERE id = %s AND status = 'PENDING' AND expires_at <= now()""",
            (session_id,),
        )
        cur.execute("SELECT * FROM payment_sessions WHERE id = %s", (session_id,))
        found = cur.fetchone()
    if not found:
        raise HTTPException(404, "Session not found")
    return found


@app.post("/v1/forensics/score")
def forensic_score(body: ForensicRequest, authorization: str | None = Header(default=None)):
    check_api_key(authorization)
    utr_result = validate_utr(body.utr) if body.utr is not None else None
    result = score_behavior(
        elapsed_ms=body.elapsed_ms,
        retry_count=body.retry_count,
        utr_format_plausible=utr_result["format_plausible"] if utr_result else None,
        image_ela_score=body.image_ela_score,
    )
    result["utr_format"] = utr_result
    return result


@app.post("/v1/provider-events")
async def provider_event(
    request: Request,
    x_provider_timestamp: str | None = Header(default=None),
    x_provider_signature: str | None = Header(default=None),
):
    # This is a *mock adapter contract*, not a live bank authorization.
    secret = os.getenv("PROVIDER_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, "Provider integration unconfigured")
    raw = await request.body()
    if len(raw) > 16_384:
        raise HTTPException(413, "Event body too large")
    try:
        timestamp = int(x_provider_timestamp or "")
    except (TypeError, ValueError):
        raise HTTPException(401, "Invalid provider timestamp") from None
    if abs(time.time() - timestamp) > 300:
        raise HTTPException(401, "Stale provider message")
    digest = hmac.new(secret.encode(), (str(timestamp) + ".").encode() + raw, hashlib.sha256).hexdigest()
    if not x_provider_signature or not hmac.compare_digest(x_provider_signature, "sha256=" + digest):
        raise HTTPException(401, "Invalid provider signature")

    # JSON validation occurs only after the raw-byte signature check.
    try:
        event = ProviderEvent.model_validate_json(raw)
    except ValueError:
        raise HTTPException(422, "Malformed provider event") from None

    event_hash = hashlib.sha256(raw).hexdigest()
    with database() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM provider_events WHERE event_id = %s FOR UPDATE", (event.event_id,))
        old = cur.fetchone()
        if old:
            if old["event_hash"] != event_hash:
                raise HTTPException(409, "Event ID reused with different payload")
            return {"decision": old["decision"], "duplicate": True}

        cur.execute("SELECT * FROM payment_sessions WHERE id = %s FOR UPDATE", (event.session_id,))
        session = cur.fetchone()
        if not session:
            raise HTTPException(404, "Unknown session")

        match = (
            session["merchant_id"] == event.merchant_id
            and session["merchant_reference"] == event.merchant_reference
            and session["amount_paise"] == event.amount_paise
            and session["currency"] == event.currency
            and session["vpa"] == event.vpa
        )
        if not match:
            raise HTTPException(409, "Provider event does not match original payment")

        if event.status != "SUCCESS":
            decision = "ignored_non_success"
        elif session["status"] != "PENDING":
            decision = "ignored_terminal"
        elif session["expires_at"] <= datetime.now(timezone.utc):
            cur.execute("UPDATE payment_sessions SET status = 'REVIEW' WHERE id = %s", (event.session_id,))
            decision = "late_credit_review"
        else:
            cur.execute(
                """UPDATE payment_sessions
                   SET status = 'PAID', paid_at = now(), provider_event_id = %s
                   WHERE id = %s""",
                (event.event_id, event.session_id),
            )
            decision = "accepted_mock_provider_success"

        cur.execute(
            "INSERT INTO provider_events (event_id,session_id,event_hash,decision) VALUES (%s,%s,%s,%s)",
            (event.event_id, event.session_id, event_hash, decision),
        )
        return {"decision": decision, "duplicate": False, "live_bank_verified": False}
