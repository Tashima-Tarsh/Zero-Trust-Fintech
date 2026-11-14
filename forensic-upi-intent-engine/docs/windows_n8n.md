# Windows n8n editor

Open the Git checkout in VS Code. Run **Tasks: Run Task  n8n: Set up and start**.
Node.js 22 or 24 and network access to npm are required. This installs the latest
n8n 2 release and records its exact version in the runtime package lock.

The editor opens at http://127.0.0.1:5678 after its readiness endpoint returns 200.
Complete the owner-account screen yourself. The five existing `n8n-workflows/`
JSON files are imported as unpublished workflows without editing their source.
Imports are tracked so running setup again does not overwrite editor changes.

Packages, logs, import copies and SQLite editor state live outside Git under
`D:\FintechRuntime\n8n` when the checkout is on D:. Back up this whole directory,
including the n8n-generated encryption configuration. Do not commit it.

Use **n8n: Start server** on later runs and **n8n: Check connections** to inspect
the editor and Python worker separately. The server runs in the background for
the current Windows session; automatic restart after Windows reboot is not configured.

This setup creates the editor database only. The Python worker, PostgreSQL and
Redis must be provisioned independently using the engine's matching `infra/`
schema and configuration. Existing native webhook workflows target
`http://127.0.0.1:8000`. Configure their inbound Header Auth, outbound Worker API
Key and any PostgreSQL credentials in the editor before publishing individual
workflows. Nothing is automatically published or triggered by this setup.

GitHub sync versions the source files; it does not automatically deploy changes
into the running n8n database. Export editor changes to reviewed workflow JSON
before committing them. n8n credentials remain in the runtime database.

