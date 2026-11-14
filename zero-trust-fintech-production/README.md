# 🚀 Zero-Trust Fintech Production: Enterprise UPI Engine

Enterprise-grade, zero-trust UPI payment processing and forensic verification system featuring **sub-second WebSocket confirmation**, **5-layer fraud detection**, **n8n automated orchestration**, and **PLpgSQL / Merkle tree immutable audit ledgers**.

---

## 🏛️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ZERO-TRUST FINTECH PRODUCTION SYSTEM                     │
└─────────────────────────────────────────────────────────────────────────────┘

       Mobile Device / PWA (SharePay)               Nginx Reverse Proxy
                     │                                      │
                     ▼                                      ▼
         ┌──────────────────────────────────────────────────────┐
         │                    FastAPI Server                    │
         │  ┌────────────────────────────────────────────────┐  │
         │  │ Layer 1: Mathematical Freshness Decoding       │  │
         │  │ Layer 2: Dynamic Challenge Matching            │  │
         │  │ Layer 3: Replay Attack Deduplication (Redis)   │  │
         │  │ Layer 4: Native Share vs Screenshot Analysis   │  │
         │  │ Layer 5: Behavioral Anomaly Scorer             │  │
         │  └────────────────────────────────────────────────┘  │
         │                                                      │
         │  ┌───────────────────────┐  ┌─────────────────────┐  │
         │  │ Ed25519 Attestation   │  │ WebSocket Broadcaster│ │
         │  └───────────────────────┘  └─────────────────────┘  │
         └──────────┬───────────────────────────┬───────────────┘
                    │                           │
                    ▼                           ▼
         ┌───────────────────────┐   ┌───────────────────────────┐
         │  PostgreSQL (PLpgSQL) │   │     n8n Orchestrator      │
         │  - merkle_ledger      │   │  - payment_verification   │
         │  - device_keys        │   │  - fraud_alert            │
         │  - audit_logs         │   │  - bank reconciliation    │
         └───────────────────────┘   └───────────────────────────┘
```

---

## 🛡️ The 5-Layer Fraud Detection Engine

1. **Mathematical Freshness Decoding**: Checks timestamp freshness window (within 120s) and aligns with banking hours.
2. **Dynamic Challenge Matching**: Verifies unique, single-use cryptographic challenge tokens stored with TTL in Redis.
3. **Replay Attack Detection**: Computes SHA-256 fingerprints across `(utr, amount, device_id)` and enforces 24-hour deduplication.
4. **Screenshot / Photo Analysis**: Differentiates native OS `android.intent.action.SEND` shares from manipulated image uploads.
5. **Behavioral Anomaly Detection**: Rates device attempt frequencies, IP reputation, and user-agent consistency.

---

## 📁 Directory Structure

```
zero-trust-fintech-production/
├── app/
│   ├── main.py                 # FastAPI application with WebSocket lifecycle
│   ├── core/
│   │   ├── config.py           # Typed pydantic-settings configuration
│   │   ├── security.py         # Ed25519 signature verification & replay checking
│   │   ├── ledger.py           # Hash-chained Merkle immutable ledger
│   │   ├── fraud_engine.py     # 5-layer fraud detection engine
│   │   └── challenge.py        # Dynamic challenge generator & response validator
│   ├── models/
│   │   ├── database.py         # SQLAlchemy ORM models (MerkleLedger, DeviceKey, AuditLog)
│   │   └── schemas.py          # Pydantic request/response schemas
│   ├── api/
│   │   ├── routes.py           # REST endpoints (/payment/verify, /challenge/generate, /ledger/verify)
│   │   └── websocket.py        # Real-time WebSocket connection manager
│   ├── services/
│   │   ├── redis_service.py    # Redis connection pooling
│   │   └── n8n_webhook.py      # Outbound n8n webhook dispatcher
│   └── middleware/
│       └── audit.py            # Comprehensive security audit trail logger
├── n8n/
│   └── workflows/
│       ├── payment_verification.json # Settlement and bank dispatch workflow
│       └── fraud_alert.json          # Automated security notification workflow
├── docker-compose.yml          # Production multi-service compose (API, Postgres, Redis, n8n, Nginx)
├── init-db.sql                 # PLpgSQL schema & verify_ledger_integrity() function
├── nginx.conf                  # Production reverse proxy with WebSocket upgrade support
├── requirements.txt            # Python dependencies
└── .env.example                # Sample environment configuration
```

---

## 🚀 Quickstart & Deployment

### 1. Configure Environment
```bash
cd zero-trust-fintech-production
cp .env.example .env
# Edit .env with your production credentials
```

### 2. Launch with Docker Compose
```bash
docker-compose up -d --build
```

### 3. Check Service Health
```bash
curl http://localhost/health
# {"status":"healthy","service":"zero-trust-fintech","version":"2.0.0"}
```

### 4. Connect to Real-Time WebSocket (Sub-second Confirmation)
```javascript
const ws = new WebSocket('ws://localhost/ws/MERCHANT_STORE_001');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'payment_confirmed') {
    console.log('✅ Instant payment verified:', data);
  }
};
```
