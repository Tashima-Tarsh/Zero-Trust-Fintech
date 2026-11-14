# 📱 SharePay Merchant Dashboard (PWA)

Zero-fee, Zero-Trust UPI payment acceptance Progressive Web App (PWA) for merchants.

---

## 🌟 Highlights

- **No App Store Needed:** Operates completely in the web browser and installs directly to Android, iOS, or Desktop home screens as a native standalone PWA.
- **Zero-Trust Challenge QR:** Generates dynamic, one-time UPI payment QR codes bound to unique cryptographic challenges and order references.
- **Sub-Second Confirmation (< 1s):** Directly connected via WebSocket to the FastAPI backend; updates instantly the moment a customer shares the UPI receipt.
- **Audio & Haptic Feedback:** Plays sound chimes via Web Audio API and vibrates mobile devices on incoming payments.
- **Offline Resilient:** Service Worker caching ensures full availability even during intermittent internet connectivity.

---

## 🏗️ Architecture & Interaction Flow

```
┌─────────────────┐             ┌─────────────────────┐             ┌────────────────────────┐
│  Merchant PWA   │             │ Zero-Trust Backend  │             │ Customer UPI App       │
│  (Port 3000)    │             │ (Port 8000)         │             │ (GPay/PhonePe/BHIM)    │
└────────┬────────┘             └──────────┬──────────┘             └───────────┬────────────┘
         │                                 │                                    │
         │ 1. POST /api/v1/challenge/gen   │                                    │
         │────────────────────────────────>│                                    │
         │                                 │                                    │
         │ 2. Challenge Token + TTL (300s) │                                    │
         │<────────────────────────────────│                                    │
         │                                 │                                    │
         │ 3. Displays Dynamic UPI QR      │                                    │
         │    (upi://pay?pa=...&tn=Ch:...) │                                    │
         │                                 │ 4. Customer scans QR & pays        │
         │                                 │<───────────────────────────────────│
         │                                 │                                    │
         │                                 │ 5. Customer shares receipt         │
         │                                 │    via Web Share Target            │
         │                                 │<───────────────────────────────────│
         │                                 │                                    │
         │                                 │ 6. 5-Layer Fraud Detection         │
         │                                 │    & PostgreSQL Merkle Ledger      │
         │                                 │                                    │
         │ 7. WebSocket Instant Broadcast  │                                    │
         │    {"type":"payment_confirmed"} │                                    │
         │<────────────────────────────────│                                    │
         │                                 │                                    │
         │ 8. Audio Chime + Vibrate +      │                                    │
         │    Updates Live Ledger List     │                                    │
         v                                 v                                    v
```

---

## 🚀 Quick Start

### 1. Run with Node.js
```bash
cd merchant-pwa
npm start
# Runs on http://localhost:3000
```

### 2. Verify Health
```bash
curl http://localhost:3000/health
# {"status":"ok","service":"merchant-pwa"}
```

### 3. Deploy Statically
Upload the `public/` directory to Netlify, Vercel, Cloudflare Pages, or Firebase Hosting:
```bash
# Example with Netlify CLI
netlify deploy --prod --dir=public
```

---

## ⚙️ Configuration

Click the **⚙️** icon in the dashboard header to customize:
- **Merchant ID:** e.g., `merchant_001`
- **Receiving UPI ID (VPA):** e.g., `yourstore@upi`
- **Backend API URL:** e.g., `http://localhost:8000/api/v1`
- **Backend WebSocket URL:** e.g., `ws://localhost:8000/ws`
Settings are automatically saved in browser `localStorage`.
