"""Standard-library structural smoke validation for the scaffold."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
needed = [
    "docs/architecture.md", "docs/fraud_vectors.md", "infra/docker-compose.yml",
    "infra/postgres/init.sql", "infra/postgres/seed_vpas.sql", "infra/n8n/Dockerfile",
    "backend/workflows/link_generator.json", "backend/workflows/forensic_verifier.json",
    "backend/python_nodes/ela_analysis.py", "backend/python_nodes/utl_validator.py",
    "backend/python_nodes/behavior_scorer.py", "backend/requirements.txt",
    "mobile-app/android/README.md", "mobile-app/ios/README.md",
    "mobile-app/src/App.js", "mobile-app/package.json", "mobile-app/README.md",
    "web-fallback/index.html", "web-fallback/script.js", "web-fallback/style.css",
    ".gitignore", ".env.example", "README.md"
]
for name in needed:
    assert (root / name).is_file(), f"Missing: {name}"
for name in ["link_generator.json", "forensic_verifier.json"]:
    doc = json.loads((root / "backend/workflows" / name).read_text())
    assert doc["nodes"] and doc["connections"]
    assert any(node["type"] == "n8n-nodes-base.webhook" for node in doc["nodes"])
assert json.loads((root / "mobile-app/package.json").read_text())["name"]
print("Project structure and workflow JSON validated")
