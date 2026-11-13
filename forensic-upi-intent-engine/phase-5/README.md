# Phase 5: The Statement Parser (The Ultimate Truth Source)

This folder preserves the Phase 5 statement-parser workflow **as supplied**, without changing the workflow nodes, fields, SQL strings, endpoint placeholder, schedule, or execution logic.

## The Perfect Reconciliation Logic (submitted design)

1. **Automated Ingestion:** Every hour, it fetches your bank statement (via API or Email PDF parsing).
2. **UTR Extraction:** It pulls every successful UPI credit from the statement.
3. **Smart Matching:** It matches these UTRs against your `payment_sessions` table.
4. **Auto-Correction:**
   - If a session was `Pending`, it becomes `Verified`.
   - If a session was `Fraud` but the money actually arrived, it overrides the AI and credits the user.
   - It updates the `financial_ledger`.

## Submitted workflow

- [`reference/04_statement_parser.json.txt`](reference/04_statement_parser.json.txt) — exact user-supplied workflow text, preserved without alterations.
- The existing [`../n8n-workflows/04_statement_parser.json`](../n8n-workflows/04_statement_parser.json) is unchanged, because the supplied snippet includes a JavaScript-style comment inside JSON and is not valid importable JSON without modification.

## Project Completion: The Zero-Trust Fintech Engine (submitted phases)

1. **Foundation:** PostgreSQL Schema & 1,000 VPA Pool.
2. **The Brain:** N8N Forensic Verifier (ELA + OCR + Heuristics).
3. **The Sensor:** React Native Unified Pay Trigger (Intent + AppState Tracking).
4. **The Health Monitor:** Canary Tester.
5. **The Truth Source:** Statement Parser.

## Deployment status

This is an **unmodified reference artifact**, not a deployed or tested financial settlement workflow. The endpoint `https://api.your-bank.com/v1/statements/latest` is a placeholder; no authorized bank feed is connected. The user-supplied query interpolates a UTR into SQL, and its ledger-update nodes are not proof of transactional reconciliation. No ledger entries, bank settlements, or session statuses have been changed by adding this file. The code is not claimed to guarantee zero financial loss.
