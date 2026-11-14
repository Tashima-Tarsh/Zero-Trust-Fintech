import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let DatabaseSync = null;
try {
  const sqliteModule = await import('node:sqlite');
  DatabaseSync = sqliteModule.DatabaseSync;
} catch (e) {
  // node:sqlite is available on Node >= 22.5.0; in-memory fallback is used on older Node runtimes
}

let db = null;
if (DatabaseSync) {
  try {
    const dbPath = join(__dirname, 'sharepay.db');
    db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA busy_timeout = 5000;');
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA foreign_keys = ON;');
    } catch (pragmaErr) {
      console.warn('[Database] Warning applying SQLite pragmas:', pragmaErr.message);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        base_amount REAL NOT NULL,
        discount REAL NOT NULL,
        status TEXT NOT NULL,
        session_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        utr TEXT,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS processed_utrs (
        utr TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        amount REAL NOT NULL,
        receipt_hash TEXT NOT NULL,
        verified_at INTEGER NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS rejected_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        utr TEXT,
        amount REAL,
        raw_receipt TEXT,
        reason TEXT NOT NULL,
        rejected_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_expires ON orders(expires_at);
      CREATE INDEX IF NOT EXISTS idx_rejected_order ON rejected_shares(order_id);
    `);
  } catch (err) {
    console.warn('[Database] SQLite initialization notice, using in-memory store:', err.message);
    db = null;
  }
}

// In-memory fallback tables for Node runtimes without native node:sqlite
const memOrders = new Map();
const memProcessedUtrs = new Map();
const memRejectedShares = [];

export const database = {
  createOrder({ id, amount, baseAmount, discount, sessionToken, createdAt, expiresAt }) {
    if (db) {
      const stmt = db.prepare(`
        INSERT INTO orders (id, amount, base_amount, discount, status, session_token, created_at, expires_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)
      `);
      stmt.run(id, amount, baseAmount, discount, sessionToken, createdAt, expiresAt);
      return this.getOrder(id);
    }
    const order = { id, amount, base_amount: baseAmount, discount, status: 'PENDING', session_token: sessionToken, created_at: createdAt, expires_at: expiresAt, utr: null, completed_at: null };
    memOrders.set(id, order);
    return order;
  },

  getOrder(id) {
    if (!id) return null;
    if (db) {
      const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
      return stmt.get(id) || null;
    }
    return memOrders.get(id) || null;
  },

  findActiveOrderByAmount(amount, now = Date.now()) {
    if (db) {
      const stmt = db.prepare(`
        SELECT * FROM orders 
        WHERE status = 'PENDING' 
          AND amount = ? 
          AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return stmt.get(amount, now) || null;
    }
    for (const order of Array.from(memOrders.values()).reverse()) {
      if (order.status === 'PENDING' && order.amount === amount && order.expires_at > now) {
        return order;
      }
    }
    return null;
  },

  findActiveOrderBySession(sessionToken, now = Date.now()) {
    if (!sessionToken) return null;
    if (db) {
      const stmt = db.prepare(`
        SELECT * FROM orders 
        WHERE session_token = ? 
          AND status = 'PENDING' 
          AND expires_at > ?
        LIMIT 1
      `);
      return stmt.get(sessionToken, now) || null;
    }
    for (const order of memOrders.values()) {
      if (order.session_token === sessionToken && order.status === 'PENDING' && order.expires_at > now) {
        return order;
      }
    }
    return null;
  },

  isUtrProcessed(utr) {
    if (!utr) return false;
    if (db) {
      const stmt = db.prepare('SELECT utr FROM processed_utrs WHERE utr = ?');
      const row = stmt.get(utr);
      return !!row;
    }
    return memProcessedUtrs.has(utr);
  },

  recordSuccess(orderId, utr, amount, receiptText, verifiedAt = Date.now()) {
    const receiptHash = crypto.createHash('sha256').update(receiptText || '').digest('hex');

    if (db) {
      try {
        db.exec('BEGIN TRANSACTION;');
        const utrStmt = db.prepare(`
          INSERT INTO processed_utrs (utr, order_id, amount, receipt_hash, verified_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        utrStmt.run(utr, orderId, amount, receiptHash, verifiedAt);

        const orderStmt = db.prepare(`
          UPDATE orders 
          SET status = 'SUCCESS', utr = ?, completed_at = ?
          WHERE id = ?
        `);
        orderStmt.run(utr, verifiedAt, orderId);

        db.exec('COMMIT;');
        return true;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (e) {}
        throw err;
      }
    }

    memProcessedUtrs.set(utr, { utr, order_id: orderId, amount, receipt_hash: receiptHash, verified_at: verifiedAt });
    const order = memOrders.get(orderId);
    if (order) {
      order.status = 'SUCCESS';
      order.utr = utr;
      order.completed_at = verifiedAt;
    }
    return true;
  },

  ping() {
    if (db) {
      try {
        const stmt = db.prepare('SELECT 1 as alive');
        const res = stmt.get();
        return res && res.alive === 1;
      } catch (e) {
        return false;
      }
    }
    return true;
  },

  resetForTesting() {
    if (db) {
      try {
        db.exec(`
          DELETE FROM processed_utrs WHERE order_id LIKE 'Order_TEST_%' OR order_id LIKE 'Order_STALE_%';
          DELETE FROM rejected_shares WHERE order_id LIKE 'Order_TEST_%' OR order_id LIKE 'Order_STALE_%';
          DELETE FROM orders WHERE id LIKE 'Order_TEST_%' OR id LIKE 'Order_STALE_%';
        `);
      } catch (e) {
        console.warn('Test reset error:', e.message);
      }
    }
    for (const [id] of memOrders.entries()) {
      if (id.startsWith('Order_TEST_') || id.startsWith('Order_STALE_')) memOrders.delete(id);
    }
    for (const [utr, rec] of memProcessedUtrs.entries()) {
      if (rec.order_id && (rec.order_id.startsWith('Order_TEST_') || rec.order_id.startsWith('Order_STALE_'))) memProcessedUtrs.delete(utr);
    }
  },

  recordRejection(orderId, utr, amount, rawReceipt, reason, rejectedAt = Date.now()) {
    if (db) {
      const stmt = db.prepare(`
        INSERT INTO rejected_shares (order_id, utr, amount, raw_receipt, reason, rejected_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(orderId || null, utr || null, amount || null, rawReceipt || null, reason, rejectedAt);
      return;
    }
    memRejectedShares.push({ order_id: orderId, utr, amount, raw_receipt: rawReceipt, reason, rejected_at: rejectedAt });
  },

  getAuditLog(limit = 20) {
    if (db) {
      const successStmt = db.prepare(`
        SELECT 'SUCCESS' as event_type, order_id, utr, amount, verified_at as timestamp, NULL as reason 
        FROM processed_utrs 
        ORDER BY verified_at DESC 
        LIMIT ?
      `);
      const rejectedStmt = db.prepare(`
        SELECT 'REJECTED' as event_type, order_id, utr, amount, rejected_at as timestamp, reason 
        FROM rejected_shares 
        ORDER BY rejected_at DESC 
        LIMIT ?
      `);
      return {
        settled: successStmt.all(limit),
        rejections: rejectedStmt.all(limit)
      };
    }
    return {
      settled: Array.from(memProcessedUtrs.values()).slice(-limit),
      rejections: memRejectedShares.slice(-limit)
    };
  },

  sweepExpiredOrders(now = Date.now()) {
    if (db) {
      const stmt = db.prepare(`
        UPDATE orders 
        SET status = 'EXPIRED' 
        WHERE status = 'PENDING' AND expires_at < ?
      `);
      const result = stmt.run(now);
      return result.changes || 0;
    }
    let count = 0;
    for (const [id, order] of memOrders.entries()) {
      if (order.status === 'PENDING' && now > order.expires_at) {
        order.status = 'EXPIRED';
        count++;
      }
    }
    return count;
  }
};
