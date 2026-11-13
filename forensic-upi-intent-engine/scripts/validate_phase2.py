"""Static structural checks for the Phase 2 defensive workflow and migration."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]

required = [
    "phase-2/README.md", "phase-2/threat_model.md",
    "phase-2/api_contracts.md", "phase-2/operational_runbook.md",
    "database/migrations/002_phase2_reconciliation.sql",
    "backend/worker/phase2.py", "backend/tests/test_phase2.py",
    "n8n-workflows/02_intent_verifier.json",
    "n8n-workflows/03_canary_tester.json",
    "n8n-workflows/04_statement_parser.json",
    "config/systemd/forensic-worker.service",
]
for name in required:
    assert (root / name).is_file(), f"Missing: {name}"

migration = (root / "database/migrations/002_phase2_reconciliation.sql").read_text()
for token in [
    "phase2_forensic_submissions", "phase2_reconciliation_queue",
    "request_hash", "image_sha256", "phase2_forensic_immutable",
]:
    assert token in migration, f"Missing SQL migration component {token}"

app = (root / "backend/worker/app.py").read_text()
for route in ["/v1/intent/evaluate", "/v1/reconciliation/queue/summary",
              "/v1/reconciliation/queue"]:
    assert route in app
assert 'SET status = \'PAID\'' not in app, "Mock/forensic handler cannot settle"
assert "financial_ledger" not in app, "Worker Phase 2 must not create ledger rows"

verifier = json.loads((root / "n8n-workflows/02_intent_verifier.json").read_text())
assert verifier["active"] is False
assert verifier["settings"]["saveDataSuccessExecution"] == "none"
assert verifier["settings"]["saveDataErrorExecution"] == "none"
assert not any(n["type"] in (
    "n8n-nodes-base.executeCommand", "n8n-nodes-base.postgres"
) for n in verifier["nodes"]), "No direct SQL or shell execution in verifier"
hooks = [n for n in verifier["nodes"] if n["type"] == "n8n-nodes-base.webhook"]
assert len(hooks) == 1
assert hooks[0]["parameters"]["authentication"] == "headerAuth"
requests = [n for n in verifier["nodes"] if n["type"] == "n8n-nodes-base.httpRequest"]
assert len(requests) == 1
assert requests[0]["parameters"]["url"].endswith("/v1/intent/evaluate")
assert requests[0]["parameters"].get("options", {}).get("response", {}).get(
    "response", {}
).get("neverError") is not True, "Do not disguise worker errors as HTTP 200"


canary = json.loads((root / "n8n-workflows/03_canary_tester.json").read_text())
assert not any(n["type"] in ("n8n-nodes-base.executeCommand", "n8n-nodes-base.postgres") for n in canary["nodes"])
assert any(n["parameters"].get("url", "").endswith("/v1/vpas/canary") for n in canary["nodes"])

statement = json.loads((root / "n8n-workflows/04_statement_parser.json").read_text())
assert statement["active"] is False
assert any(n["type"] == "n8n-nodes-base.scheduleTrigger" for n in statement["nodes"])
assert any(n["parameters"].get("url", "").endswith("/v1/reconciliation/queue/summary")
           for n in statement["nodes"])
assert not any(n["type"] == "n8n-nodes-base.postgres" for n in statement["nodes"])
print("Phase 2 workflow, migration and no-credit invariants passed")
