from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from worker.app import app
from worker.phase2 import IntentEvidence, analyze_intent, decode_consent_image


client = TestClient(app)


def sample(*, image=None, consent=False, **more):
    payload = {
        "session_id": uuid4(), "merchant_id": "demo", "submission_id": uuid4(),
        "time_in_app_ms": 9000, "screenshot_base64": image, "screenshot_consent": consent,
    }
    payload.update(more)
    return IntentEvidence(**payload)


SESSION = {"amount_paise": 50000, "vpa": "merchant@psp"}


@pytest.mark.parametrize("keywords", [
    ["processing"], ["pending"], ["success"], ["failed"], [],
])
def test_no_screenshot_keyword_can_settle(keywords):
    body = sample()
    result = analyze_intent(
        body, SESSION, image=b"test", ocr_override={
            "status_keywords": keywords, "utr_candidate": "123456789012",
            "amount_text_candidate": "500.00", "vpa_candidates": ["merchant@psp"],
        }, ela_override={"anomaly_score": 0},
    )
    assert result["decision"] == "PENDING_RECONCILIATION"
    assert result["ledger_entries_created"] == 0
    assert result["can_confirm_payment"] is False


def test_fake_utr_amount_can_only_raise_advisory_flag():
    result = analyze_intent(
        sample(claimed_utr="111111111111"), SESSION, image=b"test",
        ocr_override={
            "status_keywords": ["success"], "utr_candidate": "222222222222",
            "amount_text_candidate": "10.00", "vpa_candidates": ["friend@psp"],
        }, ela_override={"anomaly_score": 95}
    )
    assert "ocr_claimed_amount_differs_from_session" in result["risk_flags"]
    assert "ocr_vpa_does_not_match_session" in result["risk_flags"]
    assert "utr_claim_differs_from_ocr" in result["risk_flags"]
    assert result["decision"] == "PENDING_RECONCILIATION"


def test_reused_image_flag():
    result = analyze_intent(sample(), SESSION, image=b"test", previous_image_seen=True,
      ocr_override={"status_keywords": [], "utr_candidate": None,
                    "amount_text_candidate": None, "vpa_candidates": []},
      ela_override={"anomaly_score": 0})
    assert "reused_image_in_another_session" in result["risk_flags"]
    assert result["ledger_entries_created"] == 0


def test_consent_enforced():
    with pytest.raises(ValueError):
        decode_consent_image(sample(image="dGVzdA==", consent=False))


def test_malformed_image_encoding_rejected():
    with pytest.raises(ValueError):
        decode_consent_image(sample(image="!notbase64!", consent=True))


def test_anonymous_endpoint_denied():
    r = client.post("/v1/intent/evaluate", json={
        "session_id": str(uuid4()), "submission_id": str(uuid4()), "merchant_id": "demo"
    })
    assert r.status_code == 401


def test_queue_requires_auth():
    assert client.get("/v1/reconciliation/queue/summary").status_code == 401
