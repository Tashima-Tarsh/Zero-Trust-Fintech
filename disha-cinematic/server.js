const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const db = require('./db');

const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.csv': 'text/csv; charset=utf-8'
};

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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message, details = null) {
  sendJson(res, statusCode, { error: message, details });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { // 1MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function authenticateRequest(req) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else {
    const cookies = parseCookies(req.headers['cookie']);
    token = cookies.disha_session;
  }

  if (!token) return null;
  return db.validateSession(token);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // =========================================================================
  // API ROUTES
  // =========================================================================
  if (pathname.startsWith('/api/')) {
    try {
      // 1. Auth: Login
      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await readBody(req);
        const { email, password } = body;

        if (!email || !password) {
          return sendError(res, 400, 'Email/Login ID and password are required');
        }

        const merchant = db.findMerchantByEmail(email);
        if (!merchant) {
          return sendError(res, 401, 'Invalid email or password');
        }

        const isValid = db.verifyPassword(password, merchant.password_hash);
        if (!isValid) {
          return sendError(res, 401, 'Invalid email or password');
        }

        const session = db.createSession(merchant.id);
        const safeMerchant = db.findMerchantById(merchant.id);

        res.setHeader('Set-Cookie', `disha_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        return sendJson(res, 200, {
          success: true,
          token: session.token,
          expiresAt: session.expiresAt,
          merchant: safeMerchant
        });
      }

      // 2. Auth: Logout
      if (pathname === '/api/auth/logout' && method === 'POST') {
        let token = null;
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7).trim();
        } else {
          const cookies = parseCookies(req.headers['cookie']);
          token = cookies.disha_session;
        }

        if (token) {
          db.deleteSession(token);
        }

        res.setHeader('Set-Cookie', 'disha_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return sendJson(res, 200, { success: true, message: 'Logged out successfully' });
      }

      // 3. Auth: Current User Profile
      if (pathname === '/api/auth/me' && method === 'GET') {
        const merchant = authenticateRequest(req);
        if (!merchant) {
          return sendError(res, 401, 'Unauthorized session. Please log in.');
        }
        return sendJson(res, 200, { success: true, merchant });
      }

      // --- PROTECTED MERCHANT ROUTES ---
      const currentMerchant = authenticateRequest(req);
      if (!currentMerchant) {
        return sendError(res, 401, 'Authentication required to access merchant workspace');
      }

      // First-time Onboarding Setup
      if (pathname === '/api/merchant/setup' && method === 'POST') {
        const body = await readBody(req);
        const { businessName, contactPhone, city, primaryVpa, soundboxEnabled, soundboxLang } = body;

        if (!businessName || !businessName.trim()) {
          return sendError(res, 400, 'Business / display name is required');
        }

        if (!primaryVpa || !primaryVpa.trim()) {
          return sendError(res, 400, 'Primary settlement UPI ID is required');
        }

        const vpaClean = primaryVpa.trim().toLowerCase();
        const vpaRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!vpaRegex.test(vpaClean)) {
          return sendError(res, 400, 'Invalid UPI ID format. Expected format: username@bank (e.g. store@okaxis)');
        }

        const updated = db.completeSetup(currentMerchant.id, {
          businessName: businessName.trim(),
          contactPhone: (contactPhone || '').trim(),
          city: (city || '').trim(),
          primaryVpa: vpaClean,
          soundboxEnabled: soundboxEnabled !== false,
          soundboxLang: soundboxLang || 'en'
        });

        return sendJson(res, 200, { success: true, merchant: updated });
      }

      // Dashboard Overview Data
      if (pathname === '/api/merchant/dashboard' && method === 'GET') {
        const dateFilter = parsedUrl.searchParams.get('dateFilter') || '30d';
        const data = db.getMerchantDashboardData(currentMerchant.id, dateFilter);
        return sendJson(res, 200, { success: true, ...data, merchant: currentMerchant });
      }

      // Payments: List / Filter
      if (pathname === '/api/merchant/payments' && method === 'GET') {
        const status = parsedUrl.searchParams.get('status') || 'ALL';
        const search = parsedUrl.searchParams.get('search') || '';
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);

        const orders = db.getMerchantOrders(currentMerchant.id, { status, search, limit });
        return sendJson(res, 200, { success: true, orders });
      }

      // Payments: Create Payment / Link
      if (pathname === '/api/merchant/payments' && method === 'POST') {
        const body = await readBody(req);
        const { amount, description, vpaAddress } = body;

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          return sendError(res, 400, 'Valid positive payment amount is required');
        }

        const order = db.createMerchantOrder(currentMerchant.id, {
          amount: parseFloat(amount),
          description: description || '',
          vpaAddress: vpaAddress || null
        });

        return sendJson(res, 201, { success: true, order });
      }

      // Payments: Test Simulator (Mark payment completed in test mode)
      const simulateMatch = pathname.match(/^\/api\/merchant\/payments\/([^/]+)\/simulate$/);
      if (simulateMatch && method === 'POST') {
        const orderId = simulateMatch[1];
        const body = await readBody(req);
        const completedOrder = db.simulateOrderPayment(currentMerchant.id, orderId, body.utr);
        return sendJson(res, 200, { success: true, order: completedOrder });
      }

      // UPI IDs: List
      if (pathname === '/api/merchant/vpas' && method === 'GET') {
        const vpas = db.getMerchantVPAs(currentMerchant.id);
        return sendJson(res, 200, { success: true, vpas });
      }

      // UPI IDs: Add
      if (pathname === '/api/merchant/vpas' && method === 'POST') {
        const body = await readBody(req);
        const { vpaAddress, bankName } = body;

        if (!vpaAddress || !vpaAddress.trim()) {
          return sendError(res, 400, 'UPI address is required');
        }

        const vpaClean = vpaAddress.trim().toLowerCase();
        const vpaRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!vpaRegex.test(vpaClean)) {
          return sendError(res, 400, 'Invalid UPI ID format. Expected format: username@bank');
        }

        const newVpa = db.addMerchantVPA(currentMerchant.id, vpaClean, bankName);
        return sendJson(res, 201, { success: true, vpa: newVpa });
      }

      // UPI IDs: Action (pause / resume / set_default)
      const vpaMatch = pathname.match(/^\/api\/merchant\/vpas\/([^/]+)$/);
      if (vpaMatch && method === 'PATCH') {
        const vpaId = vpaMatch[1];
        const body = await readBody(req);
        const { action } = body;

        if (action === 'set_default') {
          const vpas = db.setDefaultVPA(currentMerchant.id, vpaId);
          return sendJson(res, 200, { success: true, vpas });
        } else if (action === 'pause') {
          const vpa = db.updateVPAStatus(currentMerchant.id, vpaId, 'PAUSED');
          return sendJson(res, 200, { success: true, vpa });
        } else if (action === 'resume') {
          const vpa = db.updateVPAStatus(currentMerchant.id, vpaId, 'ACTIVE');
          return sendJson(res, 200, { success: true, vpa });
        } else {
          return sendError(res, 400, 'Invalid action. Supported: set_default, pause, resume');
        }
      }

      if (vpaMatch && method === 'DELETE') {
        const vpaId = vpaMatch[1];
        db.deleteVPA(currentMerchant.id, vpaId);
        return sendJson(res, 200, { success: true, message: 'UPI ID removed' });
      }

      // Reports: Summary & CSV Export
      if (pathname === '/api/merchant/reports' && method === 'GET') {
        const dateFilter = parsedUrl.searchParams.get('dateFilter') || '30d';
        const format = parsedUrl.searchParams.get('format') || 'json';

        const dashboardData = db.getMerchantDashboardData(currentMerchant.id, dateFilter);
        const orders = db.getMerchantOrders(currentMerchant.id, { limit: 500 });

        if (format === 'csv') {
          let csv = 'Order ID,Date,Amount (INR),UPI ID,UTR,Status,Description\n';
          for (const o of orders) {
            const dateStr = new Date(o.created_at).toISOString();
            const desc = (o.description || '').replace(/"/g, '""');
            csv += `"${o.id}","${dateStr}",${o.amount.toFixed(2)},"${o.vpa_address}","${o.utr || ''}","${o.status}","${desc}"\n`;
          }

          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="disha_merchant_report_${currentMerchant.id}_${dateFilter}.csv"`,
            'Cache-Control': 'no-cache'
          });
          res.end(csv);
          return;
        }

        return sendJson(res, 200, {
          success: true,
          dateFilter,
          metrics: dashboardData.metrics,
          orders
        });
      }

      // Notifications
      if (pathname === '/api/merchant/notifications' && method === 'GET') {
        const notifs = db.getMerchantNotifications(currentMerchant.id);
        return sendJson(res, 200, { success: true, notifications: notifs });
      }

      if (pathname === '/api/merchant/notifications/read' && method === 'POST') {
        db.markNotificationsRead(currentMerchant.id);
        return sendJson(res, 200, { success: true });
      }

      // Profile & Settings
      if (pathname === '/api/merchant/profile' && method === 'PUT') {
        const body = await readBody(req);
        const updated = db.updateMerchantProfile(currentMerchant.id, body);
        return sendJson(res, 200, { success: true, merchant: updated });
      }

      if (pathname === '/api/merchant/change-password' && method === 'POST') {
        const body = await readBody(req);
        const { currentPassword, newPassword } = body;
        if (!currentPassword || !newPassword) {
          return sendError(res, 400, 'Current password and new password are required');
        }
        if (newPassword.length < 8) {
          return sendError(res, 400, 'New password must be at least 8 characters long');
        }
        db.updateMerchantPassword(currentMerchant.id, currentPassword, newPassword);
        return sendJson(res, 200, { success: true, message: 'Password updated successfully' });
      }

      return sendError(res, 404, 'API endpoint not found');
    } catch (apiErr) {
      console.error('API Error:', apiErr);
      return sendError(res, 500, apiErr.message || 'Internal server error');
    }
  }

  // =========================================================================
  // STATIC PAGE & ASSET SERVING
  // =========================================================================
  let reqPath = pathname;

  // Pretty URL mappings
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  } else if (reqPath === '/login' || reqPath === '/login/') {
    reqPath = '/login.html';
  } else if (reqPath === '/setup' || reqPath === '/setup/') {
    reqPath = '/setup.html';
  } else if (reqPath === '/dashboard' || reqPath === '/dashboard/') {
    reqPath = '/dashboard.html';
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 Not Found</h1><p><a href="/">Return to DISHA Home</a></p>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`============================================================`);
  console.log(`🚀 DISHA Merchant SaaS Platform running on:`);
  console.log(`   > Public Website:     http://localhost:${PORT}/`);
  console.log(`   > Merchant Login:     http://localhost:${PORT}/login`);
  console.log(`   > First-Time Setup:   http://localhost:${PORT}/setup`);
  console.log(`   > Merchant Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`============================================================`);
});
