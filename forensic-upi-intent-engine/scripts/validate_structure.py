"""Validate the intended project shape and critical no-false-settlement invariants."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
needed = [
    "docs/architecture.md", "docs/fraud_matrix.md", "docs/api_spec.md",
    "infra/docker-compose.yml", "infra/postgres/init.sql",
    "infra/postgres/seed_vpas.sql", "infra/n8n/Dockerfile",
    "backend/workflows/01_link_generator.json",
    "backend/workflows/02_intent_verifier.json",
    "backend/workflows/03_canary_tester.json",
    "backend/workflows/04_statement_parser.json",
    "backend/python_nodes/ela_analysis.py",
    "backend/python_nodes/ocr_extractor.py",
    "backend/python_nodes/package_validator.py",
    "backend/python_nodes/behavior_scorer.py",
    "backend/python_nodes/statement_parser.py",
    "backend/requirements.txt", "backend/worker/app.py",
    "mobile-app/android/app/src/main/java/com/forensicupi/UPIIntentBridge.java",
    "mobile-app/android/app/src/main/java/com/forensicupi/SecureSnapshot.java",
    "mobile-app/src/sensors/AppStateTracker.js",
    "mobile-app/src/sensors/TelemetrySDK.js",
    "mobile-app/src/services/N8NClient.js",
    "mobile-app/src/services/VPARotator.js",
    "mobile-app/src/App.js", "mobile-app/package.json",
    "web-fallback/index.html", "web-fallback/script.js", "web-fallback/style.css",
    ".gitignore", ".env.example", "README.md", "LICENSE"
]
for name in needed:
    assert (root / name).is_file(), f"Missing: {name}"

for fname in ["01_link_generator.json", "02_intent_verifier.json", "03_canary_tester.json", "04_statement_parser.json"]:
    flow = json.loads((root / "backend/workflows" / fname).read_text())
    assert flow["active"] is False, "Never activate workflows before auth configuration"
    assert flow["nodes"] and flow["connections"]
    assert any(n["type"] == "n8n-nodes-base.webhook" and
               n["parameters"]["authentication"] == "headerAuth" for n in flow["nodes"])

schema = (root / "infra/postgres/init.sql").read_text()
worker = (root / "backend/worker/app.py").read_text()
seed = (root / "infra/postgres/seed_vpas.sql").read_text()
assert "CREATE TABLE financial_ledger" in schema
assert "forbid_financial_ledger_update_delete" in schema
assert "enabled,status,health_status" in seed and "FALSE" in seed
assert "awaiting_bank_reconciliation" in worker
assert "SET status = 'PAID'" not in worker, "No mock callback may settle a payment"
assert "redis_rate_limit" in worker
assert json.loads((root / "mobile-app/package.json").read_text())["name"]
print("New intent engine structure and safety invariants validated")
