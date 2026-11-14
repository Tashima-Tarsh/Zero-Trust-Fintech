# Windows n8n editor

Open the repository checkout in VS Code and run Tasks: Run Task — n8n: Set up and start.

The n8n editor can be opened at http://127.0.0.1:5678 when its readiness check
passes. Editor state and logs are stored under the configured runtime directory;
do not commit generated credentials.

The active workflow sources in n8n-workflows are:
- 01_link_generator.json
- 02_intent_verifier.json
- 03_canary_tester.json
- 04_attestation_notifications.json

The client-attestation notification workflow is **inactive on import**.
Set internal worker Header Auth, configure CLIENT_ATTESTATION_NOTIFY_URL, and
change worker:8000 to the reachable worker host if n8n is not running on the
same Docker private network.

The native signing integration and enrolled device keys are configured outside
the n8n editor. n8n only reads immutable events and sends outbound notifications.
