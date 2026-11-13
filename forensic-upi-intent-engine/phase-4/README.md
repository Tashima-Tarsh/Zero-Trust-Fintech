# Phase 4 — VPA Health & Rotation Engine

This folder retains the original Phase 4 source code **as submitted**, without rewriting it.

- `../database/schema_additions.sql` contains the supplied health-log table and additional cooldown fields.
- `reference/03_canary_tester.json.txt` contains the supplied n8n JSON text verbatim.
- `reference/vpa_rotator.py.txt` contains the supplied Python rotator text verbatim.

The submitted canary workflow and rotator are stored as **inactive reference snippets**, not installed or activated in the running paths. The provided canary JSON contains an inline comment and therefore is not valid importable JSON as written. The supplied rotator contains a placeholder password and a cooldown-reset fallback. They have not been connected to the service.

Existing `n8n-workflows/03_canary_tester.json` and merchant VPA allocator are unchanged.

No live ₹1 canary transfers, cooldown resets, anti-block evasion, bank integrations, or runtime deployment were performed.
