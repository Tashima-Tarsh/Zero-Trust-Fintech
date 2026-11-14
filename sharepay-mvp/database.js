import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize SQLite database
const dbPath = join(__dirname, 'sharepay.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Checkpoint Tables
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

export const database = {
  createOrder({ id, amount, baseAmount, discount, sessionToken, createdAt, expiresAt }) {
    const stmt = db.prepare(`
      INSERT INTO orders (id, amount, base_amount, discount, status, session_token, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `);
    stmt.run(id, amount, baseAmount, discount, sessionToken, createdAt, expiresAt);
    return this.getOrder(id);
  },

  getOrder(id) {
    if (!id) return null;
    const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
    return stmt.get(id) || null;
  },

  findActiveOrderByAmount(amount, now = Date.now()) {
    const stmt = db.prepare(`
      SELECT * FROM orders 
      WHERE status = 'PENDING' 
        AND amount = ? 
        AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(amount, now) || null;
  },

  findActiveOrderBySession(sessionToken, now = Date.now()) {
    if (!sessionToken) return null;
    const stmt = db.prepare(`
      SELECT * FROM orders 
      WHERE session_token = ? 
        AND status = 'PENDING'
        AND expires_at > ?
      LIMIT 1
    `);
    return stmt.get(sessionToken, now) || null;
  },

  isUtrProcessed(utr) {
    if (!utr) return false;
    const stmt = db.prepare('SELECT utr FROM processed_utrs WHERE utr = ?');
    const row = stmt.get(utr);
    return !!row;
  },

  recordSuccess(orderId, utr, amount, receiptText, verifiedAt = Date.now()) {
    const receiptHash = crypto.createHash('sha256').update(receiptText || '').digest('hex');

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Insert into checkpoint table
      const utrStmt = db.prepare(`
        INSERT INTO processed_utrs (utr, order_id, amount, receipt_hash, verified_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      utrStmt.run(utr, orderId, amount, receiptHash, verifiedAt);

      // 2. Mark order as settled
      const orderStmt = db.prepare(`
        UPDATE orders 
        SET status = 'SUCCESS', utr = ?, completed_at = ?
        WHERE id = ?
      `);
      orderStmt.run(utr, verifiedAt, orderId);

      db.exec('COMMIT;');
      return true;
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  },

  recordRejection(orderId, utr, amount, rawReceipt, reason, rejectedAt = Date.now()) {
    const stmt = db.prepare(`
      INSERT INTO rejected_shares (order_id, utr, amount, raw_receipt, reason, rejected_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(orderId || null, utr || null, amount || null, rawReceipt || null, reason, rejectedAt);
  },

  getAuditLog(limit = 20) {
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
};
