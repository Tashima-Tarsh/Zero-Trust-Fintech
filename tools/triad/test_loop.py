#!/usr/bin/env python3
"""Offline contracts for DISHA's three upstream development tool adapters."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

MODULE = Path(__file__).with_name("loop.py")
spec = importlib.util.spec_from_file_location("disha_triad_loop", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TriadTests(unittest.TestCase):
    def make_repo(self, root):
        (root / "package.json").write_text('{"name":"test"}')
        for key, rel in mod.SOURCES.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            if key == "checkout":
                data = "model.qrTapLaunchUri();model.isSettled();"
            elif key == "uri":
                data = "function buildUpiUri(){}"
            elif key == "android":
                data = "startActivityForResult();onActivityResult();bankVerified=false;"
            elif key == "android_e2e":
                data = "ANDROID_ACTIVITY_RESULT"
            elif key == "receiver":
                data = "NO MONEY MOVES"
            else:
                data = "test payment"
            p.write_text(data)
        return root

    def test_source_fingerprint_changes_on_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(Path(tmp))
            first = mod.inventory(root)
            self.assertGreaterEqual(first["count"], len(mod.SOURCES))
            (root / mod.SOURCES["uri"]).write_text("function buildUpiUri(){return true}")
            self.assertNotEqual(first["fingerprint"],
                                mod.inventory(root)["fingerprint"])

    def test_android_evidence_never_implies_money(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(Path(tmp))
            logfile = root / "upi.log"
            logfile.write_text(
                "ANDROID_INTENT_REQUESTED protocol=upi handler=external\n"
                "ANDROID_INTENT_DISPATCHED request=8202\n"
                "ANDROID_ACTIVITY_RESULT classification=CANCELLED appReported=UNAVAILABLE "
                "elapsedMs=23 bankVerified=false\n"
                "ANDROID_HOST_RESUMED bankVerified=false\n")
            result = mod.evidence(root, logfile)
            self.assertEqual(result["findings"], [])
            self.assertEqual(result["android"]["cancelled"], 1)
            self.assertEqual(result["android"]["returned"], 1)
            self.assertEqual(result["financialConfirmation"], "NOT_TESTED")

    def test_redacted_evidence_and_no_handler_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(Path(tmp))
            logfile = root / "upi.log"
            logfile.write_text("ANDROID_INTENT_NO_HANDLER token=private-secret")
            result = mod.evidence(root, logfile)
            self.assertEqual(result["android"]["noHandler"], 1)
            self.assertNotIn("private-secret", json.dumps(result))
            self.assertTrue(any(f["code"] == "ANDROID_LAUNCH_FAULT"
                                for f in result["findings"]))

    def test_archify_candidate_has_grounded_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(Path(tmp))
            data = mod.archify_candidate(root, root / "test-results/triad")
            self.assertEqual(data["diagram_type"], "architecture")
            self.assertEqual(data["schema_version"], 1)
            ids = {x["id"] for x in data["components"]}
            self.assertTrue(all(x["from"] in ids and x["to"] in ids
                                for x in data["connections"]))
            self.assertTrue(all((root / src["path"]).is_file()
                                for node in data["components"]
                                for src in node.get("sources", [])))

    def test_exact_wshobson_specialist_files_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for role, relative in mod.SPECIALISTS.items():
                p = root / relative
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(role)
            actual = mod.specialist_prompts(root)
            self.assertEqual(len(actual), 6)
            self.assertIn("AndroidDebugger", actual)
            (root / next(iter(mod.SPECIALISTS.values()))).unlink()
            with self.assertRaises(RuntimeError):
                mod.specialist_prompts(root)

    def test_offline_run_reports_swarms_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(Path(tmp))
            agents = root / "agents"
            archify = root / "archify"
            (archify / "archify/bin").mkdir(parents=True)
            (archify / "archify/bin/archify.mjs").write_text("// stub")
            for role, relative in mod.SPECIALISTS.items():
                p = agents / relative
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(role)
            cmd = [sys.executable, str(MODULE), "--repo-root", str(root),
                   "--agents-root", str(agents), "--archify-root", str(archify),
                   "--iterations", "2"]
            output = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(output.returncode, 0, output.stderr)
            report = json.loads((root / "test-results/triad/report.json").read_text())
            self.assertIn(report["frameworks"]["swarms"],
                          {"NOT_RUN_NO_LOCAL_MODEL_OR_SWARMS_PACKAGE",
                           "EXECUTED_SWARMS_OFFLINE_RULE_AGENTS"})
            self.assertFalse(report["limits"]["realPaymentValidated"])
            self.assertFalse(report["limits"]["bankAPIUsed"])
            rejected = subprocess.run(cmd + ["--model", "openai/gpt-4o"],
                                      capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("local Ollama", rejected.stderr)

if __name__ == "__main__":
    unittest.main()
