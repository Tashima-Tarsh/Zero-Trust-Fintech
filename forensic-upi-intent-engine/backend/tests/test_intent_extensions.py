import pytest
from fastapi.testclient import TestClient

from python_nodes.statement_parser import preview_bank_statement
from python_nodes.package_validator import evaluate_package_report
from worker.app import app

client = TestClient(app)


def test_statement_preview_never_settles():
    sample = "date,reference,credit,currency\n2026-11-14,123456789012,500.00,INR\n"
    parsed = preview_bank_statement(sample)
    assert parsed["candidates"][0]["amount_paise"] == 50000
    assert parsed["posted_ledger_entries"] == 0
    assert parsed["can_confirm_payment"] is False


def test_statement_rejects_malformed_header():
    with pytest.raises(ValueError):
        preview_bank_statement("garbage,data\n1,2")


def test_invalid_decimal_ignored():
    p = preview_bank_statement("date,reference,credit,currency\n2026-11-14,x,NaN,INR\n")
    assert p["candidates"] == []


def test_package_report_untrusted():
    cert = "a" * 64
    result = evaluate_package_report("com.example.psp", cert, {"com.example.psp": {cert}})
    assert result["certificate_allowlist_match"]
    assert result["report_is_untrusted"]
    assert not result["proof_of_payment"]


def test_passive_health_requires_auth():
    assert client.post("/v1/vpas/canary", json={"merchant_id":"demo"}).status_code == 401


def test_retired_preview_route_is_not_registered():
    assert client.post("/v1/statements/preview", json={"csv_text":"hello"}).status_code == 404
