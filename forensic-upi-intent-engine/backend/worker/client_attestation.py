"""Device-signed client action attestations and immutable event recording.

A signature authenticates a claim from an enrolled device key. API output is
explicitly an attestation state, not a claim about movement of funds.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import psycopg
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, Header, HTTPException, Query
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from python_nodes.behavior_scorer import score_behavior
from python_nodes.utl_validator import validate_utr

router = APIRouter()
MAX_SIGNATURE_BYTES = 64


class DeviceIntegrity(BaseModel):
    elapsed_ms: int = Field(ge=0, le=86_400_000)
    retry_count: int = Field(ge=0, le=100)
    image_ela_score: float | None = Field(default=None, ge=0, le=100)


class ClientAttestation(BaseModel):
    session_id: UUID
    user_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    device_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    utr: str = Field(min_length=1, max_length=50)
    amount: str = Field(pattern=r"^(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$")
    timestamp: datetime
    integrity: DeviceIntegrity
    client_signature: str = Field(min_length=1, max_length=256)


def canonical_attestation_bytes(body: ClientAttestation) -> bytes:
    """Exact UTF-8 bytes to be signed, including integrity metrics and identity."""
    signed = body.model_dump(mode="json", exclude={"client_signature"})
    return json.dumps(signed, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def verify_client_signature(body: ClientAttestation, public_key_b64: str) -> bytes:
    try:
        public_key = base64.b64decode(public_key_b64, validate=True)
        signature = base64.b64decode(body.client_signature, validate=True)
        if len(public_key) != 32 or len(signature) != MAX_SIGNATURE_BYTES:
            raise ValueError("Invalid signing key or signature length")
        payload = canonical_attestation_bytes(body)
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, payload)
        return payload
    except (InvalidSignature, ValueError, TypeError, binascii.Error) as exc:
        raise HTTPException(401, "Invalid device signature") from exc


def device_integrity_result(body: ClientAttestation) -> dict:
    utr = validate_utr(body.utr)
    result = score_behavior(
        elapsed_ms=body.integrity.elapsed_ms,
        retry_count=body.integrity.retry_count,
        image_ela_score=body.integrity.image_ela_score,
        utr_format_plausible=utr["format_plausible"],
    )
    return result


def db():
    return psycopg.connect(connect_timeout=5, row_factory=dict_row)


def require_worker_auth(auth: str | None) -> None:
    key = os.getenv("WORKER_API_KEY", "")
    if not key:
        raise HTTPException(503, "Worker authentication unconfigured")
    if not auth or not hmac.compare_digest(auth, "Bearer " + key):
        raise HTTPException(401, "Unauthorized")


@router.post("/v1/client/attest-payment")
def attest_payment(body: ClientAttestation):
    """Validate bound enrollment, signature, freshness, integrity and uniqueness.

    Everything is checked and recorded in one database transaction.
    """
    now = datetime.now(timezone.utc)
    if body.timestamp.utcoffset() is None:
        raise HTTPException(422, "Timestamp must include timezone")
    skew = int(os.getenv("CLIENT_ATTESTATION_MAX_SKEW_SECONDS", "300"))
    if not 1 <= skew <= 3600 or abs((now - body.timestamp).total_seconds()) > skew:
        raise HTTPException(409, "Stale or future-dated attestation")
    result = device_integrity_result(body)
    if result["decision"] != "DEVICE_INTEGRITY_PASS":
        raise HTTPException(422, detail={"decision": "DEVICE_INTEGRITY_REJECT", "flags": result["flags"]})
    amount_paise = int(Decimal(body.amount) * 100)
    payload = canonical_attestation_bytes(body)
    digest = hashlib.sha256(payload).hexdigest()

    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM payment_sessions WHERE id = %s FOR UPDATE", (body.session_id,))
        session = cur.fetchone()
        if session is None:
            raise HTTPException(404, "Session not found")
        if session["client_user_id"] != body.user_id or session["client_device_id"] != body.device_id:
            raise HTTPException(403, "Device not bound to session")
        if session["amount_paise"] != amount_paise:
            raise HTTPException(409, "Amount does not match session")
        if session["is_client_finalized"]:
            if session["attestation_hash"] == digest:
                return {"status": "CLIENT_ATTESTED", "client_finalized": True,
                        "attestation_hash": digest, "duplicate": True}
            raise HTTPException(409, "Session already attested with different payload")
        if session["status"] not in ("PENDING", "REVIEW") or session["expires_at"] <= now:
            raise HTTPException(409, "Session closed or expired")
        cur.execute(
            """SELECT public_key_b64, hardware_attested FROM client_device_keys
               WHERE user_id=%s AND device_id=%s AND is_active=TRUE FOR SHARE""",
            (body.user_id, body.device_id),
        )
        key = cur.fetchone()
        if not key or not key["hardware_attested"]:
            raise HTTPException(403, "Active attested device enrollment required")
        verify_client_signature(body, key["public_key_b64"])
        cur.execute(
            """UPDATE payment_sessions SET status='CLIENT_ATTESTED',
               is_client_finalized=TRUE, client_verified_at=now(),
               client_device_signature=%s, attestation_hash=%s,
               extracted_utr=%s WHERE id=%s""",
            (body.client_signature, digest, body.utr, body.session_id),
        )
        cur.execute(
            """INSERT INTO client_attestation_ledger
               (session_id,user_id,device_id,utr,amount_paise,attestation_hash,signature)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (body.session_id, body.user_id, body.device_id, body.utr,
             amount_paise, digest, body.client_signature),
        )
    return {"status": "CLIENT_ATTESTED", "client_finalized": True,
            "attestation_hash": digest, "duplicate": False}


@router.get("/v1/client/attestations/recent")
def recent_attestations(after_id: int = Query(default=0, ge=0),
                        authorization: str | None = Header(default=None)):
    """Internal append-only event feed for outbound n8n notifications."""
    require_worker_auth(authorization)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT id,session_id,user_id,device_id,utr,amount_paise,
                      attestation_hash,created_at
               FROM client_attestation_ledger WHERE id > %s ORDER BY id ASC LIMIT 100""",
            (after_id,),
        )
        rows = cur.fetchall()
    return {"events": rows, "next_id": rows[-1]["id"] if rows else after_id}
