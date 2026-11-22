# 🚀 Complete Backend Setup Guide

This guide walks you through deploying and operating the Zero-Trust Fintech production backend from scratch.

---

## 📦 Step 1: Project Setup

### Directory Layout
```bash
zero-trust-fintech-production/
├── app/
│   ├── main.py                 # FastAPI application with WebSocket lifecycle
│   ├── core/
│   │   ├── config.py           # Typed settings & environment variables
│   │   ├── security.py         # Ed25519 & ECDSA device attestation verifier
│   │   ├── ledger.py           # Merkle tree hash-chained immutable ledger
│   │   ├── fraud_engine.py     # 5-layer fraud detection engine
│   │   └── challenge.py        # Dynamic challenge manager (Redis TTL)
│   ├── models/
│   │   ├── database.py         # SQLAlchemy models (TransactionBlock, DeviceKey, AuditLog)
│   │   └── schemas.py          # Pydantic schemas
│   ├── api/
│   │   ├── routes.py           # REST endpoints (/payment/verify, /challenge/generate, etc.)
│   │   └── websocket.py        # Real-time WebSocket connection manager
│   ├── services/
│   │   ├── redis_service.py    # Redis async client with connection pooling
│   │   └── n8n_webhook.py      # n8n webhook orchestration client
│   └── middleware/
│       └── audit.py            # Security audit trail logging
├── n8n/
│   └── workflows/
│       ├── payment_verification.json # Settlement & bank reconciliation workflow
│       └── fraud_alert.json          # Fraud incident notification workflow
├── docker-compose.yml          # Multi-container orchestration (API, Postgres, Redis, n8n)
├── init-db.sql                 # PLpgSQL schema & stored procedures
├── Dockerfile                  # Production container definition
├── requirements.txt            # Python dependencies
├── .env.example                # Sample environment configuration
└── .env                        # Active local configuration
```

---

## 🚀 Step 2: Running with Docker Compose

```bash
# 1. Navigate to directory
cd zero-trust-fintech-production

# 2. Start all services (PostgreSQL, Redis, n8n, FastAPI API)
docker-compose up -d --build

# 3. Check service health
docker-compose ps

# 4. View API logs in real-time
docker-compose logs -f api

# 5. Verify API Health Endpoint
curl http://localhost:8000/health
# Response: {"status":"healthy","service":"zero-trust-fintech","version":"2.0.0"}

# 6. Access Interactive Swagger Documentation
# Open in browser: http://localhost:8000/docs
```

---

## 🧪 Step 3: End-to-End Workflow Testing

### 1. Generate Payment Challenge
```bash
curl -X POST http://localhost:8000/api/v1/challenge/generate \
  -H "Content-Type: application/json" \
  -d '{"merchant_id": "MERCHANT_001", "amount": 100.50}'
```

### 2. Connect Real-Time WebSocket for Sub-Second Confirmation
In your browser console or frontend script:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/MERCHANT_001');

ws.onopen = () => console.log('Connected to SharePay WebSocket');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'payment_confirmed') {
    console.log('✅ Payment confirmed in < 1 second:', data);
  }
};
```

### 3. Verify Ledger Integrity
```bash
curl http://localhost:8000/api/v1/ledger/verify
# Response: {"status":"verified","total_blocks":1,"latest_hash":"...","message":"Ledger integrity confirmed"}
```
