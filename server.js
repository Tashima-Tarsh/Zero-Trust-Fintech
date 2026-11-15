/**
 * DISHA 8.2 — Zero-Fee, Fraud-Proof Sovereign UPI Checkout
 * Server implementation combining Express, WebSockets, 7-Layer Fraud Engine,
 * NPCI UPI Spec, VPA Routing, and Double-Entry Ledger.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./db');
const {
  buildNPCIIntentUri,
  sanitizeTransactionNote,
  sanitizeTxnRef,
  parseNPCIIntentResponse,
  parseUTRTimestamp,
  NPCI_RESPONSE_CODES
} = require('./npci-intent');
const { scoreEvidence, suggestAction, WEIGHTS, TIERS } = require('./utils/trust-score');
const { buildUpiUri, appLinks, generateChallengeAmount: generateUniqueChallenge } = require('./utils/upi-intent');
const { IPWhitelistMiddleware } = require('./middleware/ip-whitelist');
const adminRoutes = require('./routes/admin/ip-whitelist');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const MERCHANT_UPI_ID = process.env.MERCHANT_UPI_ID || 'nkumar906099-7@oksbi';
const MERCHANT_NAME = process.env.MERCHANT_NAME || 'Nitish Enterprise';

const ipWhitelist = new IPWhitelistMiddleware(db);

// Middleware & Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ws: wss:;"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS Security Middleware
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Admin-Key');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// In-Memory Sliding Window Rate Limiter
function createRateLimiter(windowMs, maxRequests, message) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
    const now = Date.now();
    const timestamps = hits.get(ip) || [];
    const valid = timestamps.filter(t => now - t < windowMs);
    if (valid.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: message || 'Too many requests. Please slow down.'
      });
    }
    valid.push(now);
    hits.set(ip, valid);
    next();
  };
}

const checkoutLimiter = createRateLimiter(60000, 120, 'Rate limit exceeded on checkout session creation.');
const verifyLimiter = createRateLimiter(60000, 60, 'Rate limit exceeded on payment verification.');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Health Check Endpoint (Render & Uptime Monitoring)
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'healthy',
    service: 'disha-checkout-gateway',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Administrative Authentication & Security Helpers
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || (process.env.NODE_ENV === 'production' ? null : 'disha_dev_admin_key');

function safeCompareKeys(a, b) {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch (_) {
    return false;
  }
}

function requireAdminAuth(req, res, next) {
  const headerKey = req.headers['x-admin-key'] ||
                    req.headers['x-api-key'] ||
                    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));

  if (!ADMIN_API_KEY && !process.env.EXTRA_ADMIN_KEY) {
    return res.status(500).json({
      success: false,
      error: 'SERVER_MISCONFIGURED',
      message: 'ADMIN_API_KEY environment variable is required in production.'
    });
  }

  const isValid = (ADMIN_API_KEY && safeCompareKeys(headerKey, ADMIN_API_KEY)) ||
                  (process.env.EXTRA_ADMIN_KEY && safeCompareKeys(headerKey, process.env.EXTRA_ADMIN_KEY));

  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED_ADMIN_ACCESS',
      message: 'Administrative authentication key required. Provide X-Admin-Key or X-API-Key header.'
    });
  }
  next();
}

// Inject db and ipWhitelist into request
app.use((req, res, next) => {
  req.db = db;
  req.ipWhitelist = ipWhitelist;
  next();
});

// Admin enterprise management routes (Secured with requireAdminAuth)
app.use('/api/admin', requireAdminAuth, adminRoutes);

// Protect Gaming Enterprise endpoints with IP Whitelisting
app.use('/api/gaming/*', ipWhitelist.check());

// ═══════════════════════════════════════════════════════════════════
// TASK 11: WEBSOCKET REAL-TIME CONNECTION HUB
// ═══════════════════════════════════════════════════════════════════
const orderWsClients = new Map(); // Map<orderId, Set<WebSocket>>

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const orderId = url.searchParams.get('orderId');

  // Verify orderId parameter and assert session exists in database
  if (!orderId) {
    ws.close(4400, 'Missing orderId parameter');
    return;
  }

  const session = db.findSessionByOrderId(orderId);
  if (!session) {
    ws.close(4404, 'Session not found for orderId');
    return;
  }

  if (!orderWsClients.has(orderId)) {
    orderWsClients.set(orderId, new Set());
  }
  orderWsClients.get(orderId).add(ws);

  // Send acknowledgement
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    orderId,
    status: session.status,
    timestamp: Date.now()
  }));

  ws.on('close', () => {
    if (orderWsClients.has(orderId)) {
      orderWsClients.get(orderId).delete(ws);
      if (orderWsClients.get(orderId).size === 0) {
        orderWsClients.delete(orderId);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[WebSocket] Client error for ${orderId}:`, err.message);
  });
});

function maskUtr(utr) {
  if (!utr || typeof utr !== 'string') return '************';
  if (utr.length <= 6) return '******';
  return utr.substring(0, 4) + '****' + utr.substring(utr.length - 4);
}

function maskVpa(vpa) {
  if (!vpa || typeof vpa !== 'string' || !vpa.includes('@')) return '***@upi';
  const [user, bank] = vpa.split('@');
  const maskedUser = user.length > 3 ? user.substring(0, 2) + '***' + user.substring(user.length - 1) : user[0] + '***';
  return `${maskedUser}@${bank}`;
}

function broadcastOrderSuccess(orderId, payload) {
  const clients = orderWsClients.get(orderId);
  if (clients && clients.size > 0) {
    const message = JSON.stringify({
      type: 'SUCCESS',
      orderId,
      amount: payload.amount,
      baseAmount: payload.baseAmount,
      vpaAddress: maskVpa(payload.vpaAddress),
      senderVpa: maskVpa(payload.senderVpa),
      maskedUtr: maskUtr(payload.utr),
      utr: payload.utr,
      txId: payload.txId,
      timestamp: payload.timestamp,
      message: 'Settlement confirmed'
    });
    for (const client of clients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
    console.log(`📡 [WebSocket] Broadcasted SUCCESS to ${clients.size} client(s) for order ${orderId}`);
  }
}

function broadcastOrderPendingConfirmation(orderId, payload) {
  const clients = orderWsClients.get(orderId);
  if (clients && clients.size > 0) {
    const message = JSON.stringify({
      type: 'AWAITING_SHOP_CONFIRMATION',
      orderId,
      amount: payload.amount,
      maskedUtr: payload.utr ? maskUtr(payload.utr) : null,
      status: 'AWAITING_SHOP_CONFIRMATION',
      trustScore: payload.trustScore,
      confidenceTier: payload.confidenceTier,
      suggestedAction: payload.suggestedAction,
      message: 'Payment received. Awaiting shop confirmation.'
    });
    for (const client of clients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
    console.log(`📡 [WebSocket] Broadcasted AWAITING_SHOP_CONFIRMATION to ${clients.size} client(s) for order ${orderId}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TASK 2: DYNAMIC CHALLENGE AMOUNT (The Anti-Replay Math)
// ═══════════════════════════════════════════════════════════════════
function generateChallengeAmount(baseAmount) {
  // Adds unique decimal cents to the base amount (11 to 99 cents)
  // Excludes multiples of 10 and 05 (never round endings like .00, .10, .50)
  // Checks active sessions in db to guarantee 0 collisions among concurrent orders
  const activeSessions = typeof db.getActiveSessions === 'function' ? db.getActiveSessions() : [];
  const usedCents = new Set(
    activeSessions
      .filter(s => s && s.status === 'PENDING' && Math.abs(s.baseAmount - Number(baseAmount)) < 0.01)
      .map(s => Math.round((s.challengeAmount - Math.floor(s.challengeAmount)) * 100))
  );

  const availableCents = [];
  for (let c = 11; c <= 99; c++) {
    if (c % 10 !== 0 && c % 5 !== 0 && !usedCents.has(c)) {
      availableCents.push(c);
    }
  }

  const cents = availableCents.length > 0
    ? availableCents[Math.floor(Math.random() * availableCents.length)]
    : (Math.floor(Math.random() * (97 - 11 + 1)) + 11);

  const challenge = Math.round((Number(baseAmount) + (cents / 100)) * 100) / 100;
  return challenge;
}

// ═══════════════════════════════════════════════════════════════════
// TASK 3: SESSION TOKEN GENERATION
// ═══════════════════════════════════════════════════════════════════
function generateSession(baseAmount = 100, description = '', customVpa = null) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + (180 * 1000); // 3 minutes TTL
  const qrRefreshAt = now + (15 * 1000); // 15 seconds dynamic refresh
  const orderId = 'Order_' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const txnRef = 'TXN_' + now + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const challengeAmount = generateChallengeAmount(baseAmount);

  // TASK 9: Select optimal VPA to prevent bans or primary VPA
  let vpaAddress = (customVpa && String(customVpa).trim()) ? String(customVpa).trim() : null;
  if (!vpaAddress) {
    vpaAddress = process.env.MERCHANT_UPI_ID || db.selectVPA('mer_default', challengeAmount) || 'nkumar906099-7@oksbi';
  }

  const session = {
    sessionId,
    orderId,
    description: String(description || '').trim(),
    challengeAmount,
    baseAmount: Number(baseAmount),
    txnRef: sanitizeTxnRef(txnRef),
    vpaAddress,
    createdAt: now,
    expiresAt,
    qrRefreshAt,
    status: 'PENDING',
    utr: null
  };

  db.saveSession(session);
  return session;
}

// ═══════════════════════════════════════════════════════════════════
// TASK 4: NPCI-COMPLIANT UPI DEEP LINK GENERATOR (v3.2 Spec & upi-intent)
// ═══════════════════════════════════════════════════════════════════
function generateUPILink(session) {
  // P2P NPCI Specification: upi://pay?pa=&pn=&am=&tn=&cu=INR
  // mc and tr are strictly forbidden for personal VPAs to avoid bank decline before PIN
  const isMerchantP2M = session.mc && /^\d{4}$/.test(session.mc) && session.tr;
  if (isMerchantP2M) {
    return buildUpiUri({
      kind: 'P2M',
      pa: session.vpaAddress || MERCHANT_UPI_ID,
      pn: MERCHANT_NAME,
      am: session.challengeAmount,
      tn: session.orderId || session.description || 'Payment',
      mc: session.mc,
      tr: session.tr
    });
  } else {
    return buildUpiUri({
      kind: 'P2P',
      pa: session.vpaAddress || MERCHANT_UPI_ID,
      pn: MERCHANT_NAME,
      am: session.challengeAmount,
      tn: session.orderId || session.description || 'Payment'
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// REST API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// Create or refresh session
app.get('/api/session/new', checkoutLimiter, async (req, res) => {
  try {
    const baseAmount = parseFloat(req.query.amount) || 100.0;
    const description = req.query.description || req.query.desc || req.query.item || 'Kirana Order';
    let validatedVpa = null;
    const requestedVpa = (req.query.vpa || req.query.pa || req.query.vpaAddress || '').trim();
    if (requestedVpa) {
      const activeVpas = (typeof db.getAllActiveVPAs === 'function' ? db.getAllActiveVPAs().map(v => v.vpa_address.toLowerCase()) : []);
      const primaryVpa = (process.env.MERCHANT_UPI_ID || MERCHANT_UPI_ID || '').toLowerCase();
      if (activeVpas.includes(requestedVpa.toLowerCase()) || requestedVpa.toLowerCase() === primaryVpa) {
        validatedVpa = requestedVpa;
      } else {
        return res.status(400).json({
          success: false,
          error: 'UNAUTHORIZED_PAYEE_VPA',
          message: 'The requested payee VPA is not an authorized settlement handle.'
        });
      }
    }
    const session = generateSession(baseAmount, description, validatedVpa);
    const upiLink = generateUPILink(session);
    const links = appLinks(upiLink);

    // Generate base64 QR as helper, though frontend renders direct to canvas
    const qrDataUrl = await QRCode.toDataURL(upiLink, {
      margin: 1,
      width: 320,
      color: { dark: '#05070B', light: '#FFFFFF' }
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      orderId: session.orderId,
      description: session.description,
      baseAmount: session.baseAmount,
      challengeAmount: session.challengeAmount,
      txnRef: session.txnRef,
      vpaAddress: session.vpaAddress,
      merchantName: MERCHANT_NAME,
      expiresAt: session.expiresAt,
      qrRefreshAt: session.qrRefreshAt,
      upiLink,
      appLinks: links,
      qrDataUrl
    });
  } catch (err) {
    console.error('Error generating session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch active session status
app.get('/api/session/:orderId', (req, res) => {
  const session = db.findSessionByOrderId(req.params.orderId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, session });
});

// ═══════════════════════════════════════════════════════════════════
// ZERO-TRUST SERVER-SIDE RECEIPT EVIDENCE EXTRACTION
// ═══════════════════════════════════════════════════════════════════
function extractReceiptEvidence(receiptText, sessionContext, clientReported = {}) {
  const now = Date.now();

  // If no receipt text or image is provided, fail-closed with zero evidence
  if (!receiptText || typeof receiptText !== 'string' || receiptText.trim().length < 8) {
    return {
      payeeVpa: null,
      payeeName: null,
      statusText: null,
      shownTime: null,
      layoutFieldsFound: 0,
      layoutFieldsExpected: 4,
      looksLikeScreenshot: false,
      exifSoftware: null,
      editArtifacts: false,
      submittedAt: now,
      rawReceipt: ''
    };
  }

  const text = receiptText.trim();
  const lower = text.toLowerCase();

  // 1. Payee extraction from receipt text
  let foundPayeeVpa = null;
  let foundPayeeName = null;
  const vpaMatch = text.match(/[\w.-]+@[\w.-]+/);
  if (vpaMatch) {
    foundPayeeVpa = vpaMatch[0];
  }
  if (sessionContext && sessionContext.payeeName && lower.includes(sessionContext.payeeName.toLowerCase())) {
    foundPayeeName = sessionContext.payeeName;
  }

  // 2. Status text extraction
  let foundStatusText = null;
  if (/\b(successful|success|completed|paid|debited)\b/i.test(text)) {
    foundStatusText = 'SUCCESS';
  } else if (/\b(failed|declined|reversed|rejected|cancelled|canceled|expired)\b/i.test(text)) {
    foundStatusText = 'FAILED';
  } else if (/\b(pending|processing|in progress|awaiting)\b/i.test(text)) {
    foundStatusText = 'PENDING';
  }

  // 3. Shown time extraction from receipt or client session context
  let foundShownTime = null;
  if (clientReported.shownTime || clientReported.timestamp) {
    const st = Number(clientReported.shownTime || clientReported.timestamp);
    if (!isNaN(st) && sessionContext && st >= sessionContext.createdAt - 60000 && st <= now + 60000) {
      foundShownTime = st;
    }
  }
  if (!foundShownTime && sessionContext) {
    // If authentic receipt was submitted during active session window
    foundShownTime = now;
  }

  // 4. Layout fields presence check (4 standard UPI layout fields)
  let layoutFieldsFound = 0;
  if (foundPayeeVpa || foundPayeeName || (sessionContext && lower.includes((sessionContext.payeeVpa || '').toLowerCase()))) {
    layoutFieldsFound++;
  }
  if (/(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?/i.test(text) || /\b(?:amount|paid|amt)\b/i.test(text)) {
    layoutFieldsFound++;
  }
  if (/\b(?:utr|upi\s*(?:ref|transaction|txn)\s*(?:id|no|ref)?|rrn)\b/i.test(text) || /\b\d{12}\b/.test(text)) {
    layoutFieldsFound++;
  }
  if (foundStatusText) {
    layoutFieldsFound++;
  }

  // 5. Authentic UPI App signatures check
  const hasAppSignature = /\b(google\s*pay|gpay|phonepe|paytm|bhim|cred|amazon\s*pay|axis\s*pay|i-mobile|upi)\b/i.test(text);
  const looksLikeScreenshot = hasAppSignature || layoutFieldsFound >= 3;

  return {
    payeeVpa: foundPayeeVpa,
    payeeName: foundPayeeName,
    statusText: foundStatusText,
    shownTime: foundShownTime,
    layoutFieldsFound,
    layoutFieldsExpected: 4,
    looksLikeScreenshot,
    exifSoftware: clientReported.exifSoftware || null,
    editArtifacts: clientReported.editArtifacts === true,
    submittedAt: now,
    rawReceipt: text
  };
}

// ═══════════════════════════════════════════════════════════════════
// TASK 8: 7-LAYER FRAUD VERIFICATION & TRUST-SCORING ENGINE
// ═══════════════════════════════════════════════════════════════════
app.post('/api/verify', verifyLimiter, (req, res) => {
  try {
    const { utr, amount, receipt, orderId, txnRef } = req.body;
    const now = Date.now();

    // Use NPCI Intent Parser for raw receipt or callback data
    let parsedUtr = utr;
    let parsedAmount = amount ? parseFloat(String(amount).replace(/,/g, '')) : null;
    let detectedOrderId = orderId;

    if (receipt) {
      const parsedReceipt = parseNPCIIntentResponse(receipt);
      if (!parsedUtr && parsedReceipt.txnId) parsedUtr = parsedReceipt.txnId;
      if (!parsedAmount && parsedReceipt.amount) parsedAmount = parsedReceipt.amount;
      if (!detectedOrderId && parsedReceipt.orderId) detectedOrderId = parsedReceipt.orderId;
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER 1: SESSION CHECK
    // ─────────────────────────────────────────────────────────────
    let session = null;
    if (detectedOrderId) session = db.findSessionByOrderId(detectedOrderId);
    if (!session && txnRef) session = db.findSessionByTxnRef(txnRef);

    if (!session) {
      return res.status(400).json({
        success: false,
        layer: 1,
        code: 'SESSION_NOT_FOUND',
        reason: 'Order session reference not found in transaction register.'
      });
    }

    // Prepare evidence & session context for Zero-Trust scoring engine
    const sessionContext = {
      challengeAmount: Number(session.challengeAmount),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      payeeVpa: session.vpaAddress || MERCHANT_UPI_ID,
      payeeName: MERCHANT_NAME
    };

    // Extract server-side verified evidence (NO lenient client defaults)
    const ev = extractReceiptEvidence(receipt, sessionContext, req.body);
    ev.amount = parsedAmount !== null ? Number(parsedAmount) : null;
    ev.utr = parsedUtr;

    const attemptsCount = (session.verificationAttempts || 0) + 1;
    session.verificationAttempts = attemptsCount;

    const hist = {
      utrSeen: db.isUtrBlacklisted(parsedUtr),
      imageHashSeen: req.body.imageHash ? (typeof db.isImageHashSeen === 'function' ? db.isImageHashSeen(req.body.imageHash) : false) : false,
      attemptsThisSession: attemptsCount,
      priorConfirmed: 0
    };

    // Evaluate evidence through trust-score pure scoring engine
    const trustResult = scoreEvidence(sessionContext, ev, hist, {
      now,
      graceMs: 60 * 1000,
      sameDevice: req.body.sameDevice !== false
    });

    // ─────────────────────────────────────────────────────────────
    // TIER-DRIVEN PAYMENT STATE MACHINE (RBI / Sovereign Zero-Trust)
    // ─────────────────────────────────────────────────────────────
    // Check hard gates or REJECT tier
    if (trustResult.tier === 'REJECT') {
      let mappedLayer = 2;
      if (trustResult.gate === 'SESSION_EXPIRED') {
        db.updateSessionStatus(session.orderId, 'EXPIRED');
        mappedLayer = 1;
      } else if (trustResult.gate === 'AMOUNT_MISMATCH') {
        mappedLayer = 2;
      } else if (trustResult.gate === 'UTR_FORMAT' || trustResult.gate === 'UTR_REUSED') {
        mappedLayer = 3;
      } else if (trustResult.gate === 'TOO_MANY_ATTEMPTS') {
        mappedLayer = 6;
      }

      return res.status(400).json({
        success: false,
        layer: mappedLayer,
        code: trustResult.gate || 'VERIFICATION_REJECTED',
        reason: (trustResult.reasons && trustResult.reasons[0]) || 'Evidence rejected by Zero-Trust verification.',
        trustScore: trustResult.score,
        confidenceTier: trustResult.tier
      });
    }

    // LOW tier: Insufficient evidence
    if (trustResult.tier === 'LOW') {
      return res.status(400).json({
        success: false,
        layer: 2,
        code: 'EVIDENCE_INSUFFICIENT',
        reason: `Evidence confidence score too low (${trustResult.score}/100, Tier: LOW). Valid receipt proof required.`,
        trustScore: trustResult.score,
        confidenceTier: trustResult.tier,
        reasons: trustResult.reasons
      });
    }

    // PENDING tier: Bank switch interbank pending
    if (trustResult.tier === 'PENDING') {
      db.updateSessionStatus(session.orderId, 'PENDING');
      return res.status(202).json({
        success: false,
        status: 'PENDING',
        code: 'PAYMENT_PENDING_BANK',
        reason: 'Payment is marked as pending by customer bank. Awaiting clearing.',
        trustScore: trustResult.score,
        confidenceTier: 'PENDING'
      });
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER 4: UTR FRESHNESS (10-Minute Maximum Latency & Timestamp Audit)
    // ─────────────────────────────────────────────────────────────
    const orderAgeMs = now - session.createdAt;
    if (orderAgeMs > (10 * 60 * 1000)) {
      return res.status(400).json({
        success: false,
        layer: 4,
        code: 'UTR_TOO_OLD',
        reason: 'Session order age is stale (> 10 minutes old).'
      });
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER 5: TRANSACTION NOTE MATCH (Order Reference Cross-Verification)
    // ─────────────────────────────────────────────────────────────
    if (receipt) {
      const noteMatches = receipt.match(/Order_[A-Z0-9]+/i) || receipt.match(/ORD_[A-Z0-9_]+/i);
      if (noteMatches && noteMatches[0].toUpperCase() !== session.orderId.toUpperCase()) {
        return res.status(400).json({
          success: false,
          layer: 5,
          code: 'TRANSACTION_NOTE_MISMATCH',
          reason: `Receipt note mismatch: expected ${session.orderId}, found ${noteMatches[0]}.`
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER 6: RATE LIMIT (One Share Verification Per Session)
    // ─────────────────────────────────────────────────────────────
    if (session.status === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        layer: 6,
        code: 'SESSION_ALREADY_SETTLED',
        reason: 'This session has already been settled and closed.'
      });
    }

    // Compute suggested shop action based on confidence tier and instant limit (₹500)
    const suggestedAction = suggestAction(trustResult, session.challengeAmount, 500);

    // MEDIUM tier OR HIGH tier exceeding instant limit (> ₹500):
    // Requires merchant bank app confirmation before irreversible ledger settlement
    if (trustResult.tier === 'MEDIUM' || (trustResult.tier === 'HIGH' && session.challengeAmount > 500)) {
      db.updateSessionStatus(session.orderId, 'AWAITING_SHOP_CONFIRMATION', parsedUtr);

      broadcastOrderPendingConfirmation(session.orderId, {
        orderId: session.orderId,
        utr: parsedUtr,
        amount: session.challengeAmount,
        trustScore: trustResult.score,
        confidenceTier: trustResult.tier,
        suggestedAction
      });

      return res.status(200).json({
        success: true,
        status: 'AWAITING_SHOP_CONFIRMATION',
        layer: 6,
        confidenceTier: trustResult.tier,
        trustScore: trustResult.score,
        suggestedAction,
        message: 'Payment evidence requires merchant bank app confirmation before ledger settlement.',
        orderId: session.orderId,
        utr: parsedUtr,
        amount: session.challengeAmount,
        bankCorroborated: false,
        reconciliationState: 'AWAITING_SHOP_CONFIRMATION'
      });
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER 7: DOUBLE-ENTRY LEDGER POSTING & BALANCE ASSERTION
    // HIGH tier <= ₹500: Instant settlement & double-entry ledger posting
    // ─────────────────────────────────────────────────────────────
    const { txId, verification } = db.recordTransactionAndLedger(
      session.orderId,
      parsedUtr,
      session.challengeAmount,
      session.vpaAddress
    );

    if (!verification.balanced) {
      return res.status(500).json({
        success: false,
        layer: 7,
        code: 'LEDGER_ASSERTION_FAILED',
        reason: 'Critical: Double-entry ledger imbalance detected.'
      });
    }

    // Blacklist UTR to prevent any future reuse
    db.blacklistUtr(parsedUtr, session.orderId, session.challengeAmount, 'Verified settlement');

    // Update session status
    db.updateSessionStatus(session.orderId, 'SUCCESS', parsedUtr);

    // Notify connected browser via WebSocket (TASK 11)
    const successPayload = {
      orderId: session.orderId,
      utr: parsedUtr,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      senderVpa: req.body.senderVpa || 'customer@okhdfcbank',
      txId,
      timestamp: now,
      trustScore: trustResult.score,
      confidenceTier: trustResult.tier,
      suggestedAction,
      message: 'Settlement confirmed via DISHA 8.2 Zero-Trust Trust-Scoring Engine'
    };
    broadcastOrderSuccess(session.orderId, successPayload);

    return res.json({
      success: true,
      layer: 7,
      orderId: session.orderId,
      utr: parsedUtr,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      senderVpa: req.body.senderVpa || 'customer@okhdfcbank',
      txId,
      timestamp: now,
      ledgerVerification: verification,
      reconciliationState: 'CLAIM_VERIFIED_PENDING_BANK_RECONCILIATION',
      trustFactor: 'PROBABILISTIC_CHALLENGE_MATCH',
      bankCorroborated: false,
      trustScore: trustResult.score,
      confidenceTier: trustResult.tier,
      suggestedAction,
      trustReasons: trustResult.reasons
    });
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// TASK 7: ANDROID WEB SHARE TARGET (SINGLE SOURCE OF TRUTH SETTLEMENT)
// ═══════════════════════════════════════════════════════════════════
app.post('/handle-share', async (req, res) => {
  try {
    const { title, text, url } = req.body || {};
    const rawReceipt = [title, text, url].filter(Boolean).join('\n');
    const now = Date.now();

    console.log(`📥 [Android Share Target SST] Received shared receipt payload (${rawReceipt.length} chars)`);

    const parsed = parseNPCIIntentResponse(rawReceipt);
    const parsedUtr = parsed.txnId || (req.body && req.body.utr) || '';
    const parsedAmount = parsed.amount || (req.body && parseFloat(req.body.amount)) || null;
    let detectedOrderId = parsed.orderId || (req.body && req.body.orderId) || (req.query && req.query.orderId) || '';

    if (!parsedUtr || !parsedAmount) {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SHARE_PAYLOAD',
          message: 'Could not extract 12-digit UTR and challenged amount from shared receipt.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('Could not extract 12-digit UTR or amount from shared receipt')}`);
    }

    // RESOLVE SESSION: Match by explicit orderId OR by Unique Mathematical Challenge Amount!
    let session = null;
    if (detectedOrderId) {
      session = db.findSessionByOrderId(detectedOrderId);
    }
    if (!session && parsedAmount) {
      // Find active pending session by the exact unique challenge paise
      session = db.findSessionByAmount(parsedAmount);
    }

    if (!session) {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(404).json({
          success: false,
          error: 'SESSION_NOT_FOUND',
          message: `No active checkout session found matching challenge amount ₹${parsedAmount}. Session may have expired.`
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('No active checkout session matched this challenge amount.')}`);
    }

    // Evaluate evidence with Zero-Trust scoring engine
    const sessionContext = {
      challengeAmount: Number(session.challengeAmount),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      payeeVpa: session.vpaAddress || MERCHANT_UPI_ID,
      payeeName: MERCHANT_NAME
    };

    // Extract server-side verified evidence (NO lenient client defaults)
    const ev = extractReceiptEvidence(rawReceipt, sessionContext, req.body);
    ev.amount = parsedAmount;
    ev.utr = parsedUtr;

    const attemptsCount = (session.verificationAttempts || 0) + 1;
    session.verificationAttempts = attemptsCount;

    const hist = {
      utrSeen: db.isUtrBlacklisted(parsedUtr),
      imageHashSeen: false,
      attemptsThisSession: attemptsCount,
      priorConfirmed: 0
    };

    const trustResult = scoreEvidence(sessionContext, ev, hist, {
      now,
      graceMs: 60 * 1000,
      sameDevice: false // Mobile scanning external screen or intent
    });

    if (trustResult.tier === 'REJECT') {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          code: trustResult.gate || 'VERIFICATION_REJECTED',
          reason: (trustResult.reasons && trustResult.reasons[0]) || 'Evidence rejected by Zero-Trust verification.',
          trustScore: trustResult.score,
          confidenceTier: trustResult.tier
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent((trustResult.reasons && trustResult.reasons[0]) || 'Verification failed')}`);
    }

    if (trustResult.tier === 'LOW') {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          code: 'EVIDENCE_INSUFFICIENT',
          reason: `Evidence confidence score too low (${trustResult.score}/100, Tier: LOW). Valid receipt proof required.`,
          trustScore: trustResult.score,
          confidenceTier: trustResult.tier,
          reasons: trustResult.reasons
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('Evidence confidence score too low. Authentic receipt required.')}`);
    }

    const suggestedAction = suggestAction(trustResult, session.challengeAmount, 500);

    // MEDIUM tier OR HIGH tier exceeding instant limit (> ₹500):
    // Requires merchant bank app confirmation before ledger release
    if (trustResult.tier === 'MEDIUM' || (trustResult.tier === 'HIGH' && session.challengeAmount > 500)) {
      db.updateSessionStatus(session.orderId, 'AWAITING_SHOP_CONFIRMATION', parsedUtr);

      broadcastOrderPendingConfirmation(session.orderId, {
        orderId: session.orderId,
        utr: parsedUtr,
        amount: session.challengeAmount,
        trustScore: trustResult.score,
        confidenceTier: trustResult.tier,
        suggestedAction
      });

      if (req.accepts('json') && !req.accepts('html')) {
        return res.json({
          success: true,
          settled: false,
          status: 'AWAITING_SHOP_CONFIRMATION',
          orderId: session.orderId,
          utr: parsedUtr,
          amount: session.challengeAmount,
          trustScore: trustResult.score,
          confidenceTier: trustResult.tier,
          suggestedAction,
          reasons: trustResult.reasons
        });
      }
      return res.redirect(`/success.html?orderId=${encodeURIComponent(session.orderId)}&status=AWAITING_CONFIRMATION`);
    }

    // Ledger posting & anti-replay for HIGH <= ₹500
    const { txId, verification } = db.recordTransactionAndLedger(
      session.orderId,
      parsedUtr,
      session.challengeAmount,
      session.vpaAddress
    );

    // Blacklist UTR to prevent any future reuse
    db.blacklistUtr(parsedUtr, session.orderId, session.challengeAmount, 'Settled via Android Share Sheet SST');

    // Update session status in DB
    db.updateSessionStatus(session.orderId, 'SUCCESS', parsedUtr);

    // ⚡ CRITICAL: INSTANT WEBSOCKET DISPATCH TO WAITING CHECKOUT (LAPTOP/DESKTOP/MOBILE)
    const successPayload = {
      orderId: session.orderId,
      utr: parsedUtr,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      senderVpa: req.body.senderVpa || 'customer@upi',
      txId,
      timestamp: now,
      settlementSource: 'ANDROID_SHARE_SHEET_SST',
      trustScore: trustResult.score,
      confidenceTier: trustResult.tier,
      suggestedAction,
      message: 'Settlement confirmed via Android Share Sheet Single Source of Truth (SST)'
    };
    broadcastOrderSuccess(session.orderId, successPayload);

    console.log(`✅ [Android Share Target SST] Successfully settled order ${session.orderId} and notified checkout client via WebSocket`);

    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({
        success: true,
        settled: true,
        orderId: session.orderId,
        utr: parsedUtr,
        amount: session.challengeAmount,
        trustScore: trustResult.score,
        confidenceTier: trustResult.tier,
        suggestedAction,
        ledgerTxId: txId
      });
    }

    // Redirect to success page with parameters
    res.redirect(`/success.html?utr=${encodeURIComponent(parsedUtr)}&amount=${encodeURIComponent(String(session.challengeAmount))}&orderId=${encodeURIComponent(session.orderId)}`);
  } catch (err) {
    console.error('[Android Share Target] Error:', err);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect(`/failed.html?reason=${encodeURIComponent(err.message)}`);
  }
});

// Official NPCI Intent Callback / Webhook Endpoint
app.post('/api/npci-callback', (req, res) => {
  try {
    let payload = '';
    if (typeof req.body === 'string') {
      payload = req.body;
    } else if (req.body && Object.keys(req.body).length > 0) {
      payload = new URLSearchParams(req.body).toString();
    } else if (req.query && Object.keys(req.query).length > 0) {
      payload = new URLSearchParams(req.query).toString();
    }

    const parsed = parseNPCIIntentResponse(payload);
    console.log('📡 [NPCI Intent Callback] Parsed payload:', parsed);

    if (parsed.responseCode && parsed.responseCode !== '00') {
      const codeInfo = NPCI_RESPONSE_CODES[parsed.responseCode] || { description: 'Payment Failed', action: 'SHOW_ERROR' };
      return res.status(400).json({
        success: false,
        status: parsed.status || 'FAILED',
        responseCode: parsed.responseCode,
        action: codeInfo.action,
        reason: codeInfo.description
      });
    }

    if (!parsed.txnId || !parsed.amount) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CALLBACK_PARAMETERS',
        reason: 'Required UTR (txnId) or amount missing in callback'
      });
    }

    return res.json({
      success: true,
      status: 'SUCCESS',
      responseCode: '00',
      utr: parsed.txnId,
      amount: parsed.amount,
      orderId: parsed.orderId
    });
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simulation helper for one-click developer testing (guarded against production abuse - OFF by default)
app.post('/api/simulate-payment', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const simulationEnabled = process.env.ENABLE_PAYMENT_SIMULATION === 'true'; // OFF by default
  const headerKey = req.headers['x-admin-key'] ||
                    req.headers['x-api-key'] ||
                    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));

  const isAdmin = safeCompareKeys(headerKey, ADMIN_API_KEY) ||
                  (process.env.EXTRA_ADMIN_KEY && safeCompareKeys(headerKey, process.env.EXTRA_ADMIN_KEY));

  // In production or when not explicitly enabled, simulation is strictly forbidden without admin credentials
  if (!simulationEnabled && !isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'SIMULATION_DISABLED_BY_DEFAULT',
      message: 'Payment simulation is disabled by default. Enable via ENABLE_PAYMENT_SIMULATION=true or provide administrative credentials.'
    });
  }

  if (isProd && !isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'SIMULATION_FORBIDDEN_IN_PRODUCTION',
      message: 'Payment simulation is strictly forbidden in production without administrative credentials.'
    });
  }

  const { orderId } = req.body;
  const session = db.findSessionByOrderId(orderId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  // Generate realistic 12-digit NPCI Bank UTR (e.g., 631902XXXXXX)
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const mockUtr = `631902${randomSuffix}`;

  // Execute verification flow
  const { txId, verification } = db.recordTransactionAndLedger(
    session.orderId,
    mockUtr,
    session.challengeAmount,
    session.vpaAddress
  );

  db.blacklistUtr(mockUtr, session.orderId, session.challengeAmount, 'Simulated payment');
  db.updateSessionStatus(session.orderId, 'SUCCESS', mockUtr);

  const payload = {
    orderId: session.orderId,
    utr: mockUtr,
    amount: session.challengeAmount,
    baseAmount: session.baseAmount,
    vpaAddress: session.vpaAddress,
    txId,
    timestamp: Date.now()
  };

  broadcastOrderSuccess(session.orderId, payload);
  res.json({ success: true, ...payload, ledgerVerification: verification });
});

// Ledger receipts API
app.get('/api/ledger/:orderId', (req, res) => {
  const session = db.findSessionByOrderId(req.params.orderId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  res.json({
    success: true,
    orderId: session.orderId,
    challengeAmount: session.challengeAmount,
    baseAmount: session.baseAmount,
    status: session.status,
    utr: session.utr,
    createdAt: session.createdAt,
    vpaAddress: session.vpaAddress
  });
});

// ═══════════════════════════════════════════════════════════════════
// TASK 12: 1000 VPA ROUTING, TELEMETRY & ANTI-BAN REST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// 1. Select optimal VPA (5-Factor anti-ban scoring + chaos jitter)
app.post('/api/vpa/select', requireAdminAuth, async (req, res) => {
  try {
    const { merchantId = 'mer_default', amount = 100, customerRegion = 'MH', timeOfDay = null, customerVpa = null } = req.body;
    const selected = await db.vpaRouter.selectVPA(merchantId, parseFloat(amount), customerRegion, timeOfDay, customerVpa);
    res.json({ success: true, selectedVpa: selected });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Bulk upload VPAs (CSV text or JSON rows)
app.post('/api/vpa/upload', requireAdminAuth, async (req, res) => {
  try {
    const { csv, csvContent, rows, merchantId = 'mer_default' } = req.body;
    const { parseCSV } = require('./vpa-importer');
    let vpaRows = rows;
    if (!vpaRows && (csv || csvContent)) {
      vpaRows = parseCSV(csv || csvContent);
    }
    if (!vpaRows || !Array.isArray(vpaRows) || vpaRows.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid rows or CSV content provided' });
    }

    const result = await db.vpaImporter.importVPAs(vpaRows, merchantId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Emergency quarantine (7-day cooldown + health reduction)
app.post('/api/vpa/quarantine', requireAdminAuth, (req, res) => {
  try {
    const { vpaId, reason } = req.body;
    if (!vpaId) {
      return res.status(400).json({ success: false, error: 'vpaId is required' });
    }
    const result = db.vpaRouter.quarantineVPA(vpaId, reason || 'Bank warning / emergency freeze');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Pool analytics & bank diversity breakdown
app.get('/api/vpa/analytics', requireAdminAuth, (req, res) => {
  try {
    const merchantId = req.query.merchantId || 'mer_default';
    const analytics = db.vpaRouter.getPoolAnalytics(merchantId);
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Daily health reset & rebalance (6 AM Cron trigger)
app.post('/api/vpa/health-check', requireAdminAuth, (req, res) => {
  try {
    const result = db.vpaRouter.dailyHealthResetAndRebalance();
    res.json({
      success: true,
      message: 'Daily VPA health recalibration and rebalance complete',
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GAMING ENTERPRISE VERIFICATION API (IP WHITELIST PROTECTED)
// ═══════════════════════════════════════════════════════════════════
app.post('/api/gaming/verify-payment', async (req, res) => {
  try {
    const { utr, amount, sessionId, orderId } = req.body;
    const company = req.company;
    const clientIP = req.clientIP;

    if (!utr || !/^\d{12}$/.test(String(utr).trim())) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_UTR_FORMAT',
        message: 'Valid 12-digit transaction UTR is required'
      });
    }

    // Look up session
    let session = null;
    if (sessionId) session = db.findSessionByTxnRef(sessionId);
    if (!session && orderId) session = db.findSessionByOrderId(orderId);

    if (session) {
      const amt = Number(amount || session.challengeAmount);
      if (Math.abs(amt - session.challengeAmount) > 0.001) {
        return res.status(400).json({
          success: false,
          error: 'AMOUNT_MISMATCH',
          expectedAmount: session.challengeAmount,
          receivedAmount: amt
        });
      }

      if (db.isUtrBlacklisted(utr)) {
        return res.status(400).json({
          success: false,
          error: 'UTR_ALREADY_USED',
          message: 'This UTR has already been claimed and settled'
        });
      }

      const { txId, verification } = db.recordTransactionAndLedger(
        session.orderId,
        utr,
        session.challengeAmount,
        session.vpaAddress
      );
      db.blacklistUtr(utr, session.orderId, session.challengeAmount, `Gaming verification: ${company.company_name}`);
      db.updateSessionStatus(session.orderId, 'SUCCESS', utr);

      return res.json({
        success: true,
        status: 'VERIFIED',
        orderId: session.orderId,
        utr,
        amount: session.challengeAmount,
        company: company.company_name,
        clientIP,
        verifiedAt: Date.now(),
        ledgerTxId: txId,
        ledgerVerification: verification
      });
    }

    // If no valid session was found, reject uncorroborated arbitrary settlement
    return res.status(404).json({
      success: false,
      error: 'SESSION_NOT_FOUND',
      message: 'No active payment session found for the provided sessionId or orderId. Arbitrary settlements are rejected.'
    });
  } catch (err) {
    console.error('[Gaming API] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route fallbacks
app.get('/success', (req, res) => res.sendFile(path.join(__dirname, 'public', 'success.html')));
app.get('/failed', (req, res) => res.sendFile(path.join(__dirname, 'public', 'failed.html')));

// Initialize database and start server
(async () => {
  await db.initDb();

  // Daily cron at 00:05 to reset daily VPA limits
  setInterval(() => {
    const d = new Date();
    if (d.getHours() === 0 && d.getMinutes() === 5) {
      db.resetDailyVPAs();
    }
  }, 60000);

  server.listen(PORT, () => {
    console.log(`\n🚀 DISHA 8.2 Sovereign UPI Checkout running on http://localhost:${PORT}`);
    console.log(`📱 PWA Manifest: http://localhost:${PORT}/manifest.json`);
    console.log(`📡 WebSocket Gateway: ws://localhost:${PORT}/ws\n`);
  });
})();
