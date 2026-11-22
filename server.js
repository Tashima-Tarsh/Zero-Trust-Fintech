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
const { createMerchantApi } = require('./merchant-api');
const { createPlatformControl } = require('./platform-control');
const {createReconciliationRouter,initializeReconciliationSchema,reconcileCredit,reconcileCreditInternal,reconcileCreditWithUtrClaim} = require('./financial/reconciliation-webhook');
const {createVaultEvidenceRouter,initializeVaultEvidenceSchema,rememberVaultAuthorization} = require('./financial/vault-evidence');
const {initializeQuantumSignal,createQuantumSignalRouter}=require('./financial/quantum-signal');
const {initProofBridgeSchema,createProofBridgeRouter}=require('./financial/proofbridge');
const {initDebitCredentialSchema,createDebitCredentialRouter}=require('./financial/debit-credential');
const {createCheckoutDiagnostics}=require('./financial/checkout-diagnostics');
const {lookupBankSender,coverage:bankSmsCoverage}=require('./financial/bank-sms-header-registry');
const {initSmsDebitRelay,createSmsDebitRelayRouter}=require('./financial/sms-debit-relay');
const {createUpiAppEvidenceRouter}=require('./financial/upi-app-evidence-router');
const {initPayerPartnerDebit,createPayerPartnerDebitRouter}=require('./financial/payer-partner-debit-bridge');
const {createP2pPrepaymentRouter}=require('./financial/p2p-prepayment-router');
const {initUpiAppEvidenceReplay,makeReplayGuard}=require('./financial/upi-app-evidence-replay');
const {initTimedStore,makeTimedStore,createTimedPaymentRouter}=require('./financial/timed-payment-bridge');
const {initializeOutbox,deliverNext,validatedDestination}=require('./financial/payer-evidence-outbox');
const sellerEvidencePilot=process.env.DISHA_SELLER_EVIDENCE_PILOT==='1';
const pilotOrderId=process.env.DISHA_SELLER_EVIDENCE_PILOT_ORDER_ID||'';
const {initializeClaimObserver,observeClaim} = require('./financial/untrusted-utr-claims');
const {
  buildNPCIIntentUri,
  sanitizeTransactionNote,
  sanitizeTxnRef,
  parseNPCIIntentResponse,
  parseUTRTimestamp,
  NPCI_RESPONSE_CODES
} = require('./npci-intent');
const {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { scoreEvidence, suggestAction, WEIGHTS, TIERS } = require('./utils/trust-score');
const { buildUpiUri, appLinks } = require('./utils/upi-intent');
const { getClientIP } = require('./utils/ip-utils');
const { IPWhitelistMiddleware } = require('./middleware/ip-whitelist');
const adminRoutes = require('./routes/admin/ip-whitelist');
// disha-cinematic server removed - merchant SaaS deprecated
const {buildContentSecurityPolicy, clerkFrontendApiOrigin} = require('./utils/clerk-csp');
const app = express();
const CLERK_ENABLED = Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
// Trust proxy only when explicitly opted in (e.g. behind Render/Cloudflare).
// Never on by default: X-Forwarded-For is trivially spoofable otherwise.

// Pony-tail observation window: policy limits, not a payment-success proof.
// Timing alone cannot establish credit or prevent reuse of a supplied UTR.
const {T_MIN_MS,T_MAX_MS,evaluateTemporalGate}=require('./utils/pony-tail-window');
const {createChallengeStore,initializeChallengeStore}=require('./financial/webauthn-challenge-store');
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
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(process.env.CLERK_PUBLISHABLE_KEY));
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-XSRF-Token, X-API-Key, X-Admin-Key');
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
  // Accept any explicitly configured origin, not only the first entry.
  if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
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
  // Sweep expired IP buckets on a detached interval, never during each request.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of fallbackHits.entries()) {
      const active = times.filter(t => t > cutoff);
      if (active.length) fallbackHits.set(key, active);
      else fallbackHits.delete(key);
    }
  }, Math.max(10000, windowMs));
  sweep.unref?.();
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
  // Scope the idempotency key by authenticated tenant + endpoint path so that
  // reusing a key across merchants or routes cannot return another request's
  // cached response (including sensitive payment-link data).
  let tenantId;
  try {
    const auth = getAuth(req);
    if (!auth || !auth.userId) throw new Error('NO_AUTH');
    tenantId = auth.userId;
  } catch {
    return res.status(401).json({ success: false, error: 'IDEMPOTENCY_AUTH_REQUIRED' });
  }
  const cacheKey = `idem:${tenantId}:${req.path}:${key}`;
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
    // Cap body size at 10KB to prevent memory bloat
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const cappedBody = bodyStr.length > 10240 ? bodyStr.substring(0, 10240) + '...[TRUNCATED]' : bodyStr;
    idempotencyCache.set(cacheKey, {
      response: { status: res.statusCode, headers: res.getHeaders(), body: cappedBody },
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
    });
    return originalSend.call(this, body);
  };
  next();
}
app.use(express.json({verify:(req,res,body)=>{
  if(req.path==='/api/reconciliation/credit')req.rawReconciliationBody=Buffer.from(body);
}}));
app.use(express.urlencoded({ extended: true }));
app.use(idempotencyMiddleware);
if (process.env.NODE_ENV === 'production') {
  // No customer session dumps, debug consoles or test endpoints in production.
  app.use((req, res, next) => {
    if (req.path === '/debug.html' || /^\/api\/debug(?:\/|$)/.test(req.path)) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
    next();
  });
}
// Isolated production-origin Android Chrome PaymentRequest research endpoint.
// GET-only lab, no DISHA checkout integration, payment mutation, storage or callback.
// Cloudflare Pages proxies /api/* to this same Railway backend.
app.get('/api/experiments/paymentresponse', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  return res.type('html').sendFile(path.join(__dirname, 'tests', 'browser', 'paymentresponse-lab.html'));
});
app.get('/api/experiments/paymentresponse-lab.js', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  return res.type('js').sendFile(path.join(__dirname, 'tests', 'browser', 'paymentresponse-lab.js'));
});
// Serve first-party runtime JS/CSS from Railway, not a potentially stale
// Cloudflare Pages static deployment. Strict names prevent file traversal.
const RUNTIME_ASSETS=new Set([
 'platform-console.js','platform-console.css','frontend-monitor.js','premium-dashboard.js',
 'premium.css','saas-white.css','merchant-mars.css','merchant-celestial.css',
 'merchant-reference.css','merchant-vpa-import.js','cosmic-checkout.js',
 'cosmic-checkout-model.js','cosmic-checkout.css','checkout-moonlight.css',
 'one-touch-vault.js','quantum-signal-client.js','p2p-paymentrequest-probe.js','copy-return-observer.js'
]);
app.get('/api/runtime-assets/:asset',(req,res)=>{
 const asset=req.params.asset;
 if(!RUNTIME_ASSETS.has(asset))return res.status(404).end();
 res.set('Cache-Control','no-store, no-cache, must-revalidate');
 return res.type(path.extname(asset)).sendFile(path.join(__dirname,'public',asset));
});
app.get(['/api/runtime/checkout','/api/runtime/merchant-checkout'],(req,res)=>{
 res.set('Cache-Control','no-store, no-cache, must-revalidate');
 return res.sendFile(path.join(__dirname,'public',
  req.path.endsWith('merchant-checkout')?'merchant-checkout.html':'checkout.html'));
});
// Header matching identifies a published sender label only; it MUST NOT
// change checkout state or ledger and does not authenticate SMS transport.
app.get('/api/bank-sms/coverage',(req,res)=>res.set('Cache-Control','no-store').json(bankSmsCoverage()));
app.get('/api/bank-sms/lookup',(req,res)=>{
 const sender=typeof req.query.sender==='string'?req.query.sender:'';
 return res.set('Cache-Control','no-store').json(lookupBankSender(sender));
});
// Signed transport identity does NOT authenticate the originating bank SMS.
app.use('/api/sms-debit-relay',verifyLimiter,createSmsDebitRelayRouter({
 getPool:()=>db.pgPool,
 getSession:id=>db.findSessionByOrderId(id),
 getTrustedKeys:()=>{
  try{
   const keys=JSON.parse(process.env.DISHA_SMS_RELAY_TRUSTED_PUBLIC_KEYS_JSON||'{}');
   return keys&&typeof keys==='object'&&!Array.isArray(keys)?keys:{};
  }catch(_){return {}}
 }
}));
// Authorized PSP bank -> DISHA payer-debit leg *research* mirror.
// The Google UPI Callback is NOT a generic merchant webhook; this adapter
// requires explicit PSP partner onboarding and configured Ed25519 public keys.
app.use('/api/payer-partner-debit',verifyLimiter,createPayerPartnerDebitRouter({
 getPool:()=>db.pgPool,
 getSession:id=>db.findSessionByOrderId(id),
 isOnboarded:sourceId=>{
  try{
   if(process.env.DISHA_PAYER_PSP_PARTNER_MODE!=='enabled')return false;
   const sourceIds=JSON.parse(process.env.DISHA_PAYER_PSP_ONBOARDED_SOURCES_JSON||'[]');
   return Array.isArray(sourceIds)&&sourceIds.includes(sourceId);
  }catch(_){return false}
 },
 getTrustedKeys:()=>{
  try{
   const p=JSON.parse(process.env.DISHA_PAYER_PSP_TRUSTED_ED25519_KEYS_JSON||'{}');
   return p&&typeof p==='object'&&!Array.isArray(p)?p:{};
  }catch(_){return {}}
 }
}));
// Experimental, read-only payer application response authentication.
app.use('/api/upi-app-evidence',verifyLimiter,createUpiAppEvidenceRouter({
 getSession:id=>db.findSessionByOrderId(id),
 consumeReplay:makeReplayGuard(()=>db.pgPool),
 getTrustedKeys:()=>{try{
  const parsed=JSON.parse(process.env.DISHA_GOOGLE_PAY_TRUSTED_PUBLIC_KEYS_JSON||'{}');
  return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
 }catch(_){return {}}}
}));
// 120-second checkout-scoped signed return; isolated from settlement and ledger.
app.use('/api/upi-app-evidence/timed',verifyLimiter,createTimedPaymentRouter({
 getSession:id=>db.findSessionByOrderId(id),
 getTrustedKeys:()=>{try{
  const keys=JSON.parse(process.env.DISHA_GOOGLE_PAY_TRUSTED_PUBLIC_KEYS_JSON||'{}');
  return keys&&typeof keys==='object'&&!Array.isArray(keys)?keys:{};
 }catch(_){return {}}},
 store:makeTimedStore(()=>db.pgPool,{shouldQueueSeller:id=>sellerEvidencePilot&&id===pilotOrderId})
}));
const checkoutDiagnostics=createCheckoutDiagnostics({db});
app.use('/api/checkout',checkoutDiagnostics.router);
const platformControl = createPlatformControl({db,getAuth});
const merchantApi = createMerchantApi({db, getAuth, buildUpiUri,platformControl});
// Public application and strictly owner-authorized control endpoints.
app.use('/api/platform',platformControl.router);
// Merchant API is isolated: do NOT intercept public checkout APIs.
app.use('/api', (req,res,next) =>
  (/^\/(?:merchant(?:\/|$)|auth\/me(?:\/|$))/.test(req.path))
    ? merchantApi.router(req,res,next) : next());
// 1. Static Assets: Serve PhonePe marketing styles, console styles, scripts, videos, and icons
// One canonical merchant dashboard; checkout and its APIs remain public.
app.get('/merchant-console.html', (req, res) => res.redirect(302, '/dashboard'));
// Canonical checkout must run before static middleware, which otherwise serves
// the retired alternative checkout pages.
app.get(['/checkout', '/checkout/', '/pay', '/pay/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});
// Serve the browser bundle matching the installed @simplewebauthn package.
// Deliberate payment-mode routes. Never route /p2m to /api/session/new.
app.get(['/choose-payment','/choose-payment/'],(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','payment-modes.html'));
});
app.get(['/p2p','/p2p/'],(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','checkout.html'));
});
app.get(['/p2m','/p2m/'],(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','p2m.html'));
});
app.get(['/p2m/checkout','/p2m/checkout/'],(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','merchant-checkout.html'));
});
app.get('/vendor/simplewebauthn.umd.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', '@simplewebauthn', 'browser', 'dist', 'bundle', 'index.umd.min.js'));
});
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
app.get('/auth-config.js', (req, res) => {
  // Public browser key only. Never expose CLERK_SECRET_KEY.
  // no-store ensures Cloudflare and clients cannot reuse a stale empty key
  // after configuration or environment switching.
  const key = process.env.CLERK_PUBLISHABLE_KEY || '';
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('application/javascript').send(
    `window.DISHA_CLERK_PUBLISHABLE_KEY=${JSON.stringify(key)};window.DISHA_CLERK_CONFIG_READY=${Boolean(CLERK_ENABLED && clerkFrontendApiOrigin(key))};`
  );
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'merchant-login.html'));
});
app.get('/signup', (req,res) => res.redirect(302,'/request-access'));
app.get('/request-access',(req,res)=>res.sendFile(path.join(__dirname,'public','request-access.html')));
app.get('/owner',(req,res)=>{
  if(!CLERK_ENABLED)return res.redirect('/login');
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','owner-console.html'));
});
app.get(['/dashboard', '/payments', '/analytics'], (req, res) => {
  if (!CLERK_ENABLED) return res.redirect('/login');
  // HTML shell has no tenant records: the Clerk SDK authorizes the browser and
  // every merchant API call independently enforces its verified identity.
  // Requiring server-side cookies here would reject valid bearer-token users.
  res.setHeader('Cache-Control', 'no-store');
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
// Amortize global cleanup; connection admission is O(1) per IP, not O(all IPs).
const wsHitsSweep = setInterval(() => {
  const cutoff = Date.now() - WS_CONNECTION_WINDOW_MS;
  for (const [ip, hits] of wsConnectionHits.entries()) {
    const active = hits.filter(t => t > cutoff);
    if (active.length) wsConnectionHits.set(ip, active);
    else wsConnectionHits.delete(ip);
  }
}, WS_CONNECTION_WINDOW_MS);
wsHitsSweep.unref?.();
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
  return true;
}
wss.on('connection', async (ws, req) => {
  try {
  const wsIp = wsClientIp(req);
  if (!wsRateLimit(wsIp)) {
    ws.close(4429, 'Too many WebSocket connections. Slow down.');
    return;
  }
  // Validate WebSocket Origin to prevent cross-site WebSocket hijacking
  const wsOrigin = req.headers.origin;
  if (wsOrigin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(wsOrigin)) {
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
  const session = await db.findSessionByOrderId(orderId);
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
  } catch (err) {
    console.error('[WebSocket] Failed to validate session:', err.message);
    ws.close(1011, 'Session validation unavailable');
  }
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
// Vault evidence: verified passkey authorization + observed browser return, never settlement.
app.use('/api/vault',createVaultEvidenceRouter({getPool:()=>db.pgPool}));
// Session-bound, multi-device evidence. Device events never mutate checkout or ledger state.
async function findSessionForEvidence(orderId){
  let local=null;
  try{local=await db.findSessionByOrderId(orderId);}catch(_){local=null;}
  if(local)return local;
  if(!db.pgPool)return null;
  const result=await db.pgPool.query('SELECT * FROM sessions WHERE order_id=$1 LIMIT 1',[orderId]);
  const row=result.rows[0];
  if(!row)return null;
  const upiUri=String(row.upi_uri||'');
  let params;
  try{params=new URL(upiUri).searchParams;}catch(_){params=new URLSearchParams();}
  const rawType=String(row.payment_type||row.merchant_type||'').toUpperCase();
  const merchantType=rawType.includes('P2M')||rawType==='MERCHANT'||params.has('mc')?'P2M':'P2P';
  return {
    orderId:String(row.order_id),
    sessionId:String(row.session_id),
    status:String(row.status||'').toUpperCase(),
    challengeAmount:String(row.challenge_amount),
    vpaAddress:String(row.vpa_address||'').toLowerCase(),
    merchantType,
    txnRef:String(row.txn_ref||''),
    upiUri,
    expiresAt:Number(row.expires_at||0)
  };
}

// Per-order digital twin. Browser observations are never converted to financial credits.
app.use('/api/quantum-signal',createQuantumSignalRouter({getPool:()=>db.pgPool}));
// Digital Credentials API prototype: issuer-signed submissions never mutate payment state.
app.use('/api/debit-credential',verifyLimiter,createDebitCredentialRouter({
 getPool:()=>db.pgPool,getSession:id=>db.findSessionByOrderId(id)
}));
// Experimental only: signed receipt claims never update payment status or ledger.
if(process.env.DISHA_PROOFBRIDGE_EXPERIMENT==='1')app.use('/api/proofbridge',
  createProofBridgeRouter({getPool:()=>db.pgPool,getSession:id=>db.findSessionByOrderId(id),
    getUpiUri:session=>generateUPILink(session)}));
// Authenticated internal account-credit boundary; disabled without explicit connector config.
// It never accepts customer-origin callbacks as bank-confirmed funds.
app.use('/api/reconciliation',createReconciliationRouter({
  getPool:()=>db.pgPool,onSettled:broadcastOrderSuccess
}));
// P0 #1: Admin-gated settlement confirmation. Completes the financial outcome loop
// by posting the double-entry ledger via the same reconciliation engine used by the
// bank-statement webhook. Fail-closed: 503 when RECONCILIATION_WEBHOOK_SECRET /
// RECONCILIATION_SOURCE_ID are not configured (no false credits).
app.post('/api/settlement/confirm', requireAdminAuth, async (req, res) => {
  const secret = process.env.RECONCILIATION_WEBHOOK_SECRET;
  const source = process.env.RECONCILIATION_SOURCE_ID;
  if (!secret || secret.length < 32 || !source) {
    return res.status(503).json({ success: false, error: 'RECONCILIATION_NOT_CONFIGURED' });
  }
  const pool = db.pgPool;
  if (!pool) return res.status(503).json({ success: false, error: 'POSTGRES_REQUIRED' });
  const { orderId, utr, amount, payeeVpa, eventId, statementEntryId, creditedAt } = req.body || {};
  if (!orderId || !utr || !amount || !payeeVpa || !eventId || !statementEntryId) {
    return res.status(400).json({ success: false, error: 'SETTLEMENT_REQUIRED_FIELDS' });
  }
  if (!/^\d{12}$/.test(String(utr))) {
    return res.status(400).json({ success: false, error: 'UTR_FORMAT_INVALID' });
  }
  const session = await db.findSessionByOrderId(orderId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });
  }
  const amountPaise = String(Math.round(Number(amount) * 100));
  if (!/^[1-9][0-9]{0,15}$/.test(amountPaise)) {
    return res.status(400).json({ success: false, error: 'AMOUNT_INVALID' });
  }
  const now = Date.now();
  const creditTs = creditedAt ? Number(creditedAt) : now;
  const payloadHash = require('node:crypto').createHash('sha256')
    .update(JSON.stringify({ source, eventId, orderId, merchantId: session.merchantId || 'mer_default', utr, amountPaise, payeeVpa, creditTs }))
    .digest('hex');
  const payload = {
    source, eventId, statementEntryId, orderId,
    merchantId: session.merchantId || 'mer_default',
    direction: 'CREDIT', status: 'POSTED',
    bankEvidence: 'VERIFIED_STATEMENT',
    utr, payeeVpa, amountPaise, creditedAt: creditTs
  };
  try {
    const result = await reconcileCredit(pool, payload, source, payloadHash);
    if (result.state === 'POSTED' && !result.replayed) {
      try { broadcastOrderSuccess(orderId, { amount: session.baseAmount, baseAmount: session.baseAmount, vpaAddress: result.vpaAddress || payeeVpa, senderVpa: null, utr, txId: result.txId, timestamp: now }); } catch (_) {}
    }
    return res.status(result.state === 'QUARANTINED' ? 202 : 200).json({ success: true, ...result });
  } catch (err) {
    if (!err.status) console.error('[Settlement confirm]', err.code || err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.code : 'SETTLEMENT_UNAVAILABLE' });
  }
});
// TASK 3: SESSION TOKEN GENERATION
// ═══════════════════════════════════════════════════════════════════
async function generateSession(baseAmount = 100, description = '', customVpa = null) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  // P2P browser-only payment window is capped at 90 seconds from issuance.
  // Server time is authoritative; this is a freshness limit, not debit proof.
  const expiresAt = now + (90 * 1000);
  const qrRefreshAt = now + (15 * 1000); // 15 seconds dynamic refresh
  const orderId = 'PAY_' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const txnRef = 'SRV' + crypto.randomBytes(12).toString('hex').toUpperCase();
const challengeAmount = Number(baseAmount);
  // TASK 9: Select optimal VPA to prevent bans or primary VPA
  let vpaAddress = (customVpa && String(customVpa).trim()) ? String(customVpa).trim() : null;
  let merchantType = 'P2P';
  let vpaMcc = null;
  let payeeName = null;

  if (!vpaAddress) {
    let route = null;
    try {
      route = await db.selectVPARoute('mer_default', challengeAmount);
    } catch (e) {
      route = null;
    }
    const routeObj = route || {};
    // Check velocity on routed VPA; if at limit, find another active VPA under limit
    if (routeObj.vpaAddress && !await db.checkAndIncrementVpaVelocity(routeObj.vpaAddress)) {
      const activeVPAs = db.getAllActiveVPAs ? await db.getAllActiveVPAs() : [];
      const candidates = await Promise.all(activeVPAs.map(async v => ({...v, eligible: await db.checkAndIncrementVpaVelocity(v.vpa_address)})));
      const underLimit = candidates.find(v => v.eligible);
      if (underLimit) {
        vpaAddress = underLimit.vpa_address;
        merchantType = underLimit.account_type || 'PERSONAL';
        vpaMcc = underLimit.mcc || null;
        payeeName = underLimit.holder_name || null;
      } else {
        throw new Error('ALL_VPAS_AT_VELOCITY_LIMIT');
      }
    } else {
      vpaAddress = routeObj.vpaAddress || process.env.MERCHANT_UPI_ID || 'merchant@upi';
      merchantType = routeObj.merchantType || 'P2P';
      vpaMcc = routeObj.mcc || null;
      payeeName = routeObj.holderName || null;
    }
  } else {
    // For custom VPA, FIRST validate merchant type, THEN check velocity
    const mt = await db.getVpaMerchantType(vpaAddress);
    merchantType = mt.accountType;
    vpaMcc = mt.mcc;
    payeeName = mt.holderName || null;
    // This public endpoint is P2P ONLY. A receiving account classified as
    // merchant (including the separately provisioned company VPA) must never
    // be silently rendered as a P2P intent.
    const classified=String(merchantType||'').toUpperCase();
    const companyVpa=String(process.env.DISHA_COMPANY_P2M_VPA||'').trim().toLowerCase();
    if(!['PERSONAL','P2P'].includes(classified)||
       (companyVpa&&String(vpaAddress||'').toLowerCase()===companyVpa))
      throw new Error('P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH');
    // Velocity control: if custom VPA is at hourly limit, reject
    if (!await db.checkAndIncrementVpaVelocity(vpaAddress)) {
      throw new Error('VPA_VELOCITY_LIMIT');
    }
  }
  // Final validation for P2P endpoint
  const classified=String(merchantType||'').toUpperCase();
  const companyVpa=String(process.env.DISHA_COMPANY_P2M_VPA||'').trim().toLowerCase();
  if(!['PERSONAL','P2P'].includes(classified)||
     (companyVpa&&String(vpaAddress||'').toLowerCase()===companyVpa))
    throw new Error('P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH');
  // Challenge amount is the exact baseAmount — no extra paise offsets.
  // ECC vault signature + UTR-order binding is the mathematical proof;
  // amount uniqueness is enforced by UTR-order binding, not challenge_amount.
  const session = {
    sessionId,
    orderId,
    description: String(description || '').trim(),
    challengeAmount,
    baseAmount: Number(baseAmount),
    txnRef: sanitizeTxnRef(txnRef),
    vpaAddress,
    merchantType,
    mcc: vpaMcc,
    payeeName,
    createdAt: now,
    expiresAt,
    qrRefreshAt,
    status: 'PENDING',
    state: 'WAITING',
    utr: null
  };
  // Reject invalid UPI intents before consuming a session or velocity slot.
  session.upiUri=generateUPILink(session);
  await db.saveSession(session);
  // Velocity already incremented atomically by checkAndIncrementVpaVelocity
  return session;
}
// ═══════════════════════════════════════════════════════════════════
// TASK 4: NPCI-COMPLIANT UPI DEEP LINK GENERATOR (v3.2 Spec & upi-intent)
// ═══════════════════════════════════════════════════════════════════
function generateUPILink(session) {
  // QR, native tap, and shared checkout must use the identical issued bytes.
  // Stored payment_type is authoritative; legacy QR snapshots also preserve it.
  if(session.upiUri)return session.upiUri;
  // Never silently downgrade a merchant (P2M) account into a personal UPI
  // transfer, or manufacture bank/acquirer merchant classification.
  const account=String(session.merchantType||'PERSONAL').toUpperCase();
  const isMerchant=account==='MERCHANT'||account==='P2M';
  const pa=session.vpaAddress||MERCHANT_UPI_ID;
  // Use the actual payment purpose, not artificial notes intended to bypass
  // banking risk screening or obscure a merchant payment.
  const note=String(session.description||'UPI intent').trim().slice(0,50);
  const common={pa,pn:session.payeeName||MERCHANT_NAME,am:session.challengeAmount,tn:note};
  if(isMerchant){
    const mcc=String(session.mcc||'');
    if(!/^\d{4}$/.test(mcc)||mcc==='0000')
      throw new Error('BANK_VERIFIED_MCC_REQUIRED_FOR_P2M');
    return buildUpiUri({
      ...common,kind:'P2M',mc:mcc,
      tr:String(session.txnRef||session.orderId||'').replace(/[^A-Za-z0-9]/g,'').slice(0,35)
    });
  }
  if(!['PERSONAL','P2P'].includes(account))
    throw new Error('UNKNOWN_UPI_ACCOUNT_CLASSIFICATION');
  return buildUpiUri({...common,kind:'P2P'});
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
      // Public checkout can only target the configured owner receiving VPA.
      // Tenant payment links use the separate token-bound merchant route.
      const primaryVpa = (process.env.MERCHANT_UPI_ID || MERCHANT_UPI_ID || '').toLowerCase();
      if (primaryVpa && requestedVpa.toLowerCase() === primaryVpa) {
        validatedVpa = primaryVpa;
      } else {
        return res.status(400).json({
          success: false,
          error: 'UNAUTHORIZED_PAYEE_VPA',
          message: 'The requested payee VPA is not an authorized settlement handle.'
        });
      }
    }
    // The generic checkout is exclusively the platform-owner P2P receiver.
    // Merchant P2P and P2M orders use their own tenant-token-bound checkout.
    // Never fall through to the legacy shared VPA pool for public payments.
    if(!requestedVpa){
      validatedVpa=(process.env.MERCHANT_UPI_ID||MERCHANT_UPI_ID||'').trim();
      if(!validatedVpa) return res.status(503).json({
        success:false,error:'RECEIVING_UPI_NOT_CONFIGURED',
        message:'Public checkout receiving account is not configured.'
      });
    }
    const session = await generateSession(baseAmount, description, validatedVpa);
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
      serviceNumber: session.txnRef,
      vpaAddress: session.vpaAddress,
      merchantName: session.payeeName||MERCHANT_NAME,
      paymentType:String(session.merchantType).toUpperCase()==='MERCHANT'?'P2M':'P2P',
      expiresAt: session.expiresAt,
      qrRefreshAt: session.qrRefreshAt,
      upiLink,
      appLinks: links,
      qrDataUrl
    });
  } catch (err) {
    if(err?.message==='P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH')
      return res.status(409).json({success:false,error:'P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH',
        message:'This P2P checkout requires a personal receiving account. Merchant payments must use P2M.'});
    console.error('Error generating session:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});
// Fetch active session status
app.get('/api/session/:orderId', async (req, res) => {
  const session = await db.findSessionByOrderId(req.params.orderId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  // Bind read access to the session owner (holder of sessionId from /api/session/new).
  const token = req.query.token;
  if (!token || token !== session.sessionId) {
    return res.status(401).json({ success: false, error: 'SESSION_TOKEN_REQUIRED' });
  }
  let upiLink;
  try{upiLink=generateUPILink(session)}
  catch(_){return res.status(409).json({success:false,error:'PAYEE_URI_UNAVAILABLE'})}
  res.set('Cache-Control','no-store').json({ success: true, session, paymentType:session.merchantType, upiLink });
});

// Order state polling endpoint for checkout page (mathematical time window: 15s-180s)
app.get('/api/order-state/:orderId', async (req, res) => {
  try {
    const session=await db.findSessionByOrderId(req.params.orderId);
    if(!session)return res.status(404).json({success:false,error:'Order not found'});
    const token=req.query.token;
    const received=typeof token==='string'?Buffer.from(token):Buffer.alloc(0);
    const expected=Buffer.from(session.sessionId||'');
    if(!received.length||received.length!==expected.length||
       !crypto.timingSafeEqual(received,expected))
      return res.status(401).set('Cache-Control','no-store')
        .json({success:false,error:'SESSION_TOKEN_REQUIRED'});
    const state=await db.getOrderState(req.params.orderId);
    if(!state)return res.status(404).json({success:false,error:'Order not found'});
    return res.set('Cache-Control','no-store').json({success:true,...state});
  }catch(err){
    console.error('[Order state]',err.message);
    return res.status(500).json({success:false,error:'ORDER_STATE_UNAVAILABLE'});
  }
});
// Observation-only P2P payer debit evidence. Never mutate checkout status or ledger.
app.get('/api/payer-debit-evidence/:orderId', verifyLimiter, async (req,res)=>{
  res.set('Cache-Control','no-store');
  const id=req.params.orderId,token=req.query.token;
  if(!/^[A-Za-z0-9_-]{6,150}$/.test(id)||typeof token!=='string')
    return res.status(401).json({success:false,error:'SESSION_TOKEN_REQUIRED'});
  try{
    const session=await db.findSessionByOrderId(id);
    if(!session||!safeCompareKeys(token,session.sessionId))
      return res.status(401).json({success:false,error:'SESSION_TOKEN_REQUIRED'});
    if(!['PERSONAL','P2P'].includes(String(session.merchantType||'').toUpperCase()))
      return res.status(409).json({success:false,error:'P2P_REQUIRED'});
    const result={success:true,orderId:id,serviceId:session.txnRef||null,debitVerified:false,
      paymentVerified:false,paymentStateChanged:false,bankAttestationAvailable:false,
      evidence:[],state:'NO_AUTHENTICATED_PAYER_DEBIT_EVIDENCE'};
    if(!db.pgPool)return res.json(result);
    const amountPaise=require('./financial/money').rupeesToPaise(String(session.challengeAmount));
    const payee=String(session.vpaAddress||'').trim().toLowerCase();
    const sources=[
      {source:'SIGNED_SMS_TRANSPORT_CANDIDATE_UNVERIFIED',sql:
        'SELECT utr_candidate AS utr,amount_paise,payee_vpa,observed_at '+
        "FROM disha_sms_debit_candidates WHERE order_id=$1 AND utr_candidate IS NOT NULL "+
        'ORDER BY received_at DESC LIMIT 5'},
      // Separately onboarded PSP-bank payer-debit leg, not Google Pay's
      // restricted callback and never beneficiary-credit evidence.
      {source:'PSP_PARTNER_DEBIT_LEG_OBSERVED_UNVERIFIED',
       enabled:process.env.DISHA_PAYER_PSP_PARTNER_MODE==='enabled',
       sql:'SELECT e.utr,e.amount_paise,e.payee_vpa,e.occurred_at AS observed_at '+
        'FROM disha_payer_partner_debit_events e '+
        "WHERE e.order_id=$1 AND e.debit_leg_status='CONFIRMED' "+
        'AND NOT EXISTS (SELECT 1 FROM disha_payer_partner_debit_events r '+
         "WHERE r.order_id=e.order_id AND r.source_id=e.source_id AND r.utr=e.utr AND r.debit_leg_status='REVERSED' "+
         'AND r.occurred_at>=e.occurred_at) '+
        'ORDER BY e.received_at DESC LIMIT 5'},
      // A browser return may carry a 12-digit reference, but its source is
      // not the UPI app's authenticated debit record.
      {source:'BROWSER_RETURN_OBSERVATION',sql:
        'SELECT e.utr_candidate AS utr,t.amount_paise,t.payee_vpa,e.observed_at '+
        'FROM disha_quantum_events e JOIN disha_quantum_twins t ON t.order_id=e.order_id '+
        "WHERE e.order_id=$1 AND e.event_kind='RETURN' ORDER BY e.observed_at DESC LIMIT 5"},
      {source:'ISSUER_SIGNED_CLAIM',enabled:process.env.DISHA_PROOFBRIDGE_EXPERIMENT==='1',sql:
        'SELECT utr,amount_paise,payee_vpa,paid_at AS observed_at '+
        'FROM disha_proofbridge_capsules WHERE order_id=$1 ORDER BY received_at DESC LIMIT 5'}
    ];
    let queried=false;
    for(const source of sources){
      if(source.enabled===false)continue;
      try{
        const rows=(await db.pgPool.query(source.sql,[id])).rows;
        queried=true;
        for(const r of rows){
          if(!/^\d{12}$/.test(String(r.utr||''))||String(r.amount_paise)!==amountPaise||
             String(r.payee_vpa||'').toLowerCase()!==payee)continue;
          if(result.evidence.some(e=>e.utr===r.utr))continue;
          result.evidence.push({utr:r.utr,
            source:source.source,
            amountPaise,payeeVpa:payee,
            observedAt:Number(r.observed_at),authenticatedDebit:false});
        }
      }catch(e){
        if(e.code!=='42P01')return res.status(503).json({success:false,error:'EVIDENCE_STORAGE_UNAVAILABLE'});
      }
    }
    // A recognized bank sender header and signed relay transport are NOT bank proof.
    // Even when amount and payee match, authenticatedDebit stays false.
    if(!queried)return res.status(503).json({success:false,error:'EVIDENCE_STORAGE_UNAVAILABLE'});
    if(result.evidence.length)result.state='UTR_CANDIDATE_OBSERVED_UNVERIFIED';
    return res.json(result);
  }catch(_){return res.status(503).json({success:false,error:'DEBIT_EVIDENCE_UNAVAILABLE'});}
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
  // Explicit unsuccessful/pending terms take precedence over any claimed SUCCESS.
  if (/\b(failed|declined|reversed|rejected|cancelled|canceled|expired)\b/i.test(text)) {
    foundStatusText = 'FAILED';
  } else if (/\b(pending|processing|in progress|awaiting)\b/i.test(text)) {
    foundStatusText = 'PENDING';
  } else if (/\b(successful|success|completed|paid|debited)\b/i.test(text)) {
    foundStatusText = 'SUCCESS';
  }
  // Shown time is never accepted from the client; authentic receipts carry
  // their own time and this parser does not extract it from image text.
  const foundShownTime = null;
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
    const { utr, amount, receipt, orderId, txnRef, token } = req.body || {};
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
    if (detectedOrderId) session = await db.findSessionByOrderId(detectedOrderId);
    if (!session && txnRef) session = await db.findSessionByTxnRef(txnRef);
    if (!session) {
      return res.status(400).json({
        success: false,
        layer: 1,
        code: 'SESSION_NOT_FOUND',
        reason: 'Order session reference not found in transaction register.'
      });
    }

    // Checkout bearer and CSRF proof are required before any mutable step.
    // Untrusted receipts never acquire an exclusive UTR-to-order binding.
    if(!safeCompareKeys(token,session.sessionId) ||
       !safeCompareKeys(req.headers['x-csrf-token'],token))
      return res.status(401).json({success:false,code:'CHECKOUT_TOKEN_REQUIRED'});
    if(session.status!=='PENDING')
      return res.status(409).json({success:false,code:'ORDER_NOT_PENDING'});
    // ─────────────────────────────────────────────────────────────
    // LAYER 1.5: TIME WINDOW CHECK (Mathematical: 15s min, 180s max)
    // ─────────────────────────────────────────────────────────────
    const temporal=evaluateTemporalGate(session,now);
    if(temporal.state==='INVALID_SESSION_CLOCK'||temporal.state==='CLOCK_SKEW')
      return res.status(400).json({success:false,code:temporal.state});
    const timeElapsedMs=temporal.elapsedMs;

    // State 1: Too early (0 <= t < 15s)
    if (temporal.state==='WAITING') {
      await db.updateSessionState(session.orderId, 'WAITING');
      return res.status(200).json({
        success: true,
        state: 'WAITING',
        orderId: session.orderId,
        timeRemaining: (T_MIN_MS - timeElapsedMs) / 1000,
        message: `Please wait ${Math.ceil((T_MIN_MS - timeElapsedMs) / 1000)}s before verification`
      });
    }

    // State 4: Too late (t > 180s)
    if (temporal.state==='EXPIRED') {
      await db.updateSessionState(session.orderId, 'EXPIRED');
      await db.updateSessionStatus(session.orderId, 'EXPIRED');
      return res.status(400).json({
        success: false,
        state: 'EXPIRED',
        orderId: session.orderId,
        code: 'ORDER_EXPIRED',
        reason: 'Order timeout (>3 minutes). Please create a new order.'
      });
    }

    // State 2: Verification window (15s <= t <= 180s)
    await db.updateSessionState(session.orderId, 'VERIFY_WINDOW');

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
      utrSeen: await db.isUtrBlacklisted(parsedUtr),
      imageHashSeen: req.body.imageHash ? (typeof db.isImageHashSeen === 'function' ? await db.isImageHashSeen(req.body.imageHash) : false) : false,
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
        await db.updateSessionStatus(session.orderId, 'EXPIRED');
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
      await db.updateSessionState(session.orderId, 'EXPIRED');
      await db.updateSessionStatus(session.orderId, 'EXPIRED');
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
    // Observational UTR candidate — never an authoritative reservation.
    const claim=await observeClaim(db.pgPool,session.orderId,parsedUtr,'LEGACY_VERIFY');
    if(claim.error)return res.status(503).json({success:false,code:claim.error});
    if(claim.conflict)return res.status(409).json({
      success:false,verified:false,state:'CONFLICTING_EVIDENCE',code:'UTR_CLAIM_REPLAY'
    });
    await db.updateSessionState(session.orderId, 'VERIFY_WINDOW');
    return res.status(202).json({
      success: true,
      verified: false,
      state: 'UTR_OBSERVED',
      code: 'CUSTOMER_REFERENCE_NOT_BANK_CONFIRMED',
      orderId: session.orderId,
      utr: parsedUtr,
      message: 'Reference recorded for this order; no credited-payment confirmation available.'
    });
  } catch (err) {
    console.error('[UTR Verification] Error:', err);
    return res.status(500).json({success:false,error:'VERIFICATION_UNAVAILABLE'});
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
    const session = await db.findSessionByOrderId(orderId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        reason: 'No active checkout session for this order ID.'
      });
    }
    if(!safeCompareKeys(token,session.sessionId) ||
       !safeCompareKeys(req.headers['x-csrf-token'],token))
      return res.status(401).json({success:false,error:'SESSION_TOKEN_REQUIRED'});
    if (session.status === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_ALREADY_SETTLED',
        reason: 'This session has already been settled.'
      });
    }
    // Cancellation cooldown: reject CFC if user recently cancelled a UPI prompt
    const cooldown = await db.checkSessionCooldown(session.orderId);
    if (cooldown.inCooldown) {
      return res.status(400).json({
        success: false,
        state: 'COOLDOWN',
        error: 'CANCELLATION_COOLDOWN',
        reason: `Please wait ${cooldown.secondsRemaining}s before trying again.`,
        secondsRemaining: cooldown.secondsRemaining
      });
    }
    const temporal=evaluateTemporalGate(session,now);
    if(temporal.state==='INVALID_SESSION_CLOCK'||temporal.state==='CLOCK_SKEW')
      return res.status(400).json({success:false,error:temporal.state});
    const timeElapsedMs=temporal.elapsedMs;
    if (temporal.state==='WAITING') {
      return res.status(200).json({
        success: true,
        state: 'WAITING',
        orderId: session.orderId,
        timeRemaining: (T_MIN_MS - timeElapsedMs) / 1000,
        message: `Please wait ${Math.ceil((T_MIN_MS - timeElapsedMs) / 1000)}s before CFC verification`
      });
    }
    if (temporal.state==='EXPIRED') {
      await db.updateSessionStatus(session.orderId, 'EXPIRED');
      await db.updateSessionState(session.orderId, 'EXPIRED');
      return res.status(400).json({
        success: false,
        state: 'EXPIRED',
        error: 'ORDER_EXPIRED',
        reason: 'Order timeout (>3 minutes). Please create a new order.'
      });
    }
    const claim=await observeClaim(db.pgPool,session.orderId,cleanUtr,'CFC');
    if(claim.error)return res.status(503).json({success:false,error:claim.error});
    if(claim.conflict)return res.status(409).json({
      success:false,verified:false,state:'CONFLICTING_EVIDENCE',error:'UTR_CLAIM_REPLAY'
    });
    // A customer-entered UTR may be correlated to the order but cannot itself
    // establish funds credited. Do not manufacture a ledger credit.
    await db.updateSessionState(session.orderId, 'VERIFY_WINDOW');
    return res.status(202).json({
      success: true, verified: false, state: 'UTR_OBSERVED',
      orderId: session.orderId, utr: cleanUtr,
      code: 'CUSTOMER_REFERENCE_NOT_BANK_CONFIRMED'
    });
  } catch (err) {
    console.error('[CFC UTR] Error:', err);
    return res.status(500).json({success:false,error:'UTR_RECORDING_UNAVAILABLE'});
  }
});
// ═════════════════════════════════════════════════════════════════════
// TASK 14: CFC CANCELLATION COOLDOWN — Prevent UPI prompt spam
// When user cancels the native UPI app (GPay/PhonePe/PayTap), frontend calls
// this endpoint to set a 2-minute cooldown before they can retry.
// ═════════════════════════════════════════════════════════════════════
app.post('/api/cfc/cancel', verifyLimiter, async (req, res) => {
  try {
    const {orderId,token}=req.body||{};
    if(!orderId)return res.status(400).json({success:false,error:'ORDER_ID_REQUIRED'});
    const session=await db.findSessionByOrderId(orderId);
    if(!session)return res.status(404).json({success:false,error:'SESSION_NOT_FOUND'});
    if(!safeCompareKeys(token,session.sessionId) ||
       !safeCompareKeys(req.headers['x-csrf-token'],token))
      return res.status(401).json({success:false,error:'CHECKOUT_TOKEN_REQUIRED'});
    if(session.status!=='PENDING'||Date.now()>session.expiresAt)
      return res.status(409).json({success:false,error:'ORDER_NOT_ACTIVE'});
    await db.setSessionCooldown(orderId, 120 * 1000); // 2-minute cooldown
    await db.updateSessionState(orderId, 'CANCELLED');
    return res.json({
      success: true,
      cooldownSeconds: 120,
      message: 'Cancellation cooldown set. Please wait before retrying.'
    });
  } catch (err) {
    console.error('CFC cancel error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// ═════════════════════════════════════════════════════════════════════
// TASK 13: WEBAUTHN / PASSKEYS — HARDWARE VAULT AUTHENTICATION
// Android Titan M2 / Apple Secure Enclave via W3C WebAuthn standard
// ═════════════════════════════════════════════════════════════════════
const RP_NAME = 'DISHA 8.2 Checkout';
// WebAuthn RP ID and origin must match the browser's HTTPS hostname.
const RP_ORIGIN = new URL(
  process.env.WEBAUTHN_RP_ORIGIN ||
  process.env.APP_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://disha8-2.thenitishkr.in' : 'http://localhost:3000')
).origin;
const RP_ID = process.env.WEBAUTHN_RP_ID || new URL(RP_ORIGIN).hostname;

// Durable single-use WebAuthn challenges, with a local-only memory fallback.
const authChallenges=createChallengeStore(()=>db.pgPool);
 // No web browser self-report can attest Android root or debugger state.
 // This hook must be replaced with a verified device-attestation provider,
 // not with request-body booleans, before P2P payments can be unlocked.
 app.use('/api/p2p/prepayment',verifyLimiter,createP2pPrepaymentRouter({
  getSession:id=>db.findSessionByOrderId(id),
  getVaultChallenge:id=>authChallenges.get(id),
  getVerifiedDeviceAttestation:async()=>null
 }));


function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// ── WebAuthn Registration: Start ──
app.post('/api/webauthn/register/start', async (req, res) => {
  try {
    const { userId, userName, orderId } = req.body || {};
    if (!userId || !userName || !orderId) {
      return res.status(400).json({ success: false, error: 'userId, userName and orderId required' });
    }
    const checkoutSession = await db.findSessionByOrderId(orderId);
    if (!checkoutSession) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });
    }
    if (checkoutSession.status !== 'PENDING' || Date.now() > checkoutSession.expiresAt) {
      return res.status(409).json({ success: false, error: 'ORDER_NOT_ACTIVE' });
    }
    const existingKeys = await db.findPasskeysByUserId(userId);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new Uint8Array(Buffer.from(userId, 'utf8')),
      userName,
      userDisplayName: userName,
      attestationType: 'none',
      excludeCredentials: existingKeys.map(k => ({
        id: k.credential_id,
        transports: k.transports ? JSON.parse(k.transports) : undefined
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      }
    });
    const sessionId = generateSessionId();
    await authChallenges.set(sessionId, {
      type: 'registration',
      userId, userName, orderId,
      challenge: options.challenge,
      expiresAt: Date.now() + 60000
    });
    res.json({ success: true, sessionId, publicKey: options });
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
    const stored = await authChallenges.take(sessionId);
    if (!stored || stored.type !== 'registration' || Date.now() > stored.expiresAt) {
      await authChallenges.delete(sessionId);
      return res.status(400).json({ success: false, error: 'Invalid or expired session' });
    }
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo?.credential) {
      return res.status(401).json({ success: false, error: 'Registration verification failed' });
    }
    const info = verification.registrationInfo;
    const verifiedCredential = info.credential;
    const saved = await db.savePasskey(
      stored.userId,
      verifiedCredential.id,
      Buffer.from(verifiedCredential.publicKey).toString('base64url'),
      verifiedCredential.counter,
      info.credentialDeviceType,
      Number(Boolean(info.credentialBackedUp)),
      JSON.stringify(verifiedCredential.transports || [])
    );
    if (!saved) {
      return res.status(409).json({ success: false, error: 'Could not store credential' });
    }
    const order = await db.findSessionByOrderId(stored.orderId);
    if (!order || order.status !== 'PENDING' || Date.now() > order.expiresAt) {
      await authChallenges.delete(sessionId);
      return res.status(409).json({ success:false, error:'ORDER_NOT_ACTIVE' });
    }
    // The OS has already verified the device owner during passkey creation.
    // Requiring an immediate second biometric challenge would duplicate the UX.
    // This authorizes only a UPI app handoff, NEVER financial settlement.
    await authChallenges.set(sessionId,{
      type:'authentication',
      status:'VAULT_VERIFIED_AWAITING_UPI',
      userId:stored.userId,orderId:stored.orderId,amount:order.challengeAmount,
      verifiedAt:Date.now(),expiresAt:Math.min(Date.now()+180000,order.expiresAt)
    });
    await rememberVaultAuthorization(db.pgPool,stored.orderId,sessionId);
    return res.json({
      success: true, sessionId, credentialId: verifiedCredential.id,
      userId: stored.userId, orderId: stored.orderId
    });
  } catch (err) {
    console.error('WebAuthn register finish error:', err);
    res.status(400).json({ success: false, error: 'Registration verification failed' });
  }
});

// ── WebAuthn Authentication: Start ──
app.post('/api/webauthn/authenticate/start', async (req, res) => {
  try {
    const { userId, orderId } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ success: false, error: 'userId and orderId required' });
    }
    const checkoutSession = await db.findSessionByOrderId(orderId);
    if (!checkoutSession) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });
    }
    if (checkoutSession.status !== 'PENDING' || Date.now() > checkoutSession.expiresAt) {
      return res.status(409).json({success:false,error:'ORDER_NOT_ACTIVE'});
    }
    const existingKeys = await db.findPasskeysByUserId(userId);
    if (!existingKeys.length) {
      return res.status(400).json({
        success: false,
        error: 'No passkey registered for this user. Register first.',
        needsRegistration: true
      });
    }
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: existingKeys.map(k => ({
        id: k.credential_id,
        transports: k.transports ? JSON.parse(k.transports) : undefined
      })),
      userVerification: 'required'
    });
    const sessionId = generateSessionId();
    await authChallenges.set(sessionId, {
      type: 'authentication', userId, orderId,
      amount: checkoutSession.challengeAmount,
      challenge: options.challenge,
      expiresAt: Date.now() + 60000
    });
    res.json({ success: true, sessionId, publicKey: options });
  } catch (err) {
    console.error('WebAuthn authenticate start error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── WebAuthn Authentication: Finish ──
app.post('/api/webauthn/authenticate/finish', async (req, res) => {
  try {
    const { sessionId, credential } = req.body || {};
    if (!sessionId || !credential?.id) {
      return res.status(400).json({ success: false, error: 'sessionId and credential required' });
    }
    const stored = await authChallenges.take(sessionId);
    if (!stored || stored.type !== 'authentication' || Date.now() > stored.expiresAt) {
      await authChallenges.delete(sessionId);
      return res.status(400).json({ success: false, error: 'Invalid or expired session' });
    }
    const existingKey = await db.findPasskeyByCredentialId(credential.id);
    if (!existingKey || existingKey.user_id !== stored.userId) {
      return res.status(401).json({ success: false, error: 'Unknown credential' });
    }
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: existingKey.credential_id,
        publicKey: new Uint8Array(Buffer.from(existingKey.public_key, 'base64url')),
        counter: existingKey.sign_count || 0,
        transports: existingKey.transports ? JSON.parse(existingKey.transports) : undefined
      },
      requireUserVerification: true
    });
    if (!verification.verified) {
      return res.status(401).json({ success: false, error: 'Vault signature rejected' });
    }
    await db.updatePasskeyCounter(existingKey.credential_id, verification.authenticationInfo.newCounter);
    await authChallenges.set(sessionId, {
      ...stored,
      status: 'VAULT_VERIFIED_AWAITING_UPI',
      verifiedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000
    });
    await rememberVaultAuthorization(db.pgPool,stored.orderId,sessionId);
    return res.json({
      success: true, sessionId, orderId: stored.orderId,
      amount: stored.amount, message: 'Hardware vault verified. Proceed to UPI.'
    });
  } catch (err) {
    console.error('WebAuthn authenticate finish error:', err);
    res.status(400).json({ success: false, error: 'Vault verification failed' });
  }
});

// ── Finalize UPI Settlement (after vault verification + UTR submission) ──
// Atomic UTR claim + settlement in single transaction.
app.post('/api/checkout/finalize-upi', verifyLimiter, async (req, res) => {
  try {
    const { sessionId, orderId, txnRef } = req.body || {};
    if (!sessionId || !orderId || !txnRef) {
      return res.status(400).json({ success: false, error: 'sessionId, orderId, txnRef required' });
    }

    const stored = await authChallenges.get(sessionId);
    if (!stored || stored.orderId !== orderId) {
      return res.status(400).json({ success: false, error: 'Invalid session or Order ID mismatch' });
    }
    if (Date.now() > stored.expiresAt) {
      await authChallenges.delete(sessionId);
      return res.status(403).json({ success: false, error: 'VAULT_SESSION_EXPIRED' });
    }
    if (stored.status !== 'VAULT_VERIFIED_AWAITING_UPI') {
      return res.status(403).json({
        success: false,
        error: 'ORDER_NOT_VAULT_VERIFIED',
        message: 'Order was not authorized by the hardware vault.'
      });
    }

    // Find the checkout session
    const session = await db.findSessionByOrderId(orderId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });
    }

    if (session.status !== 'PENDING' || Date.now() > session.expiresAt)
      return res.status(409).json({ success: false, error: 'ORDER_NOT_ACTIVE' });

    // Atomic UTR claim + settlement in single SERIALIZABLE transaction
    const pgPool = db.pgPool;
    if (!pgPool) return res.status(503).json({ success: false, error: 'POSTGRES_REQUIRED' });

    const amountPaise = String(Math.round(Number(session.challengeAmount) * 100));
    if (!/^[1-9][0-9]{0,15}$/.test(amountPaise)) {
      return res.status(400).json({ success: false, error: 'AMOUNT_INVALID' });
    }

    const cleanUtr = String(txnRef).replace(/\D/g, '');
    if (!/^\d{12}$/.test(cleanUtr)) {
      return res.status(400).json({ success: false, error: 'UTR_FORMAT' });
    }

    const now = Date.now();
    const payload = {
      source: 'VAULT_FINALIZE',
      eventId: `vault_finalize_${orderId}_${now}`,
      statementEntryId: `vault_${stored.sessionId}`,
      orderId: session.orderId,
      merchantId: session.merchant_id || 'mer_default',
      direction: 'CREDIT',
      status: 'POSTED',
      bankEvidence: 'VAULT_UTR_CORRELATED',
      utr: cleanUtr,
      payeeVpa: session.vpa_address || MERCHANT_UPI_ID,
      amountPaise,
      creditedAt: now
    };

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const { reconcileCreditWithUtrClaim } = require('./financial/reconciliation-webhook');
    const result = await reconcileCreditWithUtrClaim(pgPool, payload, 'VAULT_FINALIZE', payloadHash, 'VAULT_FINALIZE');

    if (result.state === 'POSTED' && !result.replayed) {
      await authChallenges.delete(sessionId);
      try { broadcastOrderSuccess(session.orderId, { amount: session.baseAmount, baseAmount: session.baseAmount, vpaAddress: session.vpa_address || MERCHANT_UPI_ID, senderVpa: null, utr: cleanUtr, txId: result.txId, timestamp: now }); } catch (_) {}
      return res.json({
        success: true,
        verified: true,
        settled: true,
        orderId,
        utr: cleanUtr,
        txId: result.txId,
        amount: session.challengeAmount,
        state: 'SETTLED',
        message: 'Payment settled via Vault + UTR.'
      });
    }
    if (result.state === 'QUARANTINED') {
      return res.status(202).json({
        success: false,
        verified: false,
        settled: false,
        state: 'QUARANTINED',
        orderId,
        utr: cleanUtr,
        reason: result.reason,
        message: 'Settlement quarantined - manual review required.'
      });
    }
    if (result.state === 'CONFLICTING_EVIDENCE') {
      return res.status(409).json({
        success: false,
        verified: false,
        settled: false,
        state: 'CONFLICTING_EVIDENCE',
        orderId,
        utr: cleanUtr,
        error: 'UTR_CLAIM_REPLAY'
      });
    }
    return res.status(500).json({ success: false, error: 'SETTLEMENT_FAILED' });
  } catch (err) {
    console.error('[UPI Finalize] Error:', err);
    return res.status(500).json({ success: false, error: 'FINALIZE_UNAVAILABLE' });
  }
});
// ═════════════════════════════════════════════════════════════════════
// TASK 15: DEBUG / DIAGNOSTIC ENDPOINTS — Full flow trace for testing
// These let you see every step of the UPI rail and exactly where it fails.
// ═════════════════════════════════════════════════════════════════════
// All debug endpoints require admin authentication (X-Admin-Key header).
// Step-by-step flow trace for an order
app.get('/api/debug/flow/:orderId', requireAdminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const session = await db.findSessionByOrderId(orderId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: `No session exists for orderId: ${orderId}`
      });
    }

    const stored = await authChallenges.get(session.sessionId);
    const cooldown = await db.checkSessionCooldown(orderId);
    const velocity = await db.checkVpaVelocity(session.vpaAddress);
    const boundOrder = await db.getUtrBoundOrder(session.utr || '');

    const steps = [
      { step: 1, name: 'Session Created', status: session.status, detail: `orderId=${session.orderId}, vpa=${session.vpaAddress}, amount=₹${session.challengeAmount}, createdAt=${new Date(session.createdAt).toISOString()}` },
      { step: 2, name: 'Vault Authentication', status: stored ? (stored.status || 'NOT_STARTED') : 'NOT_STARTED', detail: stored ? `sessionId=${session.sessionId}, orderId matches=${stored.orderId === orderId}, vaultVerified=${stored.status === 'VAULT_VERIFIED_AWAITING_UPI'}` : 'No WebAuthn challenge found for this session' },
      { step: 3, name: 'VPA Velocity Check', status: velocity ? 'OK' : 'LIMIT_EXCEEDED', detail: `vpa=${session.vpaAddress}, under hourly limit=${velocity}` },
      { step: 4, name: 'Cancellation Cooldown', status: cooldown.inCooldown ? 'ACTIVE' : 'CLEAR', detail: cooldown.inCooldown ? `remaining=${cooldown.secondsRemaining}s` : 'No cooldown active' },
      { step: 5, name: 'UTR Binding', status: session.utr ? 'BOUND' : 'NOT_BOUND', detail: session.utr ? `utr=${session.utr}, boundToOrder=${boundOrder}` : 'No UTR submitted yet' },
      { step: 6, name: 'Ledger Settlement', status: session.status, detail: `status=${session.status}, state=${session.state}, utr=${session.utr || 'none'}` }
    ];

    return res.json({
      success: true,
      orderId,
      session,
      vaultState: stored || null,
      cooldown,
      velocityUnderLimit: velocity,
      utrBoundOrder: boundOrder || null,
      steps,
      flowSummary: steps.map(s => `Step ${s.step} [${s.name}]: ${s.status}`).join(' | ')
    });
  } catch (err) {
    console.error('Debug flow error:', err);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Full session state dump
app.get('/api/debug/session/:orderId', requireAdminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const session = await db.findSessionByOrderId(orderId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });
    }
    return res.json({
      success: true,
      session,
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// List all VPAs with velocity status
app.get('/api/debug/vpas', requireAdminAuth, async (req, res) => {
  try {
    const vpas = db.getAllActiveVPAs ? await db.getAllActiveVPAs() : [];
    const now = Date.now();
    const hourBucket = Math.floor(now / (60 * 60 * 1000));
    const vpaStatus = await Promise.all(vpas.map(async v => {
      const currentCount = db.isPostgres && process.env.DB_BACKEND === 'postgres'
        ? await db.getVpaHourlyCount(v.vpa_address)
        : (db.sqliteDb.prepare(
          `SELECT count FROM vpa_hourly_txns WHERE vpa_address = ? AND hour_bucket = ?`
        ).get(v.vpa_address, hourBucket)?.count || 0);
      return {
        vpa: v.vpa_address,
        holder: v.holder_name,
        bank: v.bank_name,
        accountType: v.account_type,
        healthScore: v.health_score,
        hourlyCount: currentCount,
        hourlyLimit: 15,
        underLimit: currentCount < 15,
        status: v.status
      };
    }));
    return res.json({ success: true, vpaz: vpaStatus, timestamp: now });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});
// ═════════════════════════════════════════════════════════════════════

// TASK 7: ANDROID WEB SHARE TARGET (SINGLE SOURCE OF TRUTH SETTLEMENT)
// ═══════════════════════════════════════════════════════════════════
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
    // This public endpoint has no authenticated NPCI delivery signature.
    // Even responseCode=00 is a customer-origin claim, not a confirmed credit.
    return res.status(202).json({
      success: true, verified: false,
      status: 'UTR_OBSERVED',
      responseCode: parsed.responseCode || '00',
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
  // Production never exposes a simulated payment or fabricated ledger posting.
  if (process.env.NODE_ENV !== 'test' || process.env.DISHA_TEST_SIMULATION !== '1') return res.status(404).json({success:false,error:'NOT_FOUND'});
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
  const session = await db.findSessionByOrderId(orderId);
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
  await db.blacklistUtr(mockUtr, session.orderId, session.challengeAmount, 'Simulated payment');
  await db.updateSessionStatus(session.orderId, 'SUCCESS', mockUtr);
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
app.get('/api/ledger/:orderId', async (req, res) => {
  const session = await db.findSessionByOrderId(req.params.orderId);
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
app.post('/api/vpa/quarantine', requireAdminAuth, async (req, res) => {
  try {
    const { vpaId, reason } = req.body;
    if (!vpaId) {
      return res.status(400).json({ success: false, error: 'vpaId is required' });
    }
    const result = await db.vpaRouter.quarantineVPA(vpaId, reason || 'Bank warning / emergency freeze');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// 4. Pool analytics & bank diversity breakdown
app.get('/api/vpa/analytics', requireAdminAuth, async (req, res) => {
  try {
    const merchantId = req.query.merchantId || 'mer_default';
    const analytics = await db.vpaRouter.getPoolAnalytics(merchantId);
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});
// 5. Daily health reset & rebalance (6 AM Cron trigger)
app.post('/api/vpa/health-check', requireAdminAuth, async (req, res) => {
  try {
    const result = await db.vpaRouter.dailyHealthResetAndRebalance();
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
app.post('/api/gaming/verify-payment', (req,res) => {
  // Disabled financial posting from unauthenticated UTR claims.
  // No bank API is introduced: merchants retain P2P UTR order matching.
  return res.status(409).json({
    success:false, verified:false, state:'UNVERIFIED_UTR',
    error:'UTR_CLAIM_NOT_CREDIT_CONFIRMATION'
  });
});
// Route fallbacks
app.get('/success', async (req, res) => {
  const { orderId, token } = req.query;
  if (!orderId || !token) {
    return res.redirect('/failed?reason=missing_session_token');
  }
  const session = await db.findSessionByOrderId(orderId);
  if (!session || !safeCompareKeys(token, session.sessionId)) {
    return res.redirect('/failed?reason=invalid_session_token');
  }
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});
app.get('/failed', (req, res) => res.sendFile(path.join(__dirname, 'public', 'failed.html')));
// Initialize database and start server
(async () => {
  await db.initDb();
  await initializeChallengeStore(db.pgPool);
  if(db.pgPool)await checkoutDiagnostics.init();
  if (db.pgPool && CLERK_ENABLED){ await merchantApi.init(); await platformControl.init(); }
  if(db.pgPool) {
    await initializeVaultEvidenceSchema(db.pgPool);
    await initializeQuantumSignal(db.pgPool);
    await initUpiAppEvidenceReplay(db.pgPool);
    await initTimedStore(db.pgPool);
    await initPayerPartnerDebit(db.pgPool);
    await initSmsDebitRelay(db.pgPool);
    if(sellerEvidencePilot){
      if(!/^[A-Za-z0-9_-]{6,150}$/.test(pilotOrderId))
        throw Error('SELLER_PILOT_ORDER_ID_REQUIRED');
      // The pilot is bound to one explicit order to prevent cross-merchant
      // webhook delivery until DISHA has a trusted seller routing registry.
      const dest=validatedDestination({
       url:process.env.DISHA_SELLER_EVIDENCE_WEBHOOK_URL,
       secret:process.env.DISHA_SELLER_EVIDENCE_WEBHOOK_SECRET
      });
      await initializeOutbox(db.pgPool);
      let delivering=false;
      const deliver=async()=>{
       if(delivering)return;
       delivering=true;
       try{await deliverNext({pool:db.pgPool,
         destination:async orderId=>{
          if(orderId!==pilotOrderId)throw Error('SELLER_ORDER_DESTINATION_MISMATCH');
          return dest;
         }});
       }catch(_){/* Subsequent worker tick retries; no private payload logging. */}
       finally{delivering=false}
      };
      const deliveryTimer=setInterval(()=>{void deliver()},15000);
      deliveryTimer.unref?.();
      void deliver();
    }
    await initDebitCredentialSchema(db.pgPool);
    if(process.env.DISHA_PROOFBRIDGE_EXPERIMENT==='1')await initProofBridgeSchema(db.pgPool);
    await initializeClaimObserver(db.pgPool);
  }
  if(process.env.RECONCILIATION_WEBHOOK_SECRET && process.env.RECONCILIATION_SOURCE_ID){
    if(!db.pgPool || !CLERK_ENABLED)throw new Error('Reconciliation requires PostgreSQL and merchant tenant tables');
    await initializeReconciliationSchema(db.pgPool);
  }
  // Daily cron at 00:05 to reset daily VPA limits
  setInterval(async () => {
    const d = new Date();
    if (d.getHours() === 0 && d.getMinutes() === 5) {
      await db.resetDailyVPAs();
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



