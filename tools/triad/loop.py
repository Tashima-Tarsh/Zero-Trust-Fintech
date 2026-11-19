#!/usr/bin/env python3
"""DISHA triad: Swarms coordinator + wshobson specialists + Archify diagram.

A developer-only, bounded evidence loop. Runs locally and never contacts a bank,
payment gateway, PSP endpoint, or hosted LLM. A local Ollama model is optional.
No automated settlement, production deployment, or arbitrary source deletion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PINNED = {
    "swarms": "76c5e34a341c568668d29e532434c7e852edd297",
    "agents": "42203085cfc5736204bf0f6d436dff7e1da0bf3f",
    "archify": "44781293f38728baf04dbad33ce1a0cef8c39cca",
}
SPECIALISTS = {
    "Architecture": "plugins/comprehensive-review/agents/architect-review.md",
    "AndroidDebugger": "plugins/debugging-toolkit/agents/debugger.md",
    "AppSecurity": "plugins/comprehensive-review/agents/security-auditor.md",
    "CodeDebt": "plugins/codebase-cleanup/agents/code-reviewer.md",
    "TestAutomation": "plugins/performance-testing-review/agents/test-automator.md",
    "Performance": "plugins/performance-testing-review/agents/performance-engineer.md",
}
EXTS = {".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".json", ".py",
        ".java", ".kt", ".sql", ".html", ".css", ".sh", ".ps1", ".yml", ".yaml"}
SKIP = {".git", ".external", "node_modules", ".venv", ".next", "coverage",
        "__pycache__", "test-results", ".archify", "agent_workspace", ".gradle",
        "build", "dist"}
SOURCES = {
    "checkout": "public/cosmic-checkout.js",
    "uri": "utils/upi-intent.js",
    "web": "public/checkout.html",
    "android": "tests/android/upi-receiver/app/src/main/java/ai/disha/testupi/TestBrowserActivity.java",
    "receiver": "tests/android/upi-receiver/app/src/main/java/ai/disha/testupi/FakeUpiActivity.java",
    "android_e2e": "tests/android/verify_android_flow.py",
    "ledger": "financial/postgres-ledger.js",
    "reconciliation": "financial/reconciliation-webhook.js",
    "server": "server.js",
}
BANKLESS = (
    "Do not introduce Razorpay, UPI Collect, bank/PSP API calls, "
    "scraping of a private UPI app, fabricated credit, or an automatic paid status "
    "based on app return. Android RESULT_OK and UPI 'Status=SUCCESS' are "
    "untrusted application-reported data. Capture only diagnostic metadata. "
    "Never log PINs, user tokens, credentials, full payer IDs or messages. "
    "Do not change financial state, delete records, or deploy without validation."
)

def source_files(root: Path):
    # Walk all authored workstreams (including the cinematic and production
    # subtrees), while skipping generated dist/vendor output at traversal time.
    for base, dirs, filenames in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith(".git"))
        for name in sorted(filenames):
            p = Path(base) / name
            if p.is_symlink() or p.suffix.lower() not in EXTS:
                continue
            try:
                if p.stat().st_size <= 2_000_000:
                    yield p
            except OSError:
                continue

def inventory(root: Path):
    h = hashlib.sha256()
    scanned = []
    by_ext = {}
    for p in source_files(root):
        rel = p.relative_to(root).as_posix()
        payload = p.read_bytes()
        h.update(rel.encode() + b"\0" + hashlib.sha256(payload).digest())
        scanned.append(rel)
        by_ext[p.suffix.lower()] = by_ext.get(p.suffix.lower(), 0) + 1
    return {"count": len(scanned), "byExtension": by_ext,
            "fingerprint": h.hexdigest(), "paths": scanned}

def evidence(root: Path, android_log: Path | None):
    findings = []
    def check(key, expression, expected, severity, meaning):
        rel = SOURCES[key]
        path = root / rel
        if not path.is_file():
            findings.append({"severity": severity, "code": "MISSING_SOURCE",
                             "path": rel, "reason": meaning})
            return
        content = path.read_text(encoding="utf-8", errors="replace")
        m = re.search(expression, content, re.MULTILINE)
        if bool(m) != expected:
            findings.append({"severity": severity, "code": "CONTRACT_" + key.upper(),
                             "path": rel, "reason": meaning})
    check("checkout", r"qrTapLaunchUri\s*\(", True, "P0",
          "Native QR tap adapter missing")
    check("uri", r"buildUpiUri", True, "P1", "Validated UPI URI builder missing")
    check("android", r"startActivityForResult\s*\(", True, "P0",
          "Android app launch does not capture activity-result evidence")
    check("android", r"onActivityResult\s*\(", True, "P0",
          "Android callback evidence capture missing")
    check("android", r"bankVerified=false", True, "P0",
          "Native result is not clearly distinguished from settlement")
    check("android_e2e", r"ANDROID_ACTIVITY_RESULT", True, "P0",
          "Android test does not assert activity-result evidence")
    check("checkout", r"model\.isSettled\s*\(", True, "P0",
          "Receipt must gate on backend ledger state")
    check("receiver", r"NO MONEY MOVES", True, "P1",
          "Fake UPI test receiver must be labeled nonfinancial")
    for key in ("checkout", "web"):
        content = (root / SOURCES[key]).read_text(encoding="utf-8", errors="replace")
        if re.search(r"razorpay\.js|upi-collect|collect[- ]based", content, re.I):
            findings.append({"severity": "P0", "code": "BANNED_GATEWAY",
                             "path": SOURCES[key], "reason": "No Collect or Razorpay"})
    markers = {}
    if android_log and android_log.is_file():
        data = android_log.read_text(encoding="utf-8", errors="replace")
        # Never emit raw log lines: logcat may contain VPA/token/customer PII.
        for label, pattern in {
            "requested": r"ANDROID_INTENT_REQUESTED",
            "dispatched": r"ANDROID_INTENT_DISPATCHED",
            "returned": r"ANDROID_ACTIVITY_RESULT",
            "cancelled": r"ANDROID_ACTIVITY_RESULT classification=CANCELLED",
            "noHandler": r"ANDROID_INTENT_NO_HANDLER",
            "rendererGone": r"WEBVIEW_RENDER_PROCESS_GONE",
            "hostPaused": r"ANDROID_HOST_PAUSED",
            "hostResumed": r"ANDROID_HOST_RESUMED",
        }.items():
            markers[label] = len(re.findall(pattern, data))
        if markers["noHandler"] or markers["rendererGone"]:
            findings.append({"severity": "P0", "code": "ANDROID_LAUNCH_FAULT",
                             "path": "android-log", "reason": "No UPI handler or WebView renderer failed"})
    else:
        markers = {"status": "NO_REAL_DEVICE_LOG_PROVIDED"}
    return {"findings": findings, "android": markers,
            "financialConfirmation": "NOT_TESTED", "realGPayPhonePe": "NOT_TESTED"}

def specialist_prompts(root: Path):
    if not root.is_dir():
        raise RuntimeError("Missing wshobson/agents checkout; pass --agents-root")
    prompts = {}
    for name, rel in SPECIALISTS.items():
        p = root / rel
        if not p.is_file():
            raise RuntimeError("Missing actual wshobson specialist: " + str(p))
        prompts[name] = p.read_text(encoding="utf-8")
    return prompts

def archify_candidate(repo: Path, output: Path):
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                              capture_output=True, text=True, check=False)
    sha = revision.stdout.strip() if revision.returncode == 0 else ""
    pinned = bool(re.fullmatch(r"[0-9a-f]{40}", sha))
    def source(key):
        p = SOURCES[key]
        if not pinned or not (repo / p).is_file():
            return []
        return [{"path": p, "line": 1}]
    def node(i, kind, label, sub, x, y, key):
        n = {"id": i, "type": kind, "label": label, "sublabel": sub,
             "pos": [x, y], "size": [159, 65]}
        refs = source(key)
        if refs:
            n["sources"] = refs
        return n
    nodes = [
        node("customer", "external", "Customer browser", "Android Chrome / desktop", 40, 210, "web"),
        node("checkout", "frontend", "DISHA checkout", "One payment QR + native tap", 240, 210, "checkout"),
        node("upiapp", "external", "External UPI app", "Android Intent recipient", 445, 100, "android"),
        node("scanner", "external", "Second phone", "Scan same UPI QR", 445, 310, "uri"),
        node("evidence", "security", "Android evidence", "Intent dispatched / returned", 665, 100, "android"),
        node("ledger", "database", "Recorded payment", "Authoritative ledger state", 665, 310, "ledger"),
        node("receipt", "frontend", "DISHA receipt", "Only when ledger verifies", 885, 310, "checkout"),
        node("triad", "backend", "Swarms audit loop", "Local model optional", 240, 490, "android_e2e"),
        node("agents", "security", "wshobson specialists", "Review / debug / test / risk", 40, 490, "server"),
        node("archify", "cloud", "Archify map", "Validated architecture HTML", 445, 490, "server"),
        node("tests", "backend", "Android 35 / 37", "Evidence + regression fixtures", 665, 490, "android_e2e"),
    ]
    edges = [
        ("customer", "checkout", "HTTPS checkout"),
        ("checkout", "upiapp", "Native QR tap"),
        ("checkout", "scanner", "Scannable QR"),
        ("upiapp", "evidence", "App return (untrusted)"),
        ("checkout", "ledger", "Poll recorded status"),
        ("ledger", "receipt", "Verified only"),
        ("agents", "triad", "Specialist instructions"),
        ("triad", "archify", "Architecture JSON"),
        ("triad", "tests", "Verify source + artifacts"),
        ("evidence", "tests", "Diagnostic artifacts"),
    ]
    meta = {"title": "DISHA UPI Intent and Three-Tool Evidence Loop",
            "output": "test-results/triad/architecture.html",
            "quality_profile": "standard", "visual_preset": "blueprint"}
    if pinned:
        meta["repository"] = {
            "url": "https://github.com/Tashima-Tarsh/Zero-Trust-Fintech",
            "provider": "github", "link_mode": "web", "revision": sha}
    return {
        "schema_version": 1, "diagram_type": "architecture",
        "meta": meta,
        "components": nodes,
        "connections": [
            {**{"from": a, "to": b, "label": label},
             **({"labelAt": [414, 179]} if label == "Native QR tap" else {}),
             **({"labelAt": [442, 569]} if label == "Verify source + artifacts" else {}),
             **({"labelAt": [848, 389]} if label == "Diagnostic artifacts" else {})}
            for a, b, label in edges],
        "cards": [
            {"dot": "cyan", "title": "Source-backed audit",
             "items": ["Swarms coordinates specialist reviews from wshobson/agents",
                       "Archify validates the system diagram",
                       "Android tests capture launch, return and cancellation evidence"]},
            {"dot": "rose", "title": "Proof boundary",
             "items": ["Android activity result is not proof of bank credit",
                       "Scanned QR on another phone cannot send an app callback to original browser",
                       "No bank API, UPI Collect, Razorpay SDK or fabricated financial success"]},
        ],
    }

def run_process(argv, cwd, timeout=240):
    began = time.monotonic()
    try:
        safe_env = dict(os.environ)
        safe_env["ARCHIFY_UPDATE_CHECK_DISABLED"] = "1"
        safe_env["SWARMS_TELEMETRY_ON"] = "false"
        p = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=timeout, check=False,
                           env=safe_env)
        # Logs can include credentials from unrelated test runs; store status
        # and a bounded SHA256, never raw stdout in audit artifacts.
        digest = hashlib.sha256(p.stdout.encode("utf-8", errors="replace")).hexdigest()
        return {"command": [Path(argv[0]).name, *argv[1:]], "exitCode": p.returncode,
                "seconds": round(time.monotonic()-began, 2), "outputSha256": digest}
    except (subprocess.TimeoutExpired, OSError) as err:
        return {"command": [Path(argv[0]).name, *argv[1:]], "exitCode": -1,
                "seconds": round(time.monotonic()-began, 2), "errorClass": type(err).__name__}

class OfflineSpecialist:
    """Evidence-only callable accepted by Swarms ConcurrentWorkflow.

    This is a deterministic review worker, NOT an LLM. The specialist name and
    governing instructions are read from a pinned wshobson/agents checkout.
    """

    def __init__(self, name, instructions, observations):
        self.agent_name = "DISHA_" + name
        self.prompt_sha256 = hashlib.sha256(instructions.encode()).hexdigest()
        self.observations = observations

    def run(self, task, img=None, imgs=None, streaming_callback=None):
        # No network requests, source mutations or fake success verdicts.
        checks = {
            "Architecture": ["CONTRACT_CHECKOUT", "CONTRACT_LEDGER"],
            "AndroidDebugger": ["CONTRACT_ANDROID", "CONTRACT_ANDROID_E2E",
                                "ANDROID_LAUNCH_FAULT"],
            "AppSecurity": ["BANNED_GATEWAY", "CONTRACT_ANDROID",
                            "CONTRACT_LEDGER"],
            "CodeDebt": ["MISSING_SOURCE", "CONTRACT_URI"],
            "TestAutomation": ["CONTRACT_ANDROID_E2E", "CONTRACT_RECEIVER"],
            "Performance": ["CONTRACT_CHECKOUT", "ANDROID_LAUNCH_FAULT"],
        }
        role = self.agent_name.removeprefix("DISHA_")
        matched = [f for f in self.observations["findings"]
                   if f["code"] in checks.get(role, [])]
        return json.dumps({"specialist": role, "promptSha256": self.prompt_sha256,
                           "findings": matched, "bankVerified": False})


def swarms_review(prompts, model_name, goal, root, state):
    """Use actual Swarms ConcurrentWorkflow with zero API keys when offline."""
    if model_name and not model_name.startswith(("ollama/", "ollama_chat/")):
        raise RuntimeError("--model must be a local Ollama model, e.g. ollama_chat/qwen3:4b")
    try:
        from swarms import Agent, ConcurrentWorkflow
    except ImportError:
        return {"status": "NOT_RUN_NO_LOCAL_MODEL_OR_SWARMS_PACKAGE",
                "agents": list(prompts)}
    observations = evidence(root, None)
    if model_name:
        agents = []
        for name, instructions in prompts.items():
            agents.append(Agent(
                agent_name="DISHA_" + name,
                agent_description="Evidence-based code review with read-only tools",
                system_prompt=instructions[:12000] + "\n\nDISHA override: " + BANKLESS,
                model_name=model_name, max_loops=1, tools=None,
                autosave=False, print_on=False, verbose=False))
        status = "EXECUTED_LOCAL_OLLAMA"
    else:
        agents = [OfflineSpecialist(name, instructions, observations)
                  for name, instructions in prompts.items()]
        status = "EXECUTED_SWARMS_OFFLINE_RULE_AGENTS"
    task = (goal + "\nReview the entire DISHA UPI checkout, Android evidence, "
            "and regression gate without inventing bank confirmation. "
            "Source fingerprint: " + state["fingerprint"])
    workflow = ConcurrentWorkflow(agents=agents, max_workers=6, on_error="raise",
                                  autosave=False, verbose=False, show_dashboard=False)
    result = str(workflow.run(task))
    return {"status": status, "agents": list(prompts),
            "outputSha256": hashlib.sha256(result.encode()).hexdigest(),
            "outputPreview": result[:5000]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--agents-root", type=Path, required=True)
    parser.add_argument("--archify-root", type=Path, required=True)
    parser.add_argument("--model", default="", help="Optional LOCAL ollama_chat/model")
    parser.add_argument("--goal", default="Fix DISHA Android UPI Intent and checkout evidence")
    parser.add_argument("--iterations", type=int, default=4)
    parser.add_argument("--watch-seconds", type=int, default=0,
                        help="Optional bounded local source-change watch between iterations")
    parser.add_argument("--android-log", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("test-results/triad"))
    parser.add_argument("--render", action="store_true", help="Run actual Archify finalize")
    parser.add_argument("--verify", action="store_true", help="Run lint + tests")
    parser.add_argument("--require-all", action="store_true", help="Fail if AI or Archify not executed")
    args = parser.parse_args()
    if not 1 <= args.iterations <= 20:
        parser.error("Iterations must be between 1 and 20; unbounded repair loops are unsafe")
    if not 0 <= args.watch_seconds <= 3600:
        parser.error("Watch timeout must be 0-3600 seconds")
    root = args.repo_root.resolve()
    if not (root / "package.json").is_file():
        parser.error("Not a DISHA repository")
    output = (root / args.output_dir).resolve()
    if not output.is_relative_to(root):
        parser.error("Output must stay inside the repository")
    output.mkdir(parents=True, exist_ok=True)
    os.environ["SWARMS_TELEMETRY_ON"] = "false"
    prompts = specialist_prompts(args.agents_root.resolve())
    arch_root = args.archify_root.resolve()
    if not (arch_root / "archify/bin/archify.mjs").is_file():
        raise RuntimeError("Missing actual tt-a1i/archify source checkout")
    snapshots = []
    previous = None
    for iteration in range(1, args.iterations + 1):
        state = inventory(root)
        if previous == state["fingerprint"]:
            break  # No new evidence; looping would invent progress.
        diag = evidence(root, args.android_log)
        snapshots.append({"iteration": iteration, "fingerprint": state["fingerprint"],
                          "sourceFiles": state["count"], "findings": diag["findings"],
                          "androidEvidence": diag["android"]})
        previous = state["fingerprint"]
        if not args.watch_seconds or iteration == args.iterations:
            break
        # On a developer workstation, observe committed corrections and
        # rerun only after source actually changes; no uncontrolled recursion.
        deadline = time.monotonic() + args.watch_seconds
        while time.monotonic() < deadline:
            time.sleep(min(2.0, max(0.1, deadline - time.monotonic())))
            if inventory(root)["fingerprint"] != previous:
                break
        else:
            break
    state = inventory(root)
    result = {
        "goal": args.goal, "revision": run_process(["git", "rev-parse", "--short", "HEAD"], root),
        "upstreams": PINNED, "frameworks": {
            "swarms": "NOT_RUN", "wshobson": "PROFILE_FILES_LOADED",
            "archify": "CANDIDATE_CREATED"},
        "inventory": {"count": state["count"], "byExtension": state["byExtension"],
                      "fingerprint": state["fingerprint"]},
        "iterations": snapshots, "maxIterations": args.iterations,
        "android": evidence(root, args.android_log)["android"],
        "limits": {"realPaymentValidated": False, "bankAPIUsed": False,
                   "automaticallyEditedProductionCode": False},
    }
    candidate = output / "architecture.json"
    candidate.write_text(json.dumps(archify_candidate(root, output), indent=2)+"\n",
                         encoding="utf-8")
    result["agents"] = swarms_review(prompts, args.model, args.goal, root, state)
    result["frameworks"]["swarms"] = result["agents"]["status"]
    if args.render:
        cli = arch_root / "archify/bin/archify.mjs"
        result["archify"] = run_process(
            ["node", str(cli), "finalize", "architecture", str(candidate),
             str(output / "architecture.html"), "--repo-root", str(root),
             "--quality", "standard", "--json"], root, timeout=240)
        result["frameworks"]["archify"] = (
            "VALIDATED_RENDERED" if result["archify"]["exitCode"] == 0
            else "FAILED_FINALIZE")
    else:
        result["archify"] = {"status": "NOT_RENDERED"}
    if args.verify:
        result["checks"] = [
            run_process(["node", "scripts/lint.js"], root, timeout=240),
            run_process(["node", "tests/runner.js"], root, timeout=900),
        ]
    else:
        result["checks"] = []
    ok = not any(x["severity"] == "P0" for x in result["iterations"][-1]["findings"])
    ok = ok and all(c["exitCode"] == 0 for c in result["checks"])
    if args.render:
        ok = ok and result["archify"]["exitCode"] == 0
    if args.require_all:
        ok = ok and result["agents"]["status"] in {
            "EXECUTED_LOCAL_OLLAMA", "EXECUTED_SWARMS_OFFLINE_RULE_AGENTS"}
        ok = ok and result["frameworks"]["archify"] == "VALIDATED_RENDERED"
    result["passedStaticGates"] = ok
    (output / "report.json").write_text(json.dumps(result, indent=2)+"\n",
                                        encoding="utf-8")
    print("DISHA_TRIAD_REPORT " + json.dumps({
        "sourceFiles": state["count"], "findings": len(result["iterations"][-1]["findings"]),
        "swarms": result["frameworks"]["swarms"],
        "archify": result["frameworks"]["archify"], "passedStaticGates": ok,
        "realPaymentValidated": False}))
    return 0 if ok else 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError) as error:
        print("DISHA_TRIAD_FAILED " + type(error).__name__ + ": " + str(error),
              file=sys.stderr)
        sys.exit(2)
