"""Structural validation for the device-attestation worker."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
for path in [
    "README.md", ".env.example", "backend/worker/app.py",
    "backend/worker/client_attestation.py", "backend/python_nodes/behavior_scorer.py",
    "backend/tests/test_client_attestation.py", "infra/postgres/init.sql",
    "database/schema.sql", "database/migrations/003_client_device_attestation.sql",
]:
    assert (root / path).is_file(), path

app = (root / "backend/worker/app.py").read_text()
attestation = (root / "backend/worker/client_attestation.py").read_text()
schema = (root / "infra/postgres/init.sql").read_text()
env = (root / ".env.example").read_text()

assert "client_attestation_router" in app
assert "/v1/client/attest-payment" in attestation
assert "verify_client_signature(body, key" in attestation
assert "FOR UPDATE" in attestation
assert "client_attestation_ledger" in attestation
assert "CREATE TABLE client_device_keys" in schema
assert "prevent_client_attestation_update_delete" in schema
assert "provider_events" not in schema
assert "PROVIDER_WEBHOOK_SECRET" not in env
assert "/v1/provider-events" not in app
assert "redis_rate_limit" in app
assert json.loads((root / "mobile-app/package.json").read_text())["name"]
print("Client device-attestation structural checks passed")
