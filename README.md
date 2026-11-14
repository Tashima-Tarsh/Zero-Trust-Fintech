# 🏦 DISHA 8.2 — Sovereign Zero-Fee, Fraud-Proof UPI Checkout

> **DISHA 8.2** is an enterprise-grade sovereign payment rail engineered for Indian merchants. It eliminates the 2% to 2.5% MDR gateway tax, prevents banking freeze bans through intelligent VPA rotation, blocks receipt replay fraud with mathematical decimal challenges, and guarantees cryptographic double-entry ledger balance.

---

## ⚡ Interactive Motion Architecture

The diagram below visualizes live packet telemetry, moving verification streams, dynamic paise challenge generation, and sub-second WebSocket soundbox alerts:

<div align="center">
  <img src="assets/architecture-motion.svg" width="100%" alt="Zero-Trust Flow Motion Architecture" />
</div>

---

## 🏛️ System Architecture & 12 Tasks Breakdown

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       DISHA 8.2 ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   [Customer Device]                  [DISHA 8.2 Gateway]                │
│          │                                   │                          │
│          ├─── 1. Scan Untouchable QR ───────►│  (15s dynamic refresh)   │
│          │    (Base ₹100 + ₹0.37 cents)      │  (Anti-OCR 2% noise)     │
│          │                                   │                          │
│          ├─── 2. Direct Bank Settlement ────►│  (NPCI UPI Deep Link)    │
│          │    (PhonePe / GPay / Paytm)       │  (Zero Aggregator Escrow)│
│          │                                   │                          │
│          ├─── 3. Share Receipt ─────────────►│  (W3C Web Share Target)  │
│          │    (Service Worker Intercept)     │                          │
│          │                                   │                          │
│          │                             ┌─────┴──────────────┐           │
│          │                             │  7-LAYER FRAUD     │           │
│          │                             │  VERIFICATION      │           │
│          │                             └─────┬──────────────┘           │
│          │                                   │                          │
│          │                                   ├── L1: Session Check      │
│          │                                   ├── L2: Amount Match       │
│          │                                   ├── L3: UTR Blacklist      │
│          │                                   ├── L4: UTR Freshness      │
│          │                                   ├── L5: Txn Note Match     │
│          │                                   ├── L6: Rate Limit         │
│          │                                   └── L7: Double-Entry Ledger│
│          │                                                              │
│          │◄── 4. Real-time WebSocket ────────┘                          │
│          │    (Confetti + Teal Checkmark)                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Setup & Local Execution

### 1. Prerequisites
- **Node.js**: v18.0+ (Tested on Node v24 LTS with native `node:sqlite`)
- **NPM**: v9.0+
- **PostgreSQL** (Optional for production; SQLite engine runs seamlessly if Postgres is absent)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/your-username/Zero-Trust-Fintech.git
cd Zero-Trust-Fintech

# Install dependencies (express, ws, qrcode, pg, dotenv)
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default parameters in `.env`:
```ini
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/disha82
MERCHANT_UPI_ID=disha82@ybl
MERCHANT_NAME=DISHA 8.2 Store
```

### 4. Start Server
```bash
npm start
```
Open your browser at: **`http://localhost:3000`**

---

## 📱 How to Get a Merchant UPI ID (NPCI Compliance)

To receive business payments directly with zero aggregator holdbacks:
1. **Current Bank Account**: Open a business account with any authorized Indian scheduled bank (HDFC, ICICI, SBI, Axis, YES Bank).
2. **Obtain Official VPA**: Request a merchant VPA format from your relationship manager (e.g. `yourshop@okaxis`, `yourbusiness@icici`).
3. **NPCI Specification Compliance**:
   - Deep link schema: `upi://pay?pa={VPA}&pn={NAME}&am={AMOUNT}&tn={ORDER_ID}&tr={TXN_REF}&cu=INR`
   - Currency (`cu`): Strictly uppercase `INR`.
   - Decimal accuracy (`am`): Exactly 2 decimal digits (`toFixed(2)`).
   - Transaction Note (`tn`): Encodes unique order identifier for receipt cross-verification.

---

## 🧪 Testing Checklist & Verification Guide

Run the automated test suite verifying all core math, sessions, NPCI links, VPA routing, and 7-layer fraud checks:

```bash
npm test
```

### Test Case Validation:
| Check | Test Vector | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| **Mathematical Anti-Replay** | Base ₹100 + Random Cents (11-97, excluding 00, 10, 20... and 05) | Never clashes with standard round payments | ✅ PASS |
| **Old Receipt Replay** | Submitting ₹100.00 receipt against ₹100.37 challenge | Layer 2 rejection (`AMOUNT_MISMATCH`) | ✅ PASS |
| **Tampered Receipt** | Modifying image text or amount | Layer 2 rejection | ✅ PASS |
| **Duplicate UTR** | Submitting same 12-digit UTR twice | Layer 3 rejection (`UTR_ALREADY_USED`) | ✅ PASS |
| **Session TTL (3 Min)** | Verifying after 180 seconds | Layer 1 rejection (`SESSION_EXPIRED`) | ✅ PASS |
| **Untouchable QR (15s)** | Screenshotting after 15s | QR invalid; background auto-refreshes | ✅ PASS |
| **Anti-OCR 2% Noise** | OCR bot scraping QR canvas | Pixel luminescence noise foils OCR | ✅ PASS |
| **Double-Entry Ledger** | Bank Account (Asset) + Revenue Account | `Sum(Debits) === Sum(Credits)` | ✅ PASS |
| **VPA Routing Engine** | Rotating through active bank VPAs | Health > 70, Cooldown > 45s, Pattern masked | ✅ PASS |
| **WebSocket Delivery** | Real-time push on `/ws?orderId=...` | Instant UI transition & audio chime | ✅ PASS |

---

## ☁️ Free-Tier Deployment to Koyeb

Deploy DISHA 8.2 with zero servers using Koyeb's generous free tier:

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "feat(disha-8.2): sovereign zero-fee checkout"
   git push origin main
   ```
2. **Create New Koyeb App**:
   - Go to [Koyeb Console](https://app.koyeb.com/)
   - Click **Create App** → Select **GitHub**
   - Choose your repository `Zero-Trust-Fintech`
3. **Configure Environment Variables**:
   - `PORT`: `8000` (or `3000`)
   - `MERCHANT_UPI_ID`: `yourbusiness@okaxis`
   - `MERCHANT_NAME`: `Your Business Name`
   - `DATABASE_URL`: Your Supabase / Neon / Render PostgreSQL connection string (or omit to let DISHA run the built-in zero-dependency SQLite engine).
4. **Deploy**:
   - Set Buildpack to **Node.js**
   - Click **Deploy**. Koyeb automatically provisions an SSL-secured endpoint (`https://<app>.koyeb.app`).
   - The PWA manifest and Android Share Target work natively over HTTPS!
