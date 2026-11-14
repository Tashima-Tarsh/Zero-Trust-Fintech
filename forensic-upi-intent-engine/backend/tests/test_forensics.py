from io import BytesIO

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from python_nodes.ela_analysis import analyze_image_bytes
from python_nodes.utl_validator import validate_utr
from python_nodes.behavior_scorer import score_behavior
from worker.app import app

client = TestClient(app)

def test_utr_never_proves_payment():
    assert validate_utr("123456789012")["format_plausible"]
    assert not validate_utr("123456789012")["proof_of_payment"]
    assert not validate_utr("invalid!")["format_plausible"]

def test_behavior_scoring_rejects_outlier_metrics():
    result = score_behavior(elapsed_ms=300, retry_count=6, utr_format_plausible=False)
    assert result["risk_score"] >= 40
    assert result["decision"] == "DEVICE_INTEGRITY_REJECT"
    assert result["can_confirm_payment"] is False

def test_ela_heuristic_is_not_proof():
    image = Image.new("RGB", (100, 100), "white")
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    report = analyze_image_bytes(buffer.getvalue())
    assert 0 <= report["anomaly_score"] <= 100
    assert report["proof_of_forgery"] is False

def test_ela_rejects_invalid_file():
    with pytest.raises(ValueError):
        analyze_image_bytes(b"not-image")

def test_anonymous_cannot_create_session():
    response = client.post("/v1/sessions", json={
        "merchant_id": "demo", "merchant_reference": "order1", "amount_paise": 100,
    })
    assert response.status_code == 401

def test_anonymous_cannot_score():
    assert client.post("/v1/forensics/score", json={}).status_code == 401

def test_authorized_scoring_is_not_settlement():
    response = client.post(
        "/v1/forensics/score",
        headers={"Authorization": "Bearer unit-test-only-key"},
        json={"elapsed_ms": 100, "retry_count": 9, "utr": "invalid"},
    )
    assert response.status_code == 200
    assert response.json()["can_confirm_payment"] is False

def test_removed_event_endpoint_is_unavailable():
    assert client.post("/v1/provider-events", json={}).status_code == 404
