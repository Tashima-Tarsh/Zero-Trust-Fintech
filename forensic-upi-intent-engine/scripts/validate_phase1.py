"""Static checks and ELA smoke test for the *native* Phase 1 files."""
from __future__ import annotations
from pathlib import Path
import importlib.util
import json
import tempfile

from PIL import Image

root = Path(__file__).resolve().parents[1]
needed = [
    "database/schema.sql",
    "database/seed_vpas.sql",
    "n8n-workflows/01_link_generator.json",
    "python-forensics/ela_analysis.py",
    "python-forensics/requirements.txt",
]
for name in needed:
    assert (root / name).is_file(), f"Missing {name}"

schema = (root / "database/schema.sql").read_text()
for text in [
    "CREATE TABLE IF NOT EXISTS upi_vpa_pool",
    "CREATE TABLE IF NOT EXISTS payment_sessions",
    "CREATE TABLE IF NOT EXISTS financial_ledger",
    "telemetry_data JSONB", "extracted_status VARCHAR(20)",
    "fraud_flags JSONB", "updated_at TIMESTAMP",
    "balance_after DECIMAL(10, 2)",
    "CREATE INDEX IF NOT EXISTS idx_vpa_status",
    "CREATE INDEX IF NOT EXISTS idx_session_status",
    "phase1_ledger_no_update_delete",
    "phase1_ledger_no_truncate",
]:
    assert text in schema, f"Required schema component missing: {text}"

seed = (root / "database/seed_vpas.sql").read_text()
assert "merchant001@oksbi" in seed, "Keep supplied example as a commented template"
assert not any(line.lstrip().upper().startswith("INSERT INTO UPI_VPA_POOL")
               for line in seed.splitlines()), "Never preload fictional VPAs"

flow = json.loads((root / "n8n-workflows/01_link_generator.json").read_text())
assert flow["active"] is False
assert flow["name"] == "01 Link Generator"
assert any(n["type"] == "n8n-nodes-base.webhook" and n["parameters"].get("authentication") == "headerAuth"
           for n in flow["nodes"])
assert any(n["type"] == "n8n-nodes-base.httpRequest" and
           n["parameters"].get("url") == "http://127.0.0.1:8000/v1/sessions"
           for n in flow["nodes"])
assert all(n["type"] != "n8n-nodes-base.postgres" for n in flow["nodes"]), (
    "VPA assignment must remain atomic via the worker, not two separate SQL nodes"
)

module_path = root / "python-forensics/ela_analysis.py"
spec = importlib.util.spec_from_file_location("phase1_ela_analysis", module_path)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with tempfile.TemporaryDirectory() as tmpdir:
    image_file = Path(tmpdir) / "test.jpg"
    Image.new("RGB", (32, 32), "white").save(image_file)
    report = mod.calculate_ela(image_file)
    assert report["status"] == "analyzed", report
    assert isinstance(report["ela_score"], float)
    assert report["proof_of_forgery"] is False
    assert report["proof_of_payment"] is False
    advisory = mod.analyze_image_bytes(image_file.read_bytes())
    assert advisory["proof_of_forgery"] is False
print("Native Phase 1 structure and ELA smoke checks passed")
