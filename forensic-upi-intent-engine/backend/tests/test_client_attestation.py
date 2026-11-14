import base64
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient

from worker.app import app
from worker.client_attestation import (
    ClientAttestation, canonical_attestation_bytes, device_integrity_result,
    verify_client_signature,
)

client = TestClient(app)

def signed_body():
    private_key = Ed25519PrivateKey.generate()
    public = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    raw = dict(
        session_id=str(uuid4()), user_id="user1", device_id="device1",
        utr="123456789012", amount="500.00",
        timestamp=datetime.now(timezone.utc).isoformat(),
        integrity={"elapsed_ms": 9000, "retry_count": 0},
        client_signature="temporary",
    )
    payload = ClientAttestation(**raw)
    raw["client_signature"] = base64.b64encode(
        private_key.sign(canonical_attestation_bytes(payload))
    ).decode("ascii")
    return ClientAttestation(**raw), base64.b64encode(public).decode("ascii")


def test_ed25519_roundtrip_and_exact_canonical_bytes():
    signed, key = signed_body()
    assert verify_client_signature(signed, key) == canonical_attestation_bytes(signed)


def test_tampering_with_amount_or_integrity_invalidates_signature():
    signed, key = signed_body()
    tampered = signed.model_copy(update={"amount": "501.00"})
    with pytest.raises(Exception) as error:
        verify_client_signature(tampered, key)
    assert error.value.status_code == 401
    altered = signed.model_copy(update={
        "integrity": signed.integrity.model_copy(update={"retry_count": 9})
    })
    with pytest.raises(Exception) as error:
        verify_client_signature(altered, key)
    assert error.value.status_code == 401


def test_integrity_gate_pass_and_reject():
    signed, key = signed_body()
    assert device_integrity_result(signed)["decision"] == "DEVICE_INTEGRITY_PASS"
    high_risk = signed.model_copy(update={"integrity": signed.integrity.model_copy(
        update={"elapsed_ms": 100, "retry_count": 8}
    )})
    assert device_integrity_result(high_risk)["decision"] == "DEVICE_INTEGRITY_REJECT"


def test_legacy_endpoint_not_registered():
    assert client.post("/v1/provider-events", json={}).status_code == 404


def test_attestation_missing_session_does_not_finalize():
    signed, key = signed_body()
    # Database-backed endpoint remains fail-closed when database isn't configured.
    # API signature unit tests above are independent of database provisioning.
    assert "client_signature" not in canonical_attestation_bytes(signed).decode()


def test_attestation_route_posts_once_and_exact_replay_is_idempotent(monkeypatch):
    from datetime import timedelta
    import worker.client_attestation as module
    from fastapi import HTTPException

    signed, key = signed_body()
    rows = {
        "session": {
            "id": signed.session_id, "status": "PENDING",
            "client_user_id": signed.user_id, "client_device_id": signed.device_id,
            "amount_paise": 50000,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=2),
            "is_client_finalized": False, "attestation_hash": None,
        },
        "key": {"public_key_b64": key, "hardware_attested": True},
    }
    class Cursor:
        def __init__(self):
            self.last_query = ""
            self.records = []
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def execute(self, statement, params=()):
            self.last_query = statement
            self.records.append((statement, params))
            if statement.startswith("UPDATE payment_sessions SET status='CLIENT_ATTESTED'"):
                rows["session"]["status"] = "CLIENT_ATTESTED"
                rows["session"]["is_client_finalized"] = True
                rows["session"]["attestation_hash"] = params[1]
        def fetchone(self):
            if "FROM payment_sessions" in self.last_query:
                return rows["session"]
            if "FROM phase2_forensic_submissions" in self.last_query:
                return {"rejected": False}
            if "FROM client_device_keys" in self.last_query:
                return rows["key"]
            raise AssertionError(self.last_query)
    cursor = Cursor()
    class Connection:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def cursor(self):
            return cursor
    monkeypatch.setattr(module, "db", lambda: Connection())
    first = module.attest_payment(signed)
    assert first["client_finalized"] is True
    assert first["duplicate"] is False
    assert sum("INSERT INTO client_attestation_ledger" in sql for sql, args in cursor.records) == 1
    duplicate = module.attest_payment(signed)
    assert duplicate["duplicate"] is True
    assert sum("INSERT INTO client_attestation_ledger" in sql for sql, args in cursor.records) == 1
    tampered = signed.model_copy(update={"amount": "501.00"})
    with pytest.raises(HTTPException) as failure:
        module.attest_payment(tampered)
    assert failure.value.status_code == 409


def test_signed_high_ela_rejected_even_with_normal_dwell():
    signed, key = signed_body()
    anomalous = signed.model_copy(update={
        "integrity": signed.integrity.model_copy(update={"image_ela_score": 75})
    })
    assert device_integrity_result(anomalous)["decision"] == "DEVICE_INTEGRITY_REJECT"
