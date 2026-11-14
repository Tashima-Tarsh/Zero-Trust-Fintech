import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// In-memory storage (replace with database later)
const pendingOrders = new Map();
const usedUTRs = new Set();

// WebSocket connections
const wsClients = new Map();

wss.on('connection', (ws, req) => {
  const orderId = req.url.split('?')[1]?.split('=')[1];
  if (orderId) {
    wsClients.set(orderId, ws);
    ws.on('close', () => wsClients.delete(orderId));
  }
});

// Create order
app.post('/api/create-order', (req, res) => {
  const orderId = 'Order_' + Math.random().toString(36).substr(2, 9);
  const amount = parseFloat((Math.random() * 100 + 100).toFixed(2)); // Challenge amount
  
  const order = {
    id: orderId,
    amount,
    status: 'PENDING',
    createdAt: Date.now(),
    expiresAt: Date.now() + 3 * 60 * 1000
  };
  
  pendingOrders.set(orderId, order);
  
  const upiLink = `upi://pay?pa=${process.env.MERCHANT_UPI_ID}&pn=${process.env.MERCHANT_NAME}&am=${amount}&tn=${orderId}&cu=INR`;
  
  res.json({ orderId, amount, upiLink });
});

// Verify payment
app.post('/api/verify', (req, res) => {
  const { utr, amount, receipt } = req.body;
  
  console.log('Verifying:', { utr, amount });
  
  // Check if UTR already used
  if (usedUTRs.has(utr)) {
    return res.json({ success: false, error: 'UTR_ALREADY_USED' });
  }
  
  // Find matching order
  let matchedOrder = null;
  for (const [orderId, order] of pendingOrders.entries()) {
    if (order.status === 'PENDING' && 
        order.amount === amount && 
        Date.now() < order.expiresAt) {
      matchedOrder = order;
      break;
    }
  }
  
  if (!matchedOrder) {
    return res.json({ success: false, error: 'NO_MATCHING_ORDER' });
  }
  
  // Mark as success
  matchedOrder.status = 'SUCCESS';
  matchedOrder.utr = utr;
  usedUTRs.add(utr);
  
  // Notify browser via WebSocket
  const ws = wsClients.get(matchedOrder.id);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'SUCCESS',
      utr,
      amount
    }));
  }
  
  res.json({ success: true, orderId: matchedOrder.id });
});

// Get order status
app.get('/api/order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (!order) {
    return res.json({ status: 'NOT_FOUND' });
  }
  res.json(order);
});

// Serve success page
app.get('/success', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'success.html'));
});

// Serve failed page
app.get('/failed', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'failed.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
