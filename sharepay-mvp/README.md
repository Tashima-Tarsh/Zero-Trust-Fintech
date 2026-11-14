# SharePay MVP: Zero-Trust Fraud-Proof UPI Checkout

A 100% fraud-proof UPI Progressive Web Application (PWA) checkout engine combining **Web Share Target receipt capture**, **5-layer cryptographic & temporal validation**, **atomic database checkpointing**, and **n8n orchestration**.

## 🛡️ The 5 Defense Layers: Zero Old Receipts, Zero Tampering

| Layer | Security Control | Attack Blocked |
|---|---|---|
| **1. Dynamic Challenge Amount** | Random paise-level discount on every order (₹100 base $\rightarrow$ ₹99.37) | Replaying round-number or mismatched receipts |
| **2. NPCI UTR Forensic Freshness** | Decodes Julian Day (`DDD`) & Hour (`HH`) in IST from 12-digit UTR (`YDDDHHNNNNNN`) | Old receipts from yesterday, last month, or older hours |
| **3. Atomic Database Checkpoint** | Native SQLite checkpoint table (`processed_utrs`) with single-use guarantee | Replay / double-spend of the same UTR |
| **4. Session Cookie Binding** | `HttpOnly; SameSite=Lax` session cookie preserved by Chrome into Share Target | Cross-session injection and race conditions |
| **5. Transaction Note Binding** | Opportunistic match of embedded order ID (`tn=Order_99X...`) | Receipts paid to other merchants or transactions |

---

## 📁 Project Structure

```
sharepay-mvp/
├── public/
│   ├── index.html              # Checkout UI with 3-minute circular timer & dynamic challenge
│   ├── manifest.json           # PWA Web Share Target registration
│   ├── service-worker.js       # Background receipt interceptor & secure forwarder
│   ├── success.html            # Verified settlement confirmation
│   ├── failed.html             # Rejection screen with explicit forensic reason codes
│   └── icon-192.png            # 192x192 PWA application badge
├── n8n-workflows/
│   └── 01_sharepay_fraud_pipeline.json # n8n workflow implementing the Fail-Closed Zero-Trust pipeline
├── tests/
│   └── attack-matrix.test.js   # Automated test suite testing all 7 fraud attack scenarios
├── database.js                 # Native SQLite checkpointing & audit log tables
├── forensics.js                # NPCI UTR Julian Day & Hour decoder + multi-app regex parser
├── pipeline.js                 # 5-layer fail-closed forensic verification pipeline
├── server.js                   # Express + WebSocket backend server & optional n8n webhook dispatcher
├── package.json                # Project manifest & test scripts
├── .env                        # Configuration (Merchant UPI ID, ports, optional n8n webhook)
└── .gitignore                  # Ignore node_modules, local sqlite db, and env files
```

---

## 🚀 Running the Project

### 1. Install & Test
```bash
cd sharepay-mvp
npm test
```
Runs the 8 automated attack simulation tests verifying rejection of:
- Duplicate UTR replay
- Last month's receipt (Julian day mismatch)
- Older hours today (Hourly window expired)
- Amount mismatch
- 3-minute session expiration
- Transaction note mismatch
- Unparseable text

### 2. Start Development Server
```bash
npm install
npm run dev
```

### 3. Connect to n8n (Optional)
Import `sharepay-mvp/n8n-workflows/01_sharepay_fraud_pipeline.json` into your local or cloud n8n instance.
Add to `.env`:
```env
N8N_WEBHOOK_URL=http://localhost:5678/webhook/sharepay-verify
```
The server will automatically stream all settlement and rejection audit events to your n8n workflow for alerting and bookkeeping.
