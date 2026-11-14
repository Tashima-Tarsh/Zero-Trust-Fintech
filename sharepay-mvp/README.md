# SharePay MVP

A lightweight Zero-Trust UPI Checkout Progressive Web Application (PWA) with Web Share Target receipt capture and real-time WebSocket verification.

## 📁 Project Structure

```
sharepay-mvp/
├── public/
│   ├── index.html          # Checkout landing page with dynamic challenge amount & WebSocket
│   ├── manifest.json       # PWA manifest registering Web Share Target
│   ├── service-worker.js   # Service worker capturing shared receipt text and extracting UTR & amount
│   ├── success.html        # Verified payment confirmation screen
│   ├── failed.html         # Payment failure / rejection screen
│   └── icon-192.png        # PWA application icon (192x192)
├── server.js               # Express + WebSocket backend server for order creation & verification
├── package.json            # Node.js project manifest
├── .env                    # Environment configuration
└── .gitignore              # Ignore node_modules & local envs
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd sharepay-mvp
npm install
```

### 2. Configure Environment
Update `.env` if needed:
```env
PORT=3000
MERCHANT_UPI_ID=yourmerchant@ybl
MERCHANT_NAME=Your Store
```

### 3. Run Development Server
```bash
npm run dev
# or: npm start
```

Server runs on [http://localhost:3000](http://localhost:3000).

## 🧪 Testing

### API Test Commands
```bash
# Check if server is running
curl http://localhost:3000

# Create test order
curl -X POST http://localhost:3000/api/create-order

# Verify payment (manual test)
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"utr":"123456789012","amount":100.37}'
```

### Mobile Phone Testing (with ngrok)
1. Expose the local server:
   ```bash
   npx ngrok http 3000
   ```
2. Open the ngrok URL (`https://<subdomain>.ngrok.io`) in Chrome on Android.
3. Tap **Pay with UPI** to open the UPI app.
4. Complete payment.
5. In your UPI app, tap **Share Receipt** and select **SharePay MVP** from the share sheet.
6. The service worker intercepts the share target, extracts the 12-digit UTR and amount, posts to `/api/verify`, and redirects to the success screen.
