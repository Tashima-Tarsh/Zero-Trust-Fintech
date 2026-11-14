"""UPI session orchestration, device checks and enrolled-device attestations."""
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

from fastapi.responses import JSONResponse
from redis import Redis, RedisError

from python_nodes.behavior_scorer import score_behavior
from python_nodes.utl_validator import validate_utr
from psycopg.types.json import Jsonb
from worker.phase2 import IntentEvidence, decode_consent_image, analyze_intent

app = FastAPI(title="Forensic UPI Engine", version="0.1.0", docs_url=None, redoc_url=None)
SESSION_TTL_MINUTES = 10


class SessionRequest(BaseModel):
    merchant_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    merchant_reference: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    amount_paise: int = Field(gt=0, le=100_000_000)
    note: str = Field(default="", max_length=100)
    currency: Literal["INR"] = "INR"
    client_user_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    client_device_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class ForensicRequest(BaseModel):
    elapsed_ms: int | None = Field(default=None, ge=0, le=86_400_000)
    retry_count: int = Field(default=0, ge=0, le=100)
    utr: str | None = Field(default=None, max_length=64)
    image_ela_score: float | None = Field(default=None, ge=0, le=100)


def check_api_key(authorization: str | None) -> None:
    expected = os.getenv("WORKER_API_KEY", "")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Server authentication unconfigured")
    if not authorization or not hmac.compare_digest(authorization, "Bearer " + expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unauthorized")


def database():
    # Uses PGHOST / PGUSER / PGPASSWORD / PGDATABASE from container env.
    return psycopg.connect(connect_timeout=5, row_factory=dict_row)


@app.middleware("http")
async def redis_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/v1/") and os.getenv("REDIS_URL"):
        try:
            client = Redis.from_url(os.environ["REDIS_URL"], socket_timeout=1)
            # This is a coarse per-source internal rate limit, not tenant-grade quota.
            key = "rl:%s:%s" % (int(time.time() // 60), request.client.host if request.client else "unknown")
            count = client.incr(key)
            if count == 1:
                client.expire(key, 90)
            if count > 120:
                return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        except RedisError:
            return JSONResponse({"detail": "Rate limiter unavailable"}, status_code=503)
    return await call_next(request)


class VpaReportRequest(BaseModel):
    merchant_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


@app.post("/v1/vpas/canary")
def passive_vpa_health(body: VpaReportRequest, authorization: str | None = Header(default=None)):
    check_api_key(authorization)
    with database() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT count(*) AS total,
                      count(*) FILTER (WHERE enabled) AS enabled,
                      count(*) FILTER (WHERE enabled AND health_status = 'healthy'
                                      AND status = 'available' AND
                                      (leased_until IS NULL OR leased_until <= now())) AS available,
                      count(*) FILTER (WHERE leased_until > now()) AS leased,
                      count(*) FILTER (WHERE last_canary_check IS NULL
                                      OR last_canary_check < now() - interval '1 day') AS stale
                 FROM upi_vpa_pool WHERE merchant_id = %s""",
            (body.merchant_id,),
        )
        stats = cur.fetchone()
    return {"merchant_id": body.merchant_id, **stats, "bank_connectivity_tested": False,
            "note": "Passive database-only report; no unauthorized bank probing."}


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
            if (previous["amount_paise"] != body.amount_paise or previous["note"] != body.note
                or previous["client_user_id"] != body.client_user_id
                or previous["client_device_id"] != body.client_device_id):
                raise HTTPException(409, "Idempotency key reused with different payment details")
            return previous

        cur.execute(
            """SELECT vpa_address AS vpa FROM upi_vpa_pool
               WHERE merchant_id = %s AND enabled = TRUE AND health_status = 'healthy'
                 AND status = 'available' AND (leased_until IS NULL OR leased_until <= now())
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
            "UPDATE upi_vpa_pool SET leased_until = %s WHERE vpa_address = %s",
            (expiry, candidate["vpa"]),
        )
        cur.execute(
            """INSERT INTO payment_sessions
               (id, merchant_id, merchant_reference, amount_paise, currency, vpa, note, expires_at, client_user_id, client_device_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (
                session_id, body.merchant_id, body.merchant_reference, body.amount_paise,
                body.currency, candidate["vpa"], body.note, expiry, body.client_user_id, body.client_device_id,
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



@app.post("/v1/intent/evaluate")
def evaluate_intent(body: IntentEvidence, authorization: str | None = Header(default=None)):
    """Authenticated device-integrity evidence intake."""
    check_api_key(authorization)
    try:
        image = decode_consent_image(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    image_hash = hashlib.sha256(image).hexdigest() if image is not None else None
    request_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()

    with database() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT session_id, request_hash, response FROM phase2_forensic_submissions "
            "WHERE submission_id = %s FOR UPDATE",
            (body.submission_id,),
        )
        old = cur.fetchone()
        if old is not None:
            if old["request_hash"] != request_hash or old["session_id"] != body.session_id:
                raise HTTPException(409, "Submission ID reused with different evidence")
            return old["response"]

        cur.execute(
            """SELECT id, merchant_id, status, expires_at, amount_paise, vpa
               FROM payment_sessions
               WHERE id = %s AND merchant_id = %s FOR UPDATE""",
            (body.session_id, body.merchant_id),
        )
        session = cur.fetchone()
        if session is None:
            raise HTTPException(404, "Session not found for merchant")
        if session["status"] not in ("PENDING", "REVIEW"):
            raise HTTPException(409, "Session not open for evidence")
        if session["expires_at"] <= datetime.now(timezone.utc):
            raise HTTPException(409, "Session expired")

        reused = False
        if image_hash:
            cur.execute(
                """SELECT EXISTS (
                    SELECT 1 FROM phase2_forensic_submissions
                    WHERE image_sha256 = %s AND session_id <> %s
                ) AS reused""",
                (image_hash, body.session_id),
            )
            reused = cur.fetchone()["reused"]
        try:
            result = analyze_intent(body, session, image=image, previous_image_seen=reused)
        except (ValueError, OSError, RuntimeError) as exc:
            raise HTTPException(422, "Image could not be analyzed safely") from exc

        cur.execute(
            """INSERT INTO phase2_forensic_submissions
                 (submission_id, session_id, merchant_id, request_hash,
                  image_sha256, risk_score, decision, response)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                body.submission_id, body.session_id, body.merchant_id,
                request_hash, image_hash, result["risk_score"],
                result["decision"], Jsonb(result),
            ),
        )
        cur.execute(
            """UPDATE payment_sessions
               SET forensic_score = GREATEST(forensic_score, %s),
                   fraud_flags = CASE WHEN %s >= forensic_score
                                      THEN %s ELSE fraud_flags END,
                   extracted_utr = COALESCE(%s, extracted_utr),
                   target_package = COALESCE(%s, target_package),
                   time_in_app_ms = COALESCE(%s, time_in_app_ms)
               WHERE id = %s""",
            (
                result["risk_score"], result["risk_score"],
                Jsonb(result["risk_flags"]), body.claimed_utr,
                body.target_package, body.time_in_app_ms, body.session_id,
            ),
        )
        return result



from worker.client_attestation import router as client_attestation_router
app.include_router(client_attestation_router)
