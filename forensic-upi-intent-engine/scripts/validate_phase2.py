"""Validate device-integrity decision recording and notification workflow."""
from pathlib import Path
import json
root = Path(__file__).resolve().parents[1]
migration = (root / "database/migrations/002_phase2_reconciliation.sql").read_text()
assert "phase2_forensic_submissions" in migration
assert "DEVICE_INTEGRITY_PASS" in migration
assert "DEVICE_INTEGRITY_REJECT" in migration
assert "phase2_reconciliation_queue" not in migration
phase2 = (root / "backend/worker/phase2.py").read_text()
assert "DEVICE_INTEGRITY_REJECT" in phase2
flow = json.loads((root / "n8n-workflows/02_intent_verifier.json").read_text())
assert flow["active"] is False
assert any(n["parameters"].get("url","").endswith("/v1/intent/evaluate")
           for n in flow["nodes"] if n["type"] == "n8n-nodes-base.httpRequest")
print("Device integrity workflow validation passed")
