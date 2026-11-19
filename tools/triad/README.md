# DISHA — three-tool Android UPI evidence loop

This directory integrates the **actual** upstream repositories at pinned commits:

1. **Swarms** supplies the concurrent multi-agent execution engine. Requires a
   local Ollama model for actual inference; without one the orchestrator reports
   \`NOT_RUN_NO_LOCAL_MODEL\` (it never invents AI reviews).
2. **wshobson/agents** supplies six real specialist prompt files. These are
   loaded at runtime from an external sparse checkout, not made-up names.
3. **Archify** validates and renders the code-backed runtime diagram as HTML.
   A candidate alone is not reported as a validated diagram.

## Setup once (PowerShell, VS Code / Antigravity)

Clone or sparse-checkout the three upstreams in \`.external/\` on the developer
machine. The pinned commits are in \`tools/triad/upstreams.json\`. Installation
must be explicit and reviewed when updating pins.

\`\`\`powershell
git clone --filter=blob:none https://github.com/kyegomez/swarms.git .external/swarms
git -C .external/swarms checkout 76c5e34a341c568668d29e532434c7e852edd297
git clone --filter=blob:none https://github.com/wshobson/agents.git .external/agents
git -C .external/agents checkout 42203085cfc5736204bf0f6d436dff7e1da0bf3f
git clone --filter=blob:none https://github.com/tt-a1i/archify.git .external/archify
git -C .external/archify checkout 44781293f38728baf04dbad33ce1a0cef8c39cca
npm ci --prefix .external/archify
\`\`\`

Default offline scan uses stdlib Python and Node for source inspection.
When Swarms is installed, its real ConcurrentWorkflow runs six deterministic
specialist workers with no LLM or external API; when it is not installed the
report explicitly says the framework was not run:

\`\`\`powershell
python tools/triad/loop.py --agents-root .external/agents --archify-root .external/archify --render --verify --iterations 8
\`\`\`

Optional *actual six-agent Swarms execution*, with a LOCAL Ollama model and no
hosted LLM or bank API (install Swarms only into a developer virtual environment):

\`\`\`powershell
python -m pip install "swarms==17.0.3"
python tools/triad/loop.py --agents-root .external/agents --archify-root .external/archify --model ollama_chat/qwen3:4b --render --verify --require-all --iterations 8
\`\`\`

**Artifacts:** \`test-results/triad/report.json\`,
\`test-results/triad/architecture.json\`,
\`test-results/triad/architecture.html\` (only when Archify completes finalize).

GitHub Actions: run **DISHA triad architecture + agent evidence audit**
manually. Default GitHub-hosted workflow runs the actual wshobson profile loader,
static source analysis, lint/tests, and Archify render; it cannot run Ollama inference
without a local model on a self-hosted runner. The report records this.

## Evidence and safety

The Android test host records \`ANDROID_INTENT_REQUESTED\`,
\`ANDROID_INTENT_DISPATCHED\`, \`ANDROID_ACTIVITY_RESULT\`,
\`ANDROID_HOST_PAUSED\` and \`ANDROID_HOST_RESUMED\`. An Android activity
result is *not* proof that the bank credited money. Do not use app-reported
success, Chrome page focus, a UTR string or a screenshot alone to auto-settle
payment. A QR scanned on another phone cannot deliver a result to the original
browser through the first phone's Android activity API.

No bank API, UPI Collect, Razorpay SDK, full-PIN capture, other apps' private
storage access, silent patching, or auto-merge. The bounded loop stops if the
source fingerprint has not changed. Financial state requires trustworthy
recorded-credit evidence, even if the user's checkout needs no gateway.

## Scope

Source scan includes JS, TS, Python, Java, SQL, workflow and CSS/HTML across
the repository. Generated frontend copies and unrelated installed dependencies
are excluded, and all deterministic check results are retained in the report.
Run Android 35/37 instrumented E2E via the repository's existing workflow
before any production release. A green simulated receiver test is **not**
real Google Pay/PhonePe or live transfer certification.
