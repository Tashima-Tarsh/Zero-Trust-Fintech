import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("WORKER_API_KEY", "unit-test-only-key")
os.environ.setdefault("PROVIDER_WEBHOOK_SECRET", "unit-test-only-webhook-secret")
