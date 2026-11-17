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
const { clerkMiddleware, getAuth } = require('@clerk/express');
const db = require('./db');
const {
  buildNPCIIntentUri,
  sanitizeTransactionNote,
  sanitizeTxnRef,
  parseNPCIIntentResponse,
  parseUTRTimestamp,
  NPCI_RESPONSE_CODES
} = require('./npci-intent');
const {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  generateRegistrationChallenge,
  generateAuthenticationChallenge,
  registerUser,
  authenticateUser
} = require('@simplewebauthn/server');
const { base64urlToBuffer, bufferToBase64Url } = require('@simplewebauthn/server');
const { scoreEvidence, suggestAction, WEIGHTS, TIERS } = require('./utils/trust-score');
const { buildUpiUri, appLinks, generateChallengeAmount: generateUniqueChallenge } = require('./utils/upi-intent');
const { getClientIP } = require('./utils/ip-utils');
const { IPWhitelistMiddleware } = require('./middleware/ip-whitelist');
const adminRoutes = require('./routes/admin/ip-whitelist');
// disha-cinematic server removed - merchant SaaS deprecated
const app = express();
const CLERK_ENABLED = Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
// Trust proxy only when explicitly opted in (e.g. behind Render/Cloudflare).
// Never on by default: X-Forwarded-For is trivially spoofable otherwise.

// Mathematical time window for verification (pony tail: 15s min, 180s max)
const T_MIN_MS = 15 * 1000;   // 15 seconds minimum - covers 99.7% of legitimate payments
const T_MAX_MS = 180 * 1000;  // 180 seconds maximum - prevents old UTR reuse attacks
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = process.env.PORT || 3000;
const MERCHANT_UPI_ID = process.env.MERCHANT_UPI_ID;
const MERCHANT_NAME = process.env.MERCHANT_NAME || 'Nitish Enterprise';
if (!MERCHANT_UPI_ID && process.env.NODE_ENV === 'production') {
  throw new Error('MERCHANT_UPI_ID environment variable is required in production');
}
const ipWhitelist = new IPWhitelistMiddleware(db);
if (CLERK_ENABLED) {
  app.use(clerkMiddleware({ authorizedParties: ['https://disha8-2.thenitishkr.in'] }));
}
// Middleware & Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    // The checkout is a static HTML application that deliberately includes
    // embedded styles and scripts. Keep third-party sources narrow while
    // permitting those first-party inline assets to render in production.
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://clerk.thenitishkr.in; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://lh3.googleusercontent.com https://lh4.googleusercontent.com; connect-src 'self' ws: wss: https://clerk.thenitishkr.in;"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
// CORS Security Middleware
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Admin-Key');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
// CSRF protection for state-changing requests
// Binds the session token to the request via X-CSRF-Token header
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowedOrigin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS[0] : null;
  // Reject cross-origin state-changing requests without a valid Origin
  if (origin && allowedOrigin && origin !== allowedOrigin) {
    return res.status(403).json({ success: false, error: 'CSRF: invalid origin' });
  }
  // Require X-CSRF-Token matching the session token for authenticated state changes
  const csrfToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  const sessionToken = req.headers['authorization'] || req.query.token || req.body?.token;
  if (sessionToken && csrfToken !== sessionToken) {
    return res.status(403).json({ success: false, error: 'CSRF: token mismatch' });
  }
  next();
});
// Redis-backed sliding window rate limiter (shared across replicas)
// Falls back to per-process Map when Redis is unavailable.
function createRateLimiter(windowMs, maxRequests, message) {
  const fallbackHits = new Map();
  return async (req, res, next) => {
    const ip = getClientIP(req);
    const key = `rl:${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Redis path: sliding window via ZADD + ZREMRANGEBYSCORE + ZCARD
    if (redis) {
      try {
        const multi = redis.multi();
        multi.zadd(key, now.toString(), `${now}:${Math.random()}`);
        multi.zremrangebyscore(key, 0, windowStart);
        multi.zcard(key);
        multi.expire(key, Math.ceil(windowMs / 1000) + 1);
        const results = await multi.exec();
        const count = results[2][1];
        if (count >= maxRequests) {
          return res.status(429).json({
            success: false,
            error: 'RATE_LIMIT_EXCEEDED',
            message: message || 'Too many requests. Please slow down.'
          });
        }
        return next();
      } catch (e) {
        return fallbackLimiter();
      }
    }

    // In-memory fallback with TTL cleanup
    function fallbackLimiter() {
      const timestamps = (fallbackHits.get(ip) || []).filter(t => now - t < windowMs);
      if (timestamps.length >= maxRequests) {
        return res.status(429).json({
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: message || 'Too many requests. Please slow down.'
        });
      }
      timestamps.push(now);
      fallbackHits.set(ip, timestamps);
      // Cleanup expired entries across all IPs to prevent unbounded Map growth
      const cutoff = now - windowMs;
      for (const [k, arr] of fallbackHits.entries()) {
        const filtered = arr.filter(t => t > cutoff);
        if (filtered.length === 0) fallbackHits.delete(k);
        else fallbackHits.set(k, filtered);
      }
      next();
    }
    fallbackLimiter();
  };
}
const checkoutLimiter = createRateLimiter(60000, 120, 'Rate limit exceeded on checkout session creation.');
const verifyLimiter = createRateLimiter(60000, 60, 'Rate limit exceeded on payment verification.');
const shareLimiter = createRateLimiter(60000, 10, 'Rate limit exceeded on receipt sharing.');
// ── Idempotency (Redis-backed, in-memory fallback) ──
let redis;
try {
  if (process.env.REDIS_URL) {
    const IORedis = require('ioredis');
    redis = new IORedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    redis.connect().catch(() => { redis = null; });
  }
} catch (e) { redis = null; }

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const idempotencyCache = new Map(); // fallback: key -> { response, expiresAt }

async function idempotencyMiddleware(req, res, next) {
  const key = req.header('Idempotency-Key');
  if (!key || req.method !== 'POST') return next();
  const cacheKey = `idem:${key}`;
  // Redis path
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        res.status(parsed.status).set(parsed.headers).send(parsed.body);
        return;
      }
      // Capture response
      const originalSend = res.send;
      res.send = function (body) {
        try {
          redis.setex(cacheKey, Math.floor(IDEMPOTENCY_TTL_MS / 1000), JSON.stringify({
            status: res.statusCode,
            headers: res.getHeaders(),
            body: body
          })).catch(() => {});
        } catch (e) { /* ignore */ }
        return originalSend.call(this, body);
      };
      return next();
    } catch (e) { /* fall through to in-memory */ }
  }
  // In-memory fallback
  const entry = idempotencyCache.get(cacheKey);
  if (entry && entry.expiresAt > Date.now()) {
    res.status(entry.response.status).set(entry.response.headers).send(entry.response.body);
    return;
  }
  const originalSend = res.send;
  res.send = function (body) {
    idempotencyCache.set(cacheKey, {
      response: { status: res.statusCode, headers: res.getHeaders(), body: body },
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
    });
    return originalSend.call(this, body);
  };
  next();
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(idempotencyMiddleware);
// 1. Static Assets: Serve PhonePe marketing styles, console styles, scripts, videos, and icons
// One canonical merchant dashboard; checkout and its APIs remain public.
app.get('/merchant-console.html', (req, res) => res.redirect(302, '/dashboard'));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
// 2. Health Check Endpoint (Render & Uptime Monitoring)
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'healthy',
    service: 'disha-unified-platform',
    version: '8.2.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
// Customer-facing product page and checkout routes
app.get(['/', '/home'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get(['/checkout', '/pay'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});
app.get('/auth-config.js', (req, res) => {
  res.type('application/javascript').send(`window.DISHA_CLERK_PUBLISHABLE_KEY=${JSON.stringify(process.env.CLERK_PUBLISHABLE_KEY || '')};`);
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'merchant-login.html'));
});
app.get(['/dashboard', '/payments', '/analytics'], (req, res) => {
  if (!CLERK_ENABLED) return res.redirect('/login');
  const { userId } = getAuth(req);
  if (!userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'merchant-console.html'));
});
// disha-cinematic (merchant SaaS) removed - P2P/P2M routing handled via /api/verify
app.use((req, res, next) => {
  next();
});
// Administrative Authentication & Security Helpers
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
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
// Per-IP WebSocket connection rate limit (prevents orderId scanning / connection
// exhaustion). Keyed by the client IP seen through the trusted-proxy chain when
// TRUST_PROXY is set, otherwise by the direct socket address.
const wsConnectionHits = new Map();
const WS_CONNECTION_WINDOW_MS = 60000;
const WS_MAX_CONNECTIONS = 15;
function wsClientIp(req) {
  if (app.get('trust proxy') && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}
function wsRateLimit(ip) {
  const now = Date.now();
  const cutoff = now - WS_CONNECTION_WINDOW_MS;
  const hits = (wsConnectionHits.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length >= WS_MAX_CONNECTIONS) return false;
  hits.push(now);
  wsConnectionHits.set(ip, hits);
  // Tidy stale buckets
  const keys = Array.from(wsConnectionHits.keys());
  for (const k of keys) {
    const arr = (wsConnectionHits.get(k) || []).filter((t) => t > cutoff);
    if (arr.length === 0) wsConnectionHits.delete(k);
    else wsConnectionHits.set(k, arr);
  }
  return true;
}
wss.on('connection', (ws, req) => {
  const wsIp = wsClientIp(req);
  if (!wsRateLimit(wsIp)) {
    ws.close(4429, 'Too many WebSocket connections. Slow down.');
    return;
  }
  // Validate WebSocket Origin to prevent cross-site WebSocket hijacking
  const wsOrigin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS[0] : null;
  if (wsOrigin && allowedOrigin && wsOrigin !== allowedOrigin) {
    ws.close(4403, 'Invalid origin');
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const orderId = url.searchParams.get('orderId');
  const token = url.searchParams.get('token');
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
  // Bind the WebSocket subscriber to the session so only the order's owner
  // (holder of the sessionId returned by /api/session/new) can receive the
  // settlement broadcast. Prevents orderId enumeration / broadcast leakage.
  if (!token || token !== session.sessionId) {
    ws.close(4401, 'Invalid or missing session token');
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
      maskedUtr: maskUtr(payload.utr),
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
// ════════════════════════════════════════════════════════════════════
// TASK 3: SESSION TOKEN GENERATION
// ═══════════════════════════════════════════════════════════════════
function generateSession(baseAmount = 100, description = '', customVpa = null) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + (180 * 1000); // 3 minutes TTL
  const qrRefreshAt = now + (15 * 1000); // 15 seconds dynamic refresh
  const orderId = 'Order_' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const txnRef = 'TXN_' + now + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  let challengeAmount = Number(baseAmount); // replaced below by the unique-paise amount
  // TASK 9: Select optimal VPA to prevent bans or primary VPA
  let vpaAddress = (customVpa && String(customVpa).trim()) ? String(customVpa).trim() : null;
  let merchantType = 'P2P';
  let vpaMcc = null;
  if (!vpaAddress) {
    let route = null;
    try {
      route = db.selectVPARoute('mer_default', challengeAmount);
    } catch (e) {
      route = null;
    }
    const routeObj = route || {};
    vpaAddress = routeObj.vpaAddress || process.env.MERCHANT_UPI_ID || 'merchant@upi';
    merchantType = routeObj.merchantType || 'P2P';
    vpaMcc = routeObj.mcc || null;
  } else {
    const mt = db.getVpaMerchantType(vpaAddress);
    merchantType = mt.accountType;
    vpaMcc = mt.mcc;
  }
  // Unique-paise challenge: avoid amounts held by live sessions on the same VPA.
  // Retry on constraint collision so concurrent requests never land the same amount.
  let saved = false;
  let lastErr = null;
  let session = null;
  for (let attempt = 0; attempt < 10 && !saved; attempt++) {
    const activeAmounts = new Set();
    try {
      const rows = db.sqliteDb.prepare(
        "SELECT challenge_amount FROM sessions WHERE status = 'PENDING' AND expires_at >= ? AND vpa_address = ?"
      ).all(Date.now(), vpaAddress);
      for (const r of rows) activeAmounts.add(Number(Number(r.challenge_amount).toFixed(2)));
    } catch (e) { /* db without sqlite: fall back to empty set */ }
    challengeAmount = generateUniqueChallenge(Number(baseAmount), activeAmounts);
    session = {
      sessionId,
      orderId,
      description: String(description || '').trim(),
      challengeAmount,
      baseAmount: Number(baseAmount),
      txnRef: sanitizeTxnRef(txnRef),
      vpaAddress,
      merchantType,
      mcc: vpaMcc,
      createdAt: now,
      expiresAt,
      qrRefreshAt,
      status: 'PENDING',
      state: 'WAITING',
      utr: null
    };
    try {
      db.saveSession(session);
      saved = true;
    } catch (e) {
      lastErr = e;
      if (attempt >= 9) throw e;
    }
  }
  return session;
}
// ═══════════════════════════════════════════════════════════════════
// TASK 4: NPCI-COMPLIANT UPI DEEP LINK GENERATOR (v3.2 Spec & upi-intent)
// ═══════════════════════════════════════════════════════════════════
function generateUPILink(session) {
  // P2P NPCI Specification: upi://pay?pa=&pn=&am=&tn=&cu=INR
  // mc and tr are strictly forbidden for personal VPAs to avoid bank decline before PIN
  const isMerchantP2M = session.merchantType === 'MERCHANT' && session.mcc && /^\d{4}$/.test(session.mcc) && session.mcc !== '0000';
  if (isMerchantP2M) {
    return buildUpiUri({
      kind: 'P2M',
      pa: session.vpaAddress || MERCHANT_UPI_ID,
      pn: MERCHANT_NAME,
      am: session.challengeAmount,
      tn: session.orderId || session.description || 'Payment',
      mc: session.mcc,
      tr: String(session.txnRef || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 35)
    });
  } else {
    if (session.mcc && /^\d{4}$/.test(session.mcc)) {
      console.warn(`[UPI Link] Stripping merchant MCC ${session.mcc} from personal VPA ${session.vpaAddress} to prevent pre-PIN bank decline`);
    }
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
    const baseAmountRaw = parseFloat(req.query.amount);
    if (!Number.isFinite(baseAmountRaw) || baseAmountRaw <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_AMOUNT',
        message: 'Amount must be a positive number.'
      });
    }
    const baseAmount = baseAmountRaw;
    const description = req.query.description || req.query.desc || req.query.item || 'Secure UPI payment';
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
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});
// Fetch active session status
app.get('/api/session/:orderId', (req, res) => {
  const session = db.findSessionByOrderId(req.params.orderId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  // Bind read access to the session owner (holder of sessionId from /api/session/new).
  const token = req.query.token;
  if (!token || token !== session.sessionId) {
    return res.status(401).json({ success: false, error: 'SESSION_TOKEN_REQUIRED' });
  }
  res.json({ success: true, session });
});

// Order state polling endpoint for checkout page (mathematical time window: 15s-180s)
app.get('/api/order-state/:orderId', (req, res) => {
  const state = db.getOrderState(req.params.orderId);
  if (!state) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  res.json({ success: true, ...state });
});
// ═══════════════════════════════════════════════════════════════════
// ZERO-TRUST SERVER-SIDE RECEIPT EVIDENCE EXTRACTION
// ═══════════════════════════════════════════════════════════════════
function extractReceiptEvidence(receiptText, sessionContext) {
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
  // Shown time is never accepted from the client; authentic receipts carry
  // their own time and this parser does not extract it from image text.
  foundShownTime = null;
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
    exifSoftware: null,
    editArtifacts: false,
    submittedAt: now,
    rawReceipt: text
  };
}
// ═══════════════════════════════════════════════════════════════════
// TASK 8: 7-LAYER FRAUD VERIFICATION & TRUST-SCORING ENGINE
// ═══════════════════════════════════════════════════════════════════
app.post('/api/verify', verifyLimiter, async (req, res) => {
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

    const bindingResult = db.bindUtrToOrder(parsedUtr, session.orderId);
    if (bindingResult === 'BOUND_TO_OTHER_ORDER') {
      db.updateSessionState(session.orderId, 'REJECTED');
      return res.status(400).json({
        success: false,
        state: 'REJECTED',
        layer: 4,
        code: 'UTR_BOUND_TO_OTHER_ORDER',
        reason: 'This UTR was already submitted for a different order. Cross-order UTR reuse is impossible.'
      });
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER 1.5: TIME WINDOW CHECK (Mathematical: 15s min, 180s max)
    // ─────────────────────────────────────────────────────────────
    const timeElapsedMs = now - session.createdAt;

    // State 1: Too early (0 < t < 15s)
    if (timeElapsedMs < T_MIN_MS) {
      db.updateSessionState(session.orderId, 'WAITING');
      return res.status(200).json({
        success: true,
        state: 'WAITING',
        orderId: session.orderId,
        timeRemaining: (T_MIN_MS - timeElapsedMs) / 1000,
        message: `Please wait ${Math.ceil((T_MIN_MS - timeElapsedMs) / 1000)}s before verification`
      });
    }

    // State 4: Too late (t > 180s)
    if (timeElapsedMs > T_MAX_MS) {
      db.updateSessionState(session.orderId, 'EXPIRED');
      db.updateSessionStatus(session.orderId, 'EXPIRED');
      return res.status(400).json({
        success: false,
        state: 'EXPIRED',
        orderId: session.orderId,
        code: 'ORDER_EXPIRED',
        reason: 'Order timeout (>3 minutes). Please create a new order.'
      });
    }

    // State 2: Verification window (15s <= t <= 180s)
    db.updateSessionState(session.orderId, 'VERIFY_WINDOW');

    // Prepare evidence & session context for Zero-Trust scoring engine
    const sessionContext = {
      challengeAmount: Number(session.challengeAmount),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      payeeVpa: session.vpaAddress || MERCHANT_UPI_ID,
      payeeName: MERCHANT_NAME,
      customerId: session.customerId
    };
    // Extract server-side verified evidence (NO lenient client defaults)
    const ev = extractReceiptEvidence(receipt, sessionContext);
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
    // ────────────────────────────────────────────────────────────────
    // LAYER 4: CUSTOMER / ORDER IDENTITY BINDING (Cross-Order UTR Reuse Prevention)
    // A UTR is bound to the FIRST order it is submitted for. It can NEVER be used
    // on a different order, even if the amount matches exactly.
    // ───────────────────────────────────────────────────────────
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
        reason: (trustResult.reasons && trustResult.reasons[0]) || 'Evidence rejected by Zero-Trust verification.'
      });
    }
    // LOW tier: Insufficient evidence
    if (trustResult.tier === 'LOW') {
      return res.status(400).json({
        success: false,
        layer: 2,
        code: 'EVIDENCE_INSUFFICIENT',
        reason: 'Evidence confidence score too low. Valid receipt proof required.'
      });
    }
    // ─────────────────────────────────────────────────────────────
    // LAYER 4: UTR FRESHNESS (10-Minute Maximum Latency & Timestamp Audit)
    // ─────────────────────────────────────────────────────────────
    const orderAgeMs = now - session.createdAt;
    if (orderAgeMs > T_MAX_MS) {
      db.updateSessionState(session.orderId, 'EXPIRED');
      db.updateSessionStatus(session.orderId, 'EXPIRED');
      return res.status(400).json({
        success: false,
        state: 'EXPIRED',
        layer: 4,
        code: 'UTR_TOO_OLD',
        reason: 'Session order age is stale (>3 minutes old).'
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
    // Only HIGH tier settles instantly; MEDIUM/LOW/PENDING/REJECT are rejected
    if (trustResult.tier !== 'HIGH') {
      return res.status(400).json({
        success: false,
        layer: 6,
        code: 'CONFIDENCE_INSUFFICIENT',
        reason: 'Instant settlement requires HIGH confidence tier.'
      });
    }
    // ─────────────────────────────────────────────────────────────
    // LAYER 7: DOUBLE-ENTRY LEDGER POSTING & BALANCE ASSERTION
    // HIGH tier: Instant settlement & double-entry ledger posting
    // ─────────────────────────────────────────────────────────────
    const { txId, verification } = await db.atomicSettle(
      session.orderId,
      parsedUtr,
      session.challengeAmount,
      session.vpaAddress,
      req.body.imageHash || null
    );
    if (!verification.balanced) {
      return res.status(500).json({
        success: false,
        layer: 7,
        code: 'LEDGER_ASSERTION_FAILED',
        reason: 'Critical: Double-entry ledger imbalance detected.'
      });
    }
    // Update session status
    db.updateSessionStatus(session.orderId, 'SUCCESS', parsedUtr);
    db.updateSessionState(session.orderId, 'VERIFIED');
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
      message: 'Settlement confirmed via DISHA Zero-Trust Verification'
    };
    broadcastOrderSuccess(session.orderId, successPayload);
    return res.json({
      success: true,
      state: 'VERIFIED',
      layer: 7,
      orderId: session.orderId,
      utr: parsedUtr,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      senderVpa: req.body.senderVpa || 'customer@okhdfcbank',
      txId,
      successToken: txId,
      timestamp: now,
      ledgerVerification: verification,
      reconciliationState: 'CLAIM_VERIFIED_PENDING_BANK_RECONCILIATION'
    });
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// ═══════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// TASK 12: CFC — CONFIRM FROM CUSTOMER (UTR-ONLY SETTLEMENT)
// Customer copies the 12-digit UTR from their UPI app SMS/push and clicks CFC.
// Server validates UTR format, anti-reuse (bindUtrToOrder catches UTR already
// used on another order = "paid friend" fraud), time window, then settles at
// the session challenge amount. No bank API needed.
// ════════════════════════════════════════════════════════════════════
app.post('/api/verify-cfc', verifyLimiter, async (req, res) => {
  try {
    const { utr, orderId, token } = req.body || {};
    const now = Date.now();
    if (!utr || !orderId || !token) {
      return res.status(400).json({
        success: false,
        error: 'CFC_REQUIRED_FIELDS',
        reason: 'UTR, orderId and session token are required.'
      });
    }
    const cleanUtr = String(utr).replace(/\D/g, '');
    if (!/^\d{12}$/.test(cleanUtr)) {
      return res.status(400).json({
        success: false,
        error: 'UTR_FORMAT',
        reason: 'UTR must be exactly 12 numeric digits.'
      });
    }
    const session = db.findSessionByOrderId(orderId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        reason: 'No active checkout session for this order ID.'
      });
    }
    if (token !== session.sessionId) {
      return res.status(401).json({
        success: false,
        error: 'SESSION_TOKEN_REQUIRED',
        reason: 'Invalid or missing session token.'
      });
    }
    if (session.status === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_ALREADY_SETTLED',
        reason: 'This session has already been settled.'
      });
    }
    const timeElapsedMs = now - session.createdAt;
    if (timeElapsedMs < T_MIN_MS) {
      return res.status(200).json({
        success: true,
        state: 'WAITING',
        orderId: session.orderId,
        timeRemaining: (T_MIN_MS - timeElapsedMs) / 1000,
        message: `Please wait ${Math.ceil((T_MIN_MS - timeElapsedMs) / 1000)}s before CFC verification`
      });
    }
    if (timeElapsedMs > T_MAX_MS) {
      db.updateSessionStatus(session.orderId, 'EXPIRED');
      db.updateSessionState(session.orderId, 'EXPIRED');
      return res.status(400).json({
        success: false,
        state: 'EXPIRED',
        error: 'ORDER_EXPIRED',
        reason: 'Order timeout (>3 minutes). Please create a new order.'
      });
    }
    const bindingResult = db.bindUtrToOrder(cleanUtr, session.orderId);
    if (bindingResult === 'BOUND_TO_OTHER_ORDER') {
      db.updateSessionState(session.orderId, 'REJECTED');
      return res.status(400).json({
        success: false,
        state: 'REJECTED',
        error: 'UTR_BOUND_TO_OTHER_ORDER',
        reason: 'This UTR was already used for a different order. Cross-order UTR reuse is impossible.'
      });
    }
    if (bindingResult === false) {
      return res.status(400).json({
        success: false,
        error: 'UTR_BIND_FAILED',
        reason: 'Could not bind UTR to order. Please try again.'
      });
    }
    db.updateSessionState(session.orderId, 'VERIFY_WINDOW');
    const { txId, verification } = await db.atomicSettle(
      session.orderId,
      cleanUtr,
      session.challengeAmount,
      session.vpaAddress,
      null
    );
    db.updateSessionStatus(session.orderId, 'SUCCESS', cleanUtr);
    db.updateSessionState(session.orderId, 'VERIFIED');
    const successPayload = {
      orderId: session.orderId,
      utr: cleanUtr,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      senderVpa: req.body.senderVpa || 'customer@upi',
      txId,
      timestamp: now,
      settlementSource: 'CFC_UTR_ONLY',
      message: 'Settlement confirmed via CFC (Confirm from Customer)'
    };
    broadcastOrderSuccess(session.orderId, successPayload);
    return res.json({
      success: true,
      state: 'VERIFIED',
      orderId: session.orderId,
      utr: cleanUtr,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      txId,
      successToken: txId,
      timestamp: now,
      ledgerVerification: verification,
      reconciliationState: 'CLAIM_VERIFIED_PENDING_BANK_RECONCILIATION'
    });
  } catch (err) {
    console.error('CFC verification error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// ═════════════════════════════════════════════════════════════════════
// TASK 13: WEBAUTHN / PASSKEYS — HARDWARE VAULT AUTHENTICATION
// Android Titan M2 / Apple Secure Enclave via W3C WebAuthn standard
// ═════════════════════════════════════════════════════════════════════
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = 'DISHA 8.2 Checkout';
const RP_ORIGIN = process.env.WEBAUTHN_RP_ORIGIN || 'http://localhost:3000';

// In-memory challenge store (use Redis/DB in production)
const authChallenges = new Map(); // sessionId -> { challenge, orderId, amount, expiresAt }

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// ── WebAuthn Registration: Start ──
app.post('/api/webauthn/register/start', async (req, res) => {
  try {
    const { userId, userName, orderId } = req.body || {};
    if (!userId || !userName) {
      return res.status(400).json({ success: false, error: 'userId and userName required' });
    }

    // Check if user already has passkeys
    const existingKeys = db.findPasskeysByUserId(userId);

    const challenge = generateRegistrationChallenge({
      rpName: RP_NAME,
      rpId: RP_ID,
      user: {
        id: Buffer.from(userId, 'utf8'),
        name: userName,
        displayName: userName
      },
      credentials: existingKeys.map(k => ({
        id: base64urlToBuffer(k.credential_id),
        publicKey: base64urlToBuffer(k.public_key),
        transports: k.transports ? JSON.parse(k.transports) : undefined
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      }
    });

    // Store challenge temporarily
    authChallenges.set(challenge.sessionId, {
      type: 'registration',
      userId,
      userName,
      orderId: orderId || null,
      challenge: challenge.challenge,
      expiresAt: Date.now() + 60 * 1000
    });

    res.json({
      sessionId: challenge.sessionId,
      challenge: challenge.publicKey.challenge,
      rpName: RP_NAME,
      rpId: RP_ID,
      user: {
        id: Buffer.from(userId, 'utf8').toString('base64url'),
        name: userName,
        displayName: userName
      },
      publicKey: challenge.publicKey
    });
  } catch (err) {
    console.error('WebAuthn register start error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── WebAuthn Registration: Finish ──
app.post('/api/webauthn/register/finish', async (req, res) => {
  try {
    const { sessionId, credential } = req.body || {};
    if (!sessionId || !credential) {
      return res.status(400).json({ success: false, error: 'sessionId and credential required' });
    }

    const stored = authChallenges.get(sessionId);
    if (!stored || stored.type !== 'registration') {
      return res.status(400).json({ success: false, error: 'Invalid or expired session' });
    }
    if (Date.now() > stored.expiresAt) {
      authChallenges.delete(sessionId);
      return res.status(400).json({ success: false, error: 'Session expired' });
    }

    const verification = await verifyRegistrationResponse({
      credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPId: RP_ID,
      requireUserVerification: true
    });

    if (verification.verified) {
      const { credentialPublicKey, credentialId, counter } = verification.registrationInfo;
      const result = db.savePasskey(
        stored.userId,
        bufferToBase64Url(credentialId),
        bufferToBase64Url(credentialPublicKey),
        counter,
        'platform',
        1,
        JSON.stringify(['internal'])
      );

      authChallenges.delete(sessionId);

      return res.json({
        success: true,
        message: 'Passkey registered successfully',
        credentialId: bufferToBase64Url(credentialId),
        userId: stored.userId,
        orderId: stored.orderId
      });
    }

    authChallenges.delete(sessionId);
    return res.status(401).json({ success: false, error: 'Registration verification failed' });
  } catch (err) {
    console.error('WebAuthn register finish error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── WebAuthn Authentication: Start ──
app.post('/api/webauthn/authenticate/start', async (req, res) => {
  try {
    const { userId, orderId, amount } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ success: false, error: 'userId and orderId required' });
    }

    const existingKeys = db.findPasskeysByUserId(userId);
    if (!existingKeys || existingKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No passkey registered for this user. Register first.',
        needsRegistration: true
      });
    }

    const challenge = generateAuthenticationChallenge({
      rpId: RP_ID,
      allowCredentials: existingKeys.map(k => ({
        id: base64urlToBuffer(k.credential_id),
        transports: k.transports ? JSON.parse(k.transports) : undefined
      })),
      userVerification: 'required'
    });

    const sessionId = generateSessionId();
    authChallenges.set(sessionId, {
      type: 'authentication',
      userId,
      orderId,
      amount: amount || 0,
      challenge: challenge.challenge,
      expiresAt: Date.now() + 60 * 1000
    });

    res.json({
      sessionId,
      challenge: challenge.publicKey.challenge,
      rpId: RP_ID,
      allowCredentials: challenge.publicKey.allowCredentials
    });
  } catch (err) {
    console.error('WebAuthn authenticate start error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── WebAuthn Authentication: Finish ──
app.post('/api/webauthn/authenticate/finish', async (req, res) => {
  try {
    const { sessionId, credential } = req.body || {};
    if (!sessionId || !credential) {
      return res.status(400).json({ success: false, error: 'sessionId and credential required' });
    }

    const stored = authChallenges.get(sessionId);
    if (!stored || stored.type !== 'authentication') {
      return res.status(400).json({ success: false, error: 'Invalid or expired session' });
    }
    if (Date.now() > stored.expiresAt) {
      authChallenges.delete(sessionId);
      return res.status(400).json({ success: false, error: 'Session expired' });
    }

    const existingKey = db.findPasskeyByCredentialId(credential.rawId);
    if (!existingKey) {
      return res.status(401).json({ success: false, error: 'Unknown credential' });
    }

    const verification = await verifyAuthenticationResponse({
      credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPId: RP_ID,
      authenticator: {
        credentialPublicKey: base64urlToBuffer(existingKey.public_key),
        credentialId: base64urlToBuffer(existingKey.credential_id),
        counter: existingKey.sign_count || 0,
        transports: existingKey.transports ? JSON.parse(existingKey.transports) : undefined
      },
      requireUserVerification: true
    });

    if (verification.verified) {
      db.updatePasskeyCounter(existingKey.credential_id, verification.newCounter || 0);

      // Mark session as vault-verified
      authChallenges.set(sessionId, {
        ...stored,
        status: 'VAULT_VERIFIED_AWAITING_UPI',
        verifiedAt: Date.now()
      });

      return res.json({
        success: true,
        sessionId,
        orderId: stored.orderId,
        amount: stored.amount,
        message: 'Hardware vault verified. Order locked. Proceed to UPI.'
      });
    }

    authChallenges.delete(sessionId);
    return res.status(401).json({ success: false, error: 'Vault signature rejected' });
  } catch (err) {
    console.error('WebAuthn authenticate finish error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── Finalize UPI Settlement (after vault verification) ──
app.post('/api/checkout/finalize-upi', verifyLimiter, async (req, res) => {
  try {
    const { sessionId, orderId, txnRef } = req.body || {};
    if (!sessionId || !orderId || !txnRef) {
      return res.status(400).json({ success: false, error: 'sessionId, orderId, txnRef required' });
    }

    const stored = authChallenges.get(sessionId);
    if (!stored || stored.orderId !== orderId) {
      return res.status(400).json({ success: false, error: 'Invalid session or Order ID mismatch' });
    }
    if (stored.status !== 'VAULT_VERIFIED_AWAITING_UPI') {
      return res.status(403).json({
        success: false,
        error: 'ORDER_NOT_VAULT_VERIFIED',
        message: 'Order was not authorized by the hardware vault.'
      });
    }

    // Find the checkout session
    const session = db.findSessionByOrderId(orderId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });
    }

    // Anti-reuse: bind UTR to this order
    const bindingResult = db.bindUtrToOrder(txnRef, orderId);
    if (bindingResult === 'BOUND_TO_OTHER_ORDER') {
      db.updateSessionState(orderId, 'REJECTED');
      return res.status(400).json({
        success: false,
        error: 'UTR_BOUND_TO_OTHER_ORDER',
        reason: 'This UTR was already used for a different order.'
      });
    }

    // Settle via atomic ledger
    db.updateSessionState(orderId, 'VERIFY_WINDOW');
    const { txId, verification } = await db.atomicSettle(
      orderId,
      txnRef,
      session.challengeAmount,
      session.vpaAddress,
      null
    );
    db.updateSessionStatus(orderId, 'SUCCESS', txnRef);
    db.updateSessionState(orderId, 'VERIFIED');

    const successPayload = {
      orderId,
      utr: txnRef,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      senderVpa: 'customer@upi',
      txId,
      timestamp: Date.now(),
      settlementSource: 'WEBAUTHN_UPI',
      message: 'Settlement confirmed via WebAuthn + UPI'
    };
    broadcastOrderSuccess(orderId, successPayload);

    authChallenges.delete(sessionId);

    return res.json({
      success: true,
      settled: true,
      orderId,
      utr: txnRef,
      amount: session.challengeAmount,
      baseAmount: session.baseAmount,
      vpaAddress: session.vpaAddress,
      txId,
      timestamp: Date.now(),
      ledgerVerification: verification,
      reconciliationState: 'CLAIM_VERIFIED_PENDING_BANK_RECONCILIATION'
    });
  } catch (err) {
    console.error('Finalize UPI error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// ═════════════════════════════════════════════════════════════════════

// TASK 7: ANDROID WEB SHARE TARGET (SINGLE SOURCE OF TRUTH SETTLEMENT)
// ═══════════════════════════════════════════════════════════════════
app.post('/handle-share', shareLimiter, async (req, res) => {
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
    // RESOLVE SESSION: require an explicit orderId (from receipt text, body,
    // or query). Amount-based resolution is removed because it lets anyone who
    // knows or guesses the challenge paise claim another customer's live
    // pending session.
    let session = null;
    const clientIp = req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
    if (detectedOrderId) {
      session = db.findSessionByOrderId(detectedOrderId);
    }
    if (!session) {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(404).json({
          success: false,
          error: 'SESSION_NOT_FOUND',
          message: 'No active checkout session found for this order ID. Share the receipt from the checkout page so the order ID is included.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('No active checkout session matched this order.')}`);
    }
    // Evaluate evidence with Zero-Trust scoring engine
    const sessionContext = {
      challengeAmount: Number(session.challengeAmount),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      payeeVpa: session.vpaAddress || MERCHANT_UPI_ID,
      payeeName: MERCHANT_NAME,
      customerId: session.customerId
    };
    // Time window check for share flow
    const shareTimeElapsedMs = now - session.createdAt;
    if (shareTimeElapsedMs < T_MIN_MS) {
      db.updateSessionState(session.orderId, 'WAITING');
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(200).json({
          success: true,
          state: 'WAITING',
          orderId: session.orderId,
          timeRemaining: (T_MIN_MS - shareTimeElapsedMs) / 1000,
          message: `Please wait ${Math.ceil((T_MIN_MS - shareTimeElapsedMs) / 1000)}s before verification`
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('Please wait before verifying payment')}`);
    }
    if (shareTimeElapsedMs > T_MAX_MS) {
      db.updateSessionState(session.orderId, 'EXPIRED');
      db.updateSessionStatus(session.orderId, 'EXPIRED');
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          state: 'EXPIRED',
          orderId: session.orderId,
          code: 'ORDER_EXPIRED',
          reason: 'Order timeout (>3 minutes). Please create a new order.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('Order timeout (>3 minutes)')}`);
    }
    db.updateSessionState(session.orderId, 'VERIFY_WINDOW');
    // Extract server-side verified evidence (NO lenient client defaults)
    const ev = extractReceiptEvidence(rawReceipt, sessionContext);
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
    // ────────────────────────────────────────────────────────────
    // LAYER 4: CUSTOMER / ORDER IDENTITY BINDING (Cross-Order UTR Reuse Prevention)
    // ───────────────────────────────────────────────────────────
    const bindingResult = db.bindUtrToOrder(parsedUtr, session.orderId);
    if (bindingResult === 'BOUND_TO_OTHER_ORDER') {
      db.updateSessionState(session.orderId, 'REJECTED');
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          state: 'REJECTED',
          layer: 4,
          code: 'UTR_BOUND_TO_OTHER_ORDER',
          reason: 'This UTR was already submitted for a different order. Cross-order UTR reuse is impossible.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('This UTR was already used for a different order. Cross-order reuse is impossible.')}`);
    }
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
          reason: (trustResult.reasons && trustResult.reasons[0]) || 'Evidence rejected by Zero-Trust verification.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent((trustResult.reasons && trustResult.reasons[0]) || 'Verification failed')}`);
    }
    if (trustResult.tier === 'LOW') {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          code: 'EVIDENCE_INSUFFICIENT',
          reason: 'Evidence confidence score too low. Authentic receipt required.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('Evidence confidence score too low. Authentic receipt required.')}`);
    }
    // FULLY AUTOMATED: only HIGH confidence tier settles instantly.
    if (trustResult.tier !== 'HIGH') {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({
          success: false,
          code: 'EVIDENCE_INSUFFICIENT',
          reason: 'Automated settlement requires HIGH confidence tier.'
        });
      }
      return res.redirect(`/failed.html?reason=${encodeURIComponent('Automated settlement requires HIGH confidence tier.')}`);
    }
    // Ledger posting & anti-replay — instant settlement (DISHA never holds funds)
    const { txId, verification } = await db.atomicSettle(
      session.orderId,
      parsedUtr,
      session.challengeAmount,
      session.vpaAddress,
      req.body.imageHash || null
    );
    // Update session status in DB
    db.updateSessionStatus(session.orderId, 'SUCCESS', parsedUtr);
    db.updateSessionState(session.orderId, 'VERIFIED');
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
      message: 'Settlement confirmed via Android Share Sheet Single Source of Truth (SST)'
    };
    broadcastOrderSuccess(session.orderId, successPayload);
    console.log(`✅ [Android Share Target SST] Successfully settled order ${session.orderId} and notified checkout client via WebSocket`);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({
        success: true,
        state: 'VERIFIED',
        settled: true,
        orderId: session.orderId,
        utr: parsedUtr,
        amount: session.challengeAmount,
        ledgerTxId: txId,
        successToken: txId
      });
    }
    // Redirect to success page without exposing UTR in URL
    res.redirect(`/success.html?token=${encodeURIComponent(txId)}&order_id=${encodeURIComponent(session.orderId)}`);
  } catch (err) {
    console.error('[Android Share Target] Error:', err);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
    }
    res.redirect('/failed.html?reason=verification_error');
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
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// Simulation helper for one-click developer testing (guarded against production abuse - OFF by default)
app.post('/api/simulate-payment', async (req, res) => {
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
  // Generate realistic 12-digit NPCI Bank UTR (cryptographically random suffix)
  const randomSuffix = crypto.randomInt(100000, 999999);
  const mockUtr = `631902${randomSuffix}`;
  // Execute verification flow
  const { txId, verification } = await db.recordTransactionAndLedger(
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
  // Ledger exposes merchant VPA; bind read access to the session owner.
  const token = req.query.token;
  if (!token || token !== session.sessionId) {
    return res.status(401).json({ success: false, error: 'SESSION_TOKEN_REQUIRED' });
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
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
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
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
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
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// 4. Pool analytics & bank diversity breakdown
app.get('/api/vpa/analytics', requireAdminAuth, (req, res) => {
  try {
    const merchantId = req.query.merchantId || 'mer_default';
    const analytics = db.vpaRouter.getPoolAnalytics(merchantId);
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
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
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
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
      const { txId, verification } = await db.recordTransactionAndLedger(
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
    // If explicit session or order ID was provided but not found
    if (sessionId || orderId) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'No active payment session found for the provided sessionId or orderId.'
      });
    }
    // Direct enterprise settlement for authorized IP-whitelisted gaming partners
    if (db.isUtrBlacklisted(utr)) {
      return res.status(400).json({
        success: false,
        error: 'UTR_ALREADY_USED',
        message: 'This UTR has already been claimed and settled'
      });
    }
    const assignedVpa = 'gaming@okaxis';
    const numAmount = parseFloat(amount || 0);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_AMOUNT',
        message: 'A positive amount is required'
      });
    }
    const generatedOrderId = `ORD_GAME_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const { txId, verification } = await db.recordTransactionAndLedger(
      generatedOrderId,
      utr,
      numAmount,
      assignedVpa
    );
    db.blacklistUtr(utr, generatedOrderId, numAmount, `Gaming direct settlement: ${company.company_name}`);
    return res.json({
      success: true,
      status: 'VERIFIED',
      orderId: generatedOrderId,
      utr,
      amount: numAmount,
      company: company.company_name,
      clientIP,
      verifiedAt: Date.now(),
      ledgerTxId: txId,
      ledgerVerification: verification
    });
  } catch (err) {
    console.error('[Gaming API] Error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 DISHA 8.2 Sovereign UPI Checkout running on http://localhost:${PORT}`);
    console.log(`📱 PWA Manifest: http://localhost:${PORT}/manifest.json`);
    console.log(`📡 WebSocket Gateway: ws://localhost:${PORT}/ws\n`);
  });

  const shutdown = () => {
    console.log('\nReceived kill signal, shutting down gracefully...');
    server.close(() => {
      console.log('Closed HTTP & WebSocket servers.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forcefully terminating process after timeout');
      process.exit(1);
    }, 10000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();



