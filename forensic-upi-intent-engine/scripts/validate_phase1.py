"""Native SQL and ELA device-integrity smoke checks."""
from pathlib import Path
import importlib.util
import tempfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
schema = (root / "database/schema.sql").read_text()
for token in [
    "CREATE TABLE IF NOT EXISTS payment_sessions",
    "CREATE TABLE IF NOT EXISTS client_device_keys",
    "CREATE TABLE IF NOT EXISTS client_attestation_ledger",
    "client_device_signature VARCHAR", "attestation_hash VARCHAR",
    "is_client_finalized BOOLEAN", "phase1_ledger_no_truncate",
]:
    assert token in schema, token

spec = importlib.util.spec_from_file_location("native_ela", root / "python-forensics/ela_analysis.py")
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as tmp:
    target = Path(tmp) / "example.jpg"
    Image.new("RGB", (32, 32), "white").save(target)
    report = module.calculate_ela(target)
    assert report["status"] == "analyzed"
    assert report["integrity_decision"] in ("DEVICE_INTEGRITY_PASS", "DEVICE_INTEGRITY_REJECT")
print("Native device schema and image-integrity checks passed")
