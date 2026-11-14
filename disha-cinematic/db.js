const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'disha.db');
const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    business_name TEXT,
    contact_phone TEXT,
    city TEXT,
    primary_vpa TEXT,
    setup_completed INTEGER DEFAULT 0,
    soundbox_enabled INTEGER DEFAULT 1,
    soundbox_lang TEXT DEFAULT 'en',
    soundbox_volume INTEGER DEFAULT 80,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS merchant_vpas (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    vpa_address TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS merchant_orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    vpa_address TEXT NOT NULL,
    upi_uri TEXT NOT NULL,
    utr TEXT,
    status TEXT DEFAULT 'PENDING',
    created_at INTEGER NOT NULL,
    settled_at INTEGER,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS merchant_notifications (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
  );
`);

// Password hashing utilities using PBKDF2-HMAC-SHA256 (NIST compliant)
function hashPassword(password) {
  if (!password || typeof password !== 'string') throw new Error('Password must be a non-empty string');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2_sha256') return false;
  const [, salt, expectedHash] = parts;
  const computedHash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch (_) {
    return false;
  }
}

// Session Token Generation
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Merchant functions
function createMerchant({ email, password, businessName = '', phone = '', city = '', primaryVpa = '', setupCompleted = 0 }) {
  const id = 'm_' + crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  const passwordHash = hashPassword(password);

  const stmt = db.prepare(`
    INSERT INTO merchants (id, email, password_hash, business_name, contact_phone, city, primary_vpa, setup_completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, email.toLowerCase().trim(), passwordHash, businessName, phone, city, primaryVpa, setupCompleted ? 1 : 0, now, now);

  if (primaryVpa) {
    const vpaId = 'vpa_' + crypto.randomBytes(6).toString('hex');
    const bank = primaryVpa.includes('@') ? primaryVpa.split('@')[1].toUpperCase() : 'UPI';
    const vpaStmt = db.prepare(`
      INSERT INTO merchant_vpas (id, merchant_id, vpa_address, bank_name, is_default, status, created_at)
      VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?)
    `);
    vpaStmt.run(vpaId, id, primaryVpa, bank, now);
  }

  // Welcome notification
  const notifId = 'notif_' + crypto.randomBytes(6).toString('hex');
  const notifStmt = db.prepare(`
    INSERT INTO merchant_notifications (id, merchant_id, title, message, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  notifStmt.run(notifId, id, 'Account Activated', 'Welcome to DISHA Sovereign Merchant Console. Your secure payments gateway is ready.', now);

  return findMerchantById(id);
}

function findMerchantByEmail(email) {
  if (!email) return null;
  const stmt = db.prepare('SELECT * FROM merchants WHERE email = ?');
  return stmt.get(email.toLowerCase().trim()) || null;
}

function findMerchantById(id) {
  if (!id) return null;
  const stmt = db.prepare('SELECT id, email, business_name, contact_phone, city, primary_vpa, setup_completed, soundbox_enabled, soundbox_lang, soundbox_volume, created_at FROM merchants WHERE id = ?');
  return stmt.get(id) || null;
}

function createSession(merchantId) {
  const token = generateToken();
  const now = Date.now();
  const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours expiry
  const stmt = db.prepare('INSERT INTO sessions (token, merchant_id, expires_at, created_at) VALUES (?, ?, ?, ?)');
  stmt.run(token, merchantId, expiresAt, now);
  return { token, expiresAt };
}

function validateSession(token) {
  if (!token) return null;
  const now = Date.now();
  const stmt = db.prepare('SELECT merchant_id, expires_at FROM sessions WHERE token = ?');
  const session = stmt.get(token);
  if (!session) return null;
  if (session.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return findMerchantById(session.merchant_id);
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function completeSetup(merchantId, { businessName, contactPhone, city, primaryVpa, soundboxEnabled = true, soundboxLang = 'en' }) {
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE merchants
    SET business_name = ?, contact_phone = ?, city = ?, primary_vpa = ?, setup_completed = 1, soundbox_enabled = ?, soundbox_lang = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(businessName, contactPhone, city, primaryVpa, soundboxEnabled ? 1 : 0, soundboxLang, now, merchantId);

  // Add primary VPA to list if not already added
  if (primaryVpa) {
    const existing = db.prepare('SELECT id FROM merchant_vpas WHERE merchant_id = ? AND vpa_address = ?').get(merchantId, primaryVpa);
    if (!existing) {
      const vpaId = 'vpa_' + crypto.randomBytes(6).toString('hex');
      const bank = primaryVpa.includes('@') ? primaryVpa.split('@')[1].toUpperCase() : 'UPI';
      db.prepare(`
        INSERT INTO merchant_vpas (id, merchant_id, vpa_address, bank_name, is_default, status, created_at)
        VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?)
      `).run(vpaId, merchantId, primaryVpa, bank, now);
    }
  }

  // Create notification
  const notifId = 'notif_' + crypto.randomBytes(6).toString('hex');
  db.prepare(`
    INSERT INTO merchant_notifications (id, merchant_id, title, message, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(notifId, merchantId, 'Setup Completed', `Your business profile "${businessName}" and primary UPI ID have been successfully initialized.`, now);

  return findMerchantById(merchantId);
}

function updateMerchantProfile(merchantId, { businessName, contactPhone, city, soundboxEnabled, soundboxLang, soundboxVolume }) {
  const now = Date.now();
  const current = findMerchantById(merchantId);
  if (!current) return null;

  const stmt = db.prepare(`
    UPDATE merchants
    SET business_name = ?, contact_phone = ?, city = ?, soundbox_enabled = ?, soundbox_lang = ?, soundbox_volume = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    businessName !== undefined ? businessName : current.business_name,
    contactPhone !== undefined ? contactPhone : current.contact_phone,
    city !== undefined ? city : current.city,
    soundboxEnabled !== undefined ? (soundboxEnabled ? 1 : 0) : current.soundbox_enabled,
    soundboxLang !== undefined ? soundboxLang : current.soundbox_lang,
    soundboxVolume !== undefined ? soundboxVolume : current.soundbox_volume,
    now,
    merchantId
  );
  return findMerchantById(merchantId);
}

function updateMerchantPassword(merchantId, currentPassword, newPassword) {
  const stmt = db.prepare('SELECT password_hash FROM merchants WHERE id = ?');
  const row = stmt.get(merchantId);
  if (!row) throw new Error('Merchant not found');

  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new Error('Current password does not match');
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE merchants SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, Date.now(), merchantId);
  return true;
}

// VPA Management
function getMerchantVPAs(merchantId) {
  const stmt = db.prepare('SELECT id, vpa_address, bank_name, is_default, status, created_at FROM merchant_vpas WHERE merchant_id = ? ORDER BY is_default DESC, created_at DESC');
  return stmt.all(merchantId);
}

function addMerchantVPA(merchantId, vpaAddress, bankName = '') {
  const normalized = vpaAddress.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM merchant_vpas WHERE merchant_id = ? AND vpa_address = ?').get(merchantId, normalized);
  if (existing) throw new Error('This UPI ID is already added to your workspace');

  const vpaId = 'vpa_' + crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  const derivedBank = bankName || (normalized.includes('@') ? normalized.split('@')[1].toUpperCase() : 'UPI');

  const count = db.prepare('SELECT COUNT(*) as count FROM merchant_vpas WHERE merchant_id = ?').get(merchantId).count;
  const isDefault = count === 0 ? 1 : 0;

  db.prepare(`
    INSERT INTO merchant_vpas (id, merchant_id, vpa_address, bank_name, is_default, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
  `).run(vpaId, merchantId, normalized, derivedBank, isDefault, now);

  // If this is default, update merchant primary_vpa
  if (isDefault) {
    db.prepare('UPDATE merchants SET primary_vpa = ? WHERE id = ?').run(normalized, merchantId);
  }

  return db.prepare('SELECT id, vpa_address, bank_name, is_default, status, created_at FROM merchant_vpas WHERE id = ?').get(vpaId);
}

function updateVPAStatus(merchantId, vpaId, status) {
  db.prepare('UPDATE merchant_vpas SET status = ? WHERE id = ? AND merchant_id = ?').run(status, vpaId, merchantId);
  return db.prepare('SELECT id, vpa_address, bank_name, is_default, status, created_at FROM merchant_vpas WHERE id = ?').get(vpaId);
}

function setDefaultVPA(merchantId, vpaId) {
  const vpa = db.prepare('SELECT vpa_address FROM merchant_vpas WHERE id = ? AND merchant_id = ?').get(vpaId, merchantId);
  if (!vpa) throw new Error('VPA not found');

  db.prepare('UPDATE merchant_vpas SET is_default = 0 WHERE merchant_id = ?').run(merchantId);
  db.prepare('UPDATE merchant_vpas SET is_default = 1 WHERE id = ?').run(vpaId);
  db.prepare('UPDATE merchants SET primary_vpa = ? WHERE id = ?').run(vpa.vpa_address, merchantId);

  return getMerchantVPAs(merchantId);
}

function deleteVPA(merchantId, vpaId) {
  const vpa = db.prepare('SELECT is_default, vpa_address FROM merchant_vpas WHERE id = ? AND merchant_id = ?').get(vpaId, merchantId);
  if (!vpa) throw new Error('VPA not found');
  if (vpa.is_default) {
    const total = db.prepare('SELECT COUNT(*) as count FROM merchant_vpas WHERE merchant_id = ?').get(merchantId).count;
    if (total > 1) {
      throw new Error('Cannot delete default UPI ID. Please set another UPI ID as default first.');
    }
  }
  db.prepare('DELETE FROM merchant_vpas WHERE id = ? AND merchant_id = ?').run(vpaId, merchantId);
  return true;
}

// Orders and Payments
function createMerchantOrder(merchantId, { amount, description = '', vpaAddress = null }) {
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Valid positive amount is required');
  }

  const merchant = findMerchantById(merchantId);
  if (!merchant) throw new Error('Merchant not found');

  let chosenVpa = vpaAddress;
  if (!chosenVpa) {
    const defaultVpa = db.prepare("SELECT vpa_address FROM merchant_vpas WHERE merchant_id = ? AND is_default = 1 AND status = 'ACTIVE'").get(merchantId);
    chosenVpa = defaultVpa ? defaultVpa.vpa_address : merchant.primary_vpa;
  }

  if (!chosenVpa) {
    throw new Error('No active UPI ID found. Please add a UPI ID in settings first.');
  }

  const orderId = 'ORD_' + Date.now().toString(36).toUpperCase() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const businessName = merchant.business_name || 'Merchant';
  const encodedName = encodeURIComponent(businessName);
  const upiUri = `upi://pay?pa=${chosenVpa}&pn=${encodedName}&am=${parsedAmount.toFixed(2)}&cu=INR&tr=${orderId}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO merchant_orders (id, merchant_id, amount, description, vpa_address, upi_uri, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(orderId, merchantId, parsedAmount, description, chosenVpa, upiUri, now);

  return db.prepare('SELECT * FROM merchant_orders WHERE id = ?').get(orderId);
}

function simulateOrderPayment(merchantId, orderId, customUtr = null) {
  const order = db.prepare('SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?').get(orderId, merchantId);
  if (!order) throw new Error('Order not found');
  if (order.status === 'COMPLETED') return order;

  const now = Date.now();
  // Generate realistic NPCI 12-digit UTR (YearDigit + JulianDay + Hour + Random)
  const istDate = new Date(now + (5.5 * 3600 * 1000));
  const yearDigit = istDate.getUTCFullYear() % 10;
  const startOfYear = new Date(Date.UTC(istDate.getUTCFullYear(), 0, 1));
  const julianDay = String(Math.floor((istDate - startOfYear) / (24 * 3600 * 1000)) + 1).padStart(3, '0');
  const hour = String(istDate.getUTCHours()).padStart(2, '0');
  const rand6 = String(Math.floor(100000 + Math.random() * 900000));
  const generatedUtr = customUtr || `${yearDigit}${julianDay}${hour}${rand6}`;

  db.prepare(`
    UPDATE merchant_orders
    SET status = 'COMPLETED', utr = ?, settled_at = ?
    WHERE id = ? AND merchant_id = ?
  `).run(generatedUtr, now, orderId, merchantId);

  // Add notification
  const notifId = 'notif_' + crypto.randomBytes(6).toString('hex');
  db.prepare(`
    INSERT INTO merchant_notifications (id, merchant_id, title, message, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    notifId,
    merchantId,
    'Payment Received',
    `₹${order.amount.toFixed(2)} received for ${order.id}. UTR: ${generatedUtr}`,
    now
  );

  return db.prepare('SELECT * FROM merchant_orders WHERE id = ?').get(orderId);
}

function getMerchantOrders(merchantId, { status, search, limit = 50, fromTimestamp, toTimestamp }) {
  let query = 'SELECT * FROM merchant_orders WHERE merchant_id = ?';
  const params = [merchantId];

  if (status && status !== 'ALL') {
    query += ' AND status = ?';
    params.push(status);
  }

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ' AND (id LIKE ? OR utr LIKE ? OR description LIKE ? OR vpa_address LIKE ?)';
    params.push(s, s, s, s);
  }

  if (fromTimestamp) {
    query += ' AND created_at >= ?';
    params.push(fromTimestamp);
  }

  if (toTimestamp) {
    query += ' AND created_at <= ?';
    params.push(toTimestamp);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params);
}

function getMerchantDashboardData(merchantId, dateFilter = '30d') {
  const now = Date.now();
  let fromTimestamp = 0;

  if (dateFilter === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    fromTimestamp = today.getTime();
  } else if (dateFilter === '7d') {
    fromTimestamp = now - (7 * 24 * 3600 * 1000);
  } else if (dateFilter === '30d') {
    fromTimestamp = now - (30 * 24 * 3600 * 1000);
  }

  // Scoped orders
  const orders = db.prepare(`
    SELECT * FROM merchant_orders 
    WHERE merchant_id = ? AND created_at >= ?
    ORDER BY created_at DESC
  `).all(merchantId, fromTimestamp);

  let totalVolume = 0;
  let completedCount = 0;
  let pendingCount = 0;
  let expiredCount = 0;

  for (const o of orders) {
    if (o.status === 'COMPLETED') {
      totalVolume += o.amount;
      completedCount++;
    } else if (o.status === 'PENDING') {
      pendingCount++;
    } else {
      expiredCount++;
    }
  }

  const totalTxns = orders.length;
  const successRate = totalTxns > 0 ? ((completedCount / totalTxns) * 100).toFixed(1) : '100.0';
  const savedMdr = (totalVolume * 0.0236).toFixed(2); // Typical 2% gateway + 18% GST savings
  const avgTicket = completedCount > 0 ? (totalVolume / completedCount).toFixed(2) : '0.00';

  // Recent 10 transactions
  const recentTransactions = orders.slice(0, 10);

  // Active VPAs
  const vpas = getMerchantVPAs(merchantId);

  // Group volume by last 7 intervals for chart
  const chartData = [];
  const days = dateFilter === 'today' ? 6 : (dateFilter === '7d' ? 7 : 7);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - (i * 24 * 3600 * 1000));
    const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + (24 * 3600 * 1000);

    const dayVolume = orders
      .filter(o => o.status === 'COMPLETED' && o.created_at >= dayStart && o.created_at < dayEnd)
      .reduce((sum, o) => sum + o.amount, 0);

    chartData.push({ label, amount: dayVolume });
  }

  return {
    metrics: {
      totalVolume: totalVolume.toFixed(2),
      totalTransactions: totalTxns,
      completedTransactions: completedCount,
      pendingTransactions: pendingCount,
      successRate: parseFloat(successRate),
      feesSaved: parseFloat(savedMdr),
      averageTicket: parseFloat(avgTicket)
    },
    recentTransactions,
    chartData,
    vpas,
    unreadNotifications: db.prepare('SELECT COUNT(*) as count FROM merchant_notifications WHERE merchant_id = ? AND is_read = 0').get(merchantId).count
  };
}

function getMerchantNotifications(merchantId) {
  return db.prepare('SELECT * FROM merchant_notifications WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 30').all(merchantId);
}

function markNotificationsRead(merchantId) {
  db.prepare('UPDATE merchant_notifications SET is_read = 1 WHERE merchant_id = ?').run(merchantId);
  return true;
}

// Initial Seed: Pre-provisions Ramesh Kirana & a brand new fresh merchant for onboarding testing
function seedDefaultMerchants() {
  const existingRamesh = findMerchantByEmail('ramesh@kirana.in');
  if (!existingRamesh) {
    console.log('Seeding pre-configured merchant: ramesh@kirana.in / Ramesh@123');
    const ramesh = createMerchant({
      email: 'ramesh@kirana.in',
      password: 'Ramesh@123',
      businessName: 'Ramesh Provision Stores',
      phone: '9822012345',
      city: 'Narayan Peth, Pune',
      primaryVpa: 'ramesh.store@okaxis',
      setupCompleted: 1
    });

    // Add secondary backup VPA
    addMerchantVPA(ramesh.id, 'ramesh.pune@ybl', 'YES Bank');

    // Seed realistic historic transactions for Ramesh
    const now = Date.now();
    const txData = [
      { amt: 1249.00, desc: 'Monthly Grocery & Cooking Oil', hoursAgo: 2, status: 'COMPLETED' },
      { amt: 450.00, desc: 'Atta 10kg & Tea Leaves', hoursAgo: 5, status: 'COMPLETED' },
      { amt: 890.50, desc: 'Basmati Rice & Spices', hoursAgo: 14, status: 'COMPLETED' },
      { amt: 2100.00, desc: 'Wholesale Dry Fruits Order', hoursAgo: 26, status: 'COMPLETED' },
      { amt: 350.00, desc: 'Detergent & Soaps', hoursAgo: 38, status: 'COMPLETED' },
      { amt: 620.00, desc: 'Snacks & Beverages', hoursAgo: 50, status: 'COMPLETED' },
      { amt: 1500.00, desc: 'Ghee & Dairy Hampers', hoursAgo: 72, status: 'COMPLETED' },
      { amt: 250.00, desc: 'Daily Staples', hoursAgo: 1, status: 'PENDING' }
    ];

    for (const t of txData) {
      const orderId = 'ORD_' + (now - t.hoursAgo * 3600 * 1000).toString(36).toUpperCase() + '_' + crypto.randomBytes(2).toString('hex').toUpperCase();
      const upiUri = `upi://pay?pa=ramesh.store@okaxis&pn=Ramesh%20Provision%20Stores&am=${t.amt.toFixed(2)}&cu=INR&tr=${orderId}`;
      const createdAt = now - (t.hoursAgo * 3600 * 1000);
      const settledAt = t.status === 'COMPLETED' ? createdAt + 12000 : null;
      const utr = t.status === 'COMPLETED' ? `4319${String(Math.floor(10000000 + Math.random() * 90000000))}` : null;

      db.prepare(`
        INSERT INTO merchant_orders (id, merchant_id, amount, description, vpa_address, upi_uri, utr, status, created_at, settled_at)
        VALUES (?, ?, ?, ?, 'ramesh.store@okaxis', ?, ?, ?, ?, ?)
      `).run(orderId, ramesh.id, t.amt, t.desc, upiUri, utr, t.status, createdAt, settledAt);
    }
  }

  const existingNew = findMerchantByEmail('new@merchant.in');
  if (!existingNew) {
    console.log('Seeding fresh onboarding merchant: new@merchant.in / Merchant@123');
    createMerchant({
      email: 'new@merchant.in',
      password: 'Merchant@123',
      businessName: '',
      phone: '',
      city: '',
      primaryVpa: '',
      setupCompleted: 0
    });
  }
}

seedDefaultMerchants();

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  createMerchant,
  findMerchantByEmail,
  findMerchantById,
  createSession,
  validateSession,
  deleteSession,
  completeSetup,
  updateMerchantProfile,
  updateMerchantPassword,
  getMerchantVPAs,
  addMerchantVPA,
  updateVPAStatus,
  setDefaultVPA,
  deleteVPA,
  createMerchantOrder,
  simulateOrderPayment,
  getMerchantOrders,
  getMerchantDashboardData,
  getMerchantNotifications,
  markNotificationsRead
};
