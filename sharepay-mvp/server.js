import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';

import { database } from './database.js';
import { executeVerificationPipeline } from './pipeline.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Parse HTTP cookies helper
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    list[name] = decodeURIComponent(rest.join('=').trim());
  });
  return list;
}

// WebSocket connections map: orderId -> WebSocket
const wsClients = new Map();

wss.on('connection', (ws, req) => {
  try {
    const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const orderId = urlParams.get('orderId');
    if (orderId) {
      wsClients.set(orderId, ws);
      ws.on('close', () => wsClients.delete(orderId));
    }
  } catch (err) {
    console.error('WebSocket connection error:', err);
  }
});

function broadcastOrderUpdate(orderId, payload) {
  const ws = wsClients.get(orderId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

// Optional n8n webhook notification dispatch
async function notifyN8nWorkflow(eventType, payload) {
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nWebhookUrl) return;
  try {
    await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (err) {
    console.warn('n8n webhook dispatch skipped/timed out:', err.message);
  }
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Create Order with Challenge Decimal
app.post('/api/create-order', (req, res) => {
  const orderId = 'Order_' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const sessionToken = 'sess_' + crypto.randomBytes(8).toString('hex');
  
  // Base amount ₹100.00 with random dynamic instant discount between ₹0.01 and ₹0.99
  const baseAmount = 100.00;
  const discountPaise = Math.floor(Math.random() * 90 + 10) / 100; // 0.10 to 0.99
  const challengeAmount = parseFloat((baseAmount - discountPaise).toFixed(2));
  
  const now = Date.now();
  const expiresAt = now + 3 * 60 * 1000; // 3 minutes timeout

  const order = database.createOrder({
    id: orderId,
    amount: challengeAmount,
    baseAmount,
    discount: discountPaise,
    sessionToken,
    createdAt: now,
    expiresAt
  });

  const upiId = process.env.MERCHANT_UPI_ID || 'yourmerchant@ybl';
  const merchantName = process.env.MERCHANT_NAME || 'Your Store';
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${challengeAmount}&tn=${orderId}&cu=INR`;

  // Bind session via HttpOnly Cookie for Web Share Target routing
  res.setHeader('Set-Cookie', `sharepay_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`);
  res.json({
    orderId,
    sessionToken,
    baseAmount,
    discount: discountPaise,
    amount: challengeAmount,
    expiresAt,
    upiLink
  });
});

// 2. Direct Verification API (invoked by Service Worker or automated tests)
app.post('/api/verify', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = req.body.sessionToken || cookies.sharepay_session;
  const { utr, amount, receipt, orderId } = req.body;

  const result = executeVerificationPipeline({
    rawReceipt: receipt || (utr && amount ? `Paid ₹${amount}. UTR: ${utr}` : ''),
    sessionToken,
    orderId,
    clientNow: Date.now()
  });

  if (result.success) {
    broadcastOrderUpdate(result.orderId, {
      type: 'SUCCESS',
      orderId: result.orderId,
      utr: result.utr,
      amount: result.amount
    });
    notifyN8nWorkflow('PAYMENT_SETTLED', result);
    return res.json(result);
  } else {
    if (result.orderId) {
      broadcastOrderUpdate(result.orderId, {
        type: 'FAILED',
        orderId: result.orderId,
        reason: result.reason
      });
    }
    notifyN8nWorkflow('PAYMENT_REJECTED', result);
    return res.status(400).json(result);
  }
});

// 3. Web Share Target POST Action (/handle-share)
app.post('/handle-share', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.sharepay_session;
  const sharedText = req.body.text || req.body.title || '';

  const result = executeVerificationPipeline({
    rawReceipt: sharedText,
    sessionToken,
    clientNow: Date.now()
  });

  if (result.success) {
    broadcastOrderUpdate(result.orderId, {
      type: 'SUCCESS',
      orderId: result.orderId,
      utr: result.utr,
      amount: result.amount
    });
    notifyN8nWorkflow('PAYMENT_SETTLED', result);
    return res.redirect(303, `/success?utr=${result.utr}&orderId=${result.orderId}`);
  } else {
    if (result.orderId) {
      broadcastOrderUpdate(result.orderId, {
        type: 'FAILED',
        orderId: result.orderId,
        reason: result.reason
      });
    }
    notifyN8nWorkflow('PAYMENT_REJECTED', result);
    return res.redirect(303, `/failed?reason=${encodeURIComponent(result.reason)}&orderId=${result.orderId || ''}`);
  }
});

// 4. Order Status Query
app.get('/api/order/:orderId', (req, res) => {
  const order = database.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  res.json(order);
});

// 5. Audit Log (Forensic Triage & Inspection)
app.get('/api/audit-log', (req, res) => {
  res.json(database.getAuditLog(50));
});

// Serve UI pages
app.get('/success', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'success.html'));
});

app.get('/failed', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'failed.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SharePay Zero-Trust Server running at http://localhost:${PORT}`);
});

export { executeVerificationPipeline };
