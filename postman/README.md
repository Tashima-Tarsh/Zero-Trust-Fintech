# 📮 DISHA 8.2 — Production Postman Collection & Automated API Test Suite

Comprehensive Postman workspace and automated verification suite for the **DISHA 8.2 Sovereign UPI & Zero-Trust Fintech Architecture**.

---

## 📂 Included Assets

| Asset File | Purpose | Pre-Configured Endpoints |
|---|---|---|
| [`DISHA_8.2_Production.postman_collection.json`](./DISHA_8.2_Production.postman_collection.json) | Complete 23-request collection across 5 operational tiers with pre-request scripts & Chai assertions | Production & Local routes |
| [`DISHA_8.2_Production.postman_environment.json`](./DISHA_8.2_Production.postman_environment.json) | Production Render environment configuration | `disha-checkout.onrender.com`<br>`disha-merchant-saas.onrender.com`<br>`disha-api-backend.onrender.com` |
| [`DISHA_8.2_Local.postman_environment.json`](./DISHA_8.2_Local.postman_environment.json) | Local development environment configuration | `localhost:3000`<br>`localhost:5000`<br>`localhost:8000` |
| [`test-runner.js`](./test-runner.js) | Standalone Node.js test harness that executes the entire collection, resolves dynamic chaining variables, and prints execution reports | CLI Automation & CI/CD |

---

## 🚀 Quick Start: Running via CLI Runner

Run the automated test runner directly from your terminal:

```bash
# Execute against live Render Production
node postman/test-runner.js DISHA_8.2_Production.postman_environment.json

# Execute against local dev servers
node postman/test-runner.js DISHA_8.2_Local.postman_environment.json
```

---

## 🖥️ Import into Postman (Desktop or Web)

1. Open **Postman**.
2. Click **Import** (top left).
3. Drag & drop or select the three JSON files:
   - `postman/DISHA_8.2_Production.postman_collection.json`
   - `postman/DISHA_8.2_Production.postman_environment.json`
   - `postman/DISHA_8.2_Local.postman_environment.json`
4. Select the environment dropdown (top right) and choose **`DISHA 8.2 — Render Production`**.
5. Click **Run collection** to execute the entire suite sequentially.

---

## 📋 Collection Structure & Test Coverage (23 API Flows)

### 1. System Health & Infrastructure
- `GET /health` (Checkout Gateway) — Validates gateway uptime and identity.
- `GET /health` (Merchant SaaS) — Confirms console availability.
- `GET /health` (Zero-Trust Backend) — Verifies Python core API.
- `GET /health/detailed` (DB + Redis) — Verifies PostgreSQL 15 and Redis 7 connection health.

### 2. Customer Sovereign Checkout (NPCI Intent)
- `GET /api/session/new` — Generates dynamic challenge amount (`₹250.xx`) and NPCI UPI link.
- `GET /api/session/:orderId` — Polls active session status and expiry TTL.
- `POST /api/verify` — Tests 7-layer verification (Amount matching, UTR freshness, anti-replay).
- `POST /api/npci-callback` — Simulates bank NPCI webhook ingestion with response code `00`.
- `POST /api/simulate-payment` — Tests sandbox payment settlement and unauthorized blocking.

### 3. Merchant SaaS Platform & Console
- `POST /api/auth/login` — Authenticates merchant (`ramesh@kirana.in`) and extracts JWT/Bearer token.
- `GET /api/merchant/dashboard` — Retrieves KPI metrics (revenue, transaction count, completion rate).
- `GET /api/merchant/vpas` — Fetches active and standby merchant VPAs.
- `POST /api/merchant/vpas` — Dynamically adds a new secondary VPA with automated bank routing.
- `PATCH /api/merchant/vpas/:id` — Designates primary default UPI ID.
- `GET /api/merchant/dashboard` — Retrieves soundbox and profile configurations.
- `PUT /api/merchant/profile` — Updates multilingual soundbox voice settings (Hindi/English, volume).
- `GET /api/merchant/reports?format=csv` — Downloads CSV ledger with CSV injection sanitization.

### 4. Enterprise IP Whitelist Firewall
- `GET /api/merchant/ip-whitelist` — Retrieves authorized game server nodes and blocked audit logs.
- `POST /api/merchant/ip-whitelist` — Whitelists new server IP / CIDR block.
- `POST /api/gaming/verify-payment` — Tests gaming verification endpoint under IP firewall enforcement.
- `DELETE /api/merchant/ip-whitelist/:id` — Removes authorized IP from perimeter firewall.

### 5. Zero-Trust Backend & Merkle Ledger
- `GET /api/v1/ledger/verify` — Validates cryptographic Merkle tree consistency.
- `GET /api/v1/vpa/health` — Assesses VPA health scores, daily velocity, and anti-ban limits.

---

## 🔒 Security & Data Masking
- All passwords and secret tokens are parameterized using `{{SESSION_TOKEN}}` and `{{RENDER_API_KEY}}`.
- UTRs are dynamically generated per run to satisfy NPCI timestamp freshness rules.
