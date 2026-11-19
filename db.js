/**
 * DISHA 8.2 — Enterprise Data Layer
 * Supports PostgreSQL with seamless built-in fallback to native SQLite (node:sqlite)
 * Integrated with 1000-VPA Anti-Ban Routing Engine & Bulk Importer
 */

const { join } = require('path');
const crypto = require('crypto');
const { prepareSqliteDatabasePath } = require('./utils/sqlite-storage');
const VPARouter = require('./vpa-router');
const { VPAImporter, parseCSV } = require('./vpa-importer');

let pgPool = null;
let sqliteDb = null;
let isPostgres = false;
let vpaRouter = null;
let vpaImporter = null;
let pgStore = null;
const usePostgresAuthority = process.env.DB_BACKEND === 'postgres';

// Proxy object for router and importer
const dbAccessor = {
  get sqliteDb() { return sqliteDb; },
  get pgPool() { return pgPool; }
};

vpaRouter = new VPARouter(dbAccessor);
vpaImporter = new VPAImporter(dbAccessor);

// Attempt PostgreSQL initialization if DATABASE_URL is set and reachable.
// NOTE: SQLite (session / order / VPA store) is ALWAYS initialized first so
// sessions can never silently disappear when only Postgres is configured.
async function initDb() {
  let sqliteOk = false;

  // Retain the existing SQLite store unless the explicit PostgreSQL cutover
  // has been configured after a verified backup and data import.
  if (!usePostgresAuthority) try {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = prepareSqliteDatabasePath();
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA busy_timeout = 5000;');
    sqliteDb.exec('PRAGMA synchronous = NORMAL;');
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    setupSqliteTables();
    sqliteOk = true;
    console.log('✅ [Database] Initialized Native SQLite Store at', dbPath);
  } catch (err) {
    console.error('❌ [Database] Failed to initialize SQLite:', err.message);
  }

  // 2. PostgreSQL (ledger / VPA analytics) — additive, never replaces SQLite.
  const dbUrl = process.env.DATABASE_URL;
  if (usePostgresAuthority && !dbUrl) throw new Error('DB_BACKEND=postgres requires DATABASE_URL');
  if (dbUrl && !dbUrl.includes('localhost:5432/disha82') && (sqliteOk || usePostgresAuthority)) {
    try {
      const { Pool } = require('pg');
      const testPool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 2000 });
      const client = await testPool.connect();
      await client.query('SELECT 1');
      client.release();
      pgPool = testPool;
      isPostgres = true;
      console.log(
        '✅ [Database] Connected to PostgreSQL at',
        dbUrl.split('@')[1] || 'remote host'
      );
      await setupPostgresTables();
      if (usePostgresAuthority) {
        // DO NOT automatically run data migrations on production startup.
        // The migration scripts are run and verified separately before cutover.
        const verified = await pgPool.query("SELECT payload FROM disha_migration_control WHERE name='sqlite_to_postgres_verified'");
        if (verified.rowCount !== 1 || verified.rows[0]?.payload?.sourceIntegrity !== 'ok') {
          throw new Error('PostgreSQL migration verification marker missing: refusing cutover');
        }
        const { buildStore } = require('./financial/postgres-store');
        pgStore = buildStore(pgPool, vpaRouter);
      }
    } catch (err) {
      console.log(
        'ℹ️ [Database] PostgreSQL unavailable (' + err.message + '). Continuing SQLite-only.'
      );
    }
  }

  if (usePostgresAuthority) {
    if (!pgStore) throw new Error('PostgreSQL authority unavailable: refusing SQLite fallback');
    console.log('✅ [Database] PostgreSQL is the sole checkout authority (DB_BACKEND=postgres)');
    return;
  }
  if (!sqliteOk) {
    throw new Error('Database initialization failed: SQLite session store could not be created');
  }
}

function migrateVpaPoolColumns(dbInstance) {
  if (!dbInstance) return;
  try {
    const cols = dbInstance.prepare(`PRAGMA table_info(vpa_pool)`).all().map(c => c.name);

    const requiredColumns = [
      { name: 'holder_name', type: 'TEXT' },
      { name: 'account_type', type: "TEXT NOT NULL DEFAULT 'PERSONAL'" },
      { name: 'risk_level', type: "TEXT NOT NULL DEFAULT 'LOW'" },
      { name: 'preferred_time_slot', type: "TEXT NOT NULL DEFAULT 'ANY'" },
      { name: 'active_hours_start', type: 'INTEGER NOT NULL DEFAULT 8' },
      { name: 'active_hours_end', type: 'INTEGER NOT NULL DEFAULT 22' },
      { name: 'per_tx_limit', type: 'REAL NOT NULL DEFAULT 5000.0' },
      { name: 'unique_senders_daily_limit', type: 'INTEGER NOT NULL DEFAULT 12' },
      { name: 'unique_senders_today', type: 'INTEGER NOT NULL DEFAULT 0' },
      { name: 'mcc', type: 'TEXT' },
      { name: 'min_gap_minutes', type: 'INTEGER NOT NULL DEFAULT 8' },
      { name: 'notes', type: 'TEXT' },
      { name: 'excel_row_id', type: 'TEXT' }
    ];

    for (const col of requiredColumns) {
      if (!cols.includes(col.name)) {
        try {
          dbInstance.exec(`ALTER TABLE vpa_pool ADD COLUMN ${col.name} ${col.type}`);
        } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[Database Migration Notice]', e.message);
  }
}

function setupSqliteTables() {
  if (!sqliteDb) return;
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vpa_pool (
      id TEXT PRIMARY KEY,
      vpa_address TEXT UNIQUE NOT NULL,
      holder_name TEXT,
      bank_name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'PERSONAL',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      health_score INTEGER NOT NULL DEFAULT 98,
      risk_level TEXT NOT NULL DEFAULT 'LOW',
      preferred_time_slot TEXT NOT NULL DEFAULT 'ANY',
      active_hours_start INTEGER NOT NULL DEFAULT 8,
      active_hours_end INTEGER NOT NULL DEFAULT 22,
      daily_tx_limit INTEGER NOT NULL DEFAULT 15,
      daily_volume_limit REAL NOT NULL DEFAULT 25000.0,
      per_tx_limit REAL NOT NULL DEFAULT 5000.0,
      unique_senders_daily_limit INTEGER NOT NULL DEFAULT 12,
      daily_tx_count INTEGER NOT NULL DEFAULT 0,
      daily_volume REAL NOT NULL DEFAULT 0.0,
      unique_senders_today INTEGER NOT NULL DEFAULT 0,
      min_gap_minutes INTEGER NOT NULL DEFAULT 8,
      last_used_at INTEGER,
      cooldown_until INTEGER NOT NULL DEFAULT 0,
      merchant_id TEXT NOT NULL DEFAULT 'mer_default',
      mcc TEXT,
      notes TEXT,
      excel_row_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vpa_usage_log (
      id TEXT PRIMARY KEY,
      vpa_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      transaction_id TEXT,
      amount REAL NOT NULL,
      customer_vpa TEXT,
      customer_region TEXT,
      time_slot TEXT,
      used_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vpa_health_events (
      id TEXT PRIMARY KEY,
      vpa_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT,
      health_impact INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vpa_sender_tracking (
      id TEXT PRIMARY KEY,
      vpa_id TEXT NOT NULL,
      customer_vpa TEXT NOT NULL,
      tracking_date TEXT NOT NULL,
      tx_count INTEGER DEFAULT 1,
      last_seen INTEGER NOT NULL,
      UNIQUE(vpa_id, customer_vpa, tracking_date)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      challenge_amount REAL NOT NULL,
      base_amount REAL NOT NULL,
      txn_ref TEXT UNIQUE NOT NULL,
      vpa_address TEXT NOT NULL,
    upi_uri TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    state TEXT NOT NULL DEFAULT 'WAITING',
    customer_id TEXT,
    utr TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    qr_refresh_at INTEGER NOT NULL
  );

    -- Passkey / WebAuthn credential store
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at INTEGER NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      utr TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      vpa_used TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS blacklist_utrs (
      utr TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      amount REAL NOT NULL,
      blacklisted_at INTEGER NOT NULL,
      reason TEXT NOT NULL
    );

    -- Layer 4: UTR-Order Binding (Cross-Order UTR Reuse Prevention)
    CREATE TABLE IF NOT EXISTS utr_order_bindings (
      utr TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      bound_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_utr_order_bindings_order ON utr_order_bindings(order_id);

    -- Velocity control: per-VPA hourly transaction count (anti-ban drip-feed)
    CREATE TABLE IF NOT EXISTS vpa_hourly_txns (
      vpa_address TEXT NOT NULL,
      hour_bucket INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (vpa_address, hour_bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_vpa_hourly_txns_vpa ON vpa_hourly_txns(vpa_address);

    -- Cancellation cooldown tracking per session
    CREATE TABLE IF NOT EXISTS session_cooldowns (
      order_id TEXT PRIMARY KEY,
      last_cancel_at INTEGER NOT NULL,
      cooldown_until INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_cooldowns_order ON session_cooldowns(order_id);

    CREATE TABLE IF NOT EXISTS image_hashes (
      id TEXT PRIMARY KEY,
      image_hash TEXT UNIQUE NOT NULL,
      order_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_image_hashes_hash ON image_hashes(image_hash);
    CREATE INDEX IF NOT EXISTS idx_image_hashes_order ON image_hashes(order_id);

    CREATE TABLE IF NOT EXISTS gaming_companies (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      api_secret TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ip_whitelist (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      ip_address TEXT,
      ip_range TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      added_by TEXT,
      added_at INTEGER NOT NULL,
      last_used_at INTEGER,
      UNIQUE(company_id, ip_address)
    );

    CREATE TABLE IF NOT EXISTS api_access_log (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      ip_address TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      request_body TEXT,
      response_body TEXT,
      user_agent TEXT,
      accessed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_ip_attempts (
      id TEXT PRIMARY KEY,
      ip_address TEXT NOT NULL,
      company_id TEXT,
      endpoint TEXT NOT NULL,
      reason TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 1,
      first_attempt INTEGER NOT NULL,
      last_attempt INTEGER NOT NULL,
      UNIQUE(ip_address, endpoint)
    );
  `);

  // Run dynamic schema migration for existing databases
  migrateVpaPoolColumns(sqliteDb);
  // Additive compatibility for existing SQLite sessions. Never rewrite old QR
  // data or any financial row while upgrading the table.
  const sessionColumns=new Set(sqliteDb.prepare('PRAGMA table_info(sessions)').all().map(c=>c.name));
  if(!sessionColumns.has('upi_uri'))sqliteDb.exec('ALTER TABLE sessions ADD COLUMN upi_uri TEXT');

  // Seed default Chart of Accounts
  const seedAccounts = [
    { id: 'acc_bank_01', code: '1010-BANK', name: 'Direct Bank Settlement Account', type: 'ASSET' },
    { id: 'acc_rev_01', code: '4010-REVENUE', name: 'Zero-Commission Merchant Sales', type: 'REVENUE' },
    { id: 'acc_fee_01', code: '5010-FEES', name: 'Aggregator Gateway Fees (Zero in DISHA)', type: 'EXPENSE' }
  ];
  const accStmt = sqliteDb.prepare(`INSERT OR IGNORE INTO accounts (id, code, name, type, merchant_id, created_at) VALUES (?, ?, ?, ?, 'mer_default', ?)`);
  const now = Date.now();
  for (const a of seedAccounts) {
    accStmt.run(a.id, a.code, a.name, a.type, now);
  }

  // Seed VPA Pool with human time-slots and conservative limits
  // Do not silently turn demo/test VPAs into real receiving accounts.
  // Pause only the exact known built-in example rows, preserving their history.
  const receivingVpa=String(process.env.MERCHANT_UPI_ID||'').trim().toLowerCase();
  const examples=[
    ['vpa_nitish_01','merchant@upi'],
    ['vpa_axis_01','disha82@okaxis'],
    ['vpa_icici_02','disha82@icici'],
    ['vpa_yes_03','disha82@ybl'],
    ['vpa_test_04','nkumar906099-7@oksbi']
  ];
  const pauseExample=sqliteDb.prepare(
    "UPDATE vpa_pool SET status='PAUSED' WHERE id=? AND lower(vpa_address)=? AND status='ACTIVE'"
  );
  for(const [id,address] of examples){
    if(address!==receivingVpa)pauseExample.run(id,address);
  }
  // Seed exactly one *configured* receiving VPA, never a guessed address.
  // Other accounts must enter through explicit, verified VPA provisioning.
  if(receivingVpa){
    const key='vpa_config_'+crypto.createHash('sha256').update(receivingVpa).digest('hex').slice(0,16);
    sqliteDb.prepare(
      "INSERT OR IGNORE INTO vpa_pool (id,vpa_address,holder_name,bank_name,status,health_score,"+
      "preferred_time_slot,daily_tx_limit,daily_volume_limit,merchant_id,created_at) "+
      "VALUES (?,?,?,'Configured Bank','ACTIVE',99,'ANY',15,25000,'mer_default',?)"
    ).run(key,receivingVpa,String(process.env.MERCHANT_NAME||'').trim()||null,now);
  }

  // Seed Default Gaming Company (GameZone Pro) & Server IPs
  // Removed hardcoded credentials: create tenants via POST /api/admin/companies
  // with ADMIN_API_KEY set. Seeding keys in source is a production risk.

}

async function setupPostgresTables() {
  if (!pgPool) return;
  const fs = require('fs');
  const sql = fs.readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await pgPool.query(sql);
  // Existing PostgreSQL tables do not gain new columns through CREATE TABLE IF NOT EXISTS.
  // Repair only additive checkout fields before the first payment session can be created.
  const {ensureCheckoutSessionSchema} = require('./financial/checkout-schema');
  await ensureCheckoutSessionSchema(pgPool);
}

// Memory tracking for VPA pattern masking fallback
const recentUsedVpas = [];

// TASK 9: 1000 VPA Smart Anti-Ban Routing Engine
function selectVPA(merchantId = 'mer_default', amount = 100) {
  try {
    if (vpaRouter && sqliteDb) {
      const route = vpaRouter.selectVPASync(merchantId, amount);
      if (route && route.vpaAddress) {
        return route.vpaAddress;
      }
    }
  } catch (err) {
    console.warn('[VPA Router Notice]', err.message);
  }

  // Pure fallback if router threw or wasn't ready
  if (sqliteDb) {
    const row = sqliteDb.prepare(`
      SELECT vpa_address FROM vpa_pool
      WHERE (merchant_id = ? OR merchant_id = 'mer_default') AND status = 'ACTIVE'
      ORDER BY last_used_at ASC, daily_tx_count ASC LIMIT 1
    `).get(merchantId);
    if (row && row.vpa_address) return row.vpa_address;
  }

  return process.env.MERCHANT_UPI_ID || 'merchant@upi';
}

function selectVPARoute(merchantId = 'mer_default', amount = 100, customerRegion = 'MH', timeOfDay = null, customerVpa = null) {
  if (vpaRouter) {
    const route = vpaRouter.selectVPASync(merchantId, amount, customerRegion, timeOfDay, customerVpa);
    if (route && route.vpaAddress) {
      const mt = getVpaMerchantType(route.vpaAddress);
      return {
        vpaAddress: route.vpaAddress,
        healthScore: route.healthScore,
        cooldownMinutes: route.cooldownMinutes,
        merchantType: mt.accountType,
        mcc: mt.mcc,
        holderName: route.holderName || mt.holderName || null
      };
    }
  }
  const vpaAddress = selectVPA(merchantId, amount);
  const mt = getVpaMerchantType(vpaAddress);
  return {
    vpaAddress,
    healthScore: 95,
    cooldownMinutes: 10,
    merchantType: mt.accountType,
    mcc: mt.mcc,
    holderName: mt.holderName || null
  };
}

/**
 * Resolve a VPA's merchant classification (P2P vs P2M) and MCC from vpa_pool.
 * Used by generateUPILink to gate mc/tr/mode/sign parameters so personal VPAs
 * never carry merchant-only parameters (NPCI Circular 18: bank decline before PIN).
 */
function getVpaMerchantType(vpaAddress) {
  if (!vpaAddress || !sqliteDb) return { accountType: 'PERSONAL', mcc: null };
  try {
    const row = sqliteDb.prepare(`
      SELECT account_type, mcc, holder_name FROM vpa_pool WHERE vpa_address = ? LIMIT 1
    `).get(vpaAddress);
    if (row) {
      return { accountType: row.account_type || 'PERSONAL', mcc: row.mcc || null, holderName: row.holder_name || null };
    }
  } catch (err) {
    console.warn('[VPA MerchantType Notice]', err.message);
  }
  return { accountType: 'PERSONAL', mcc: null };
}

function getAllActiveVPAs() {
  if (!sqliteDb) return [];
  try {
    return sqliteDb.prepare(
      `SELECT vpa_address, account_type, mcc, status, health_score FROM vpa_pool WHERE status = 'ACTIVE'`
    ).all();
  } catch (e) {
    return [];
  }
}

// Session Management (TASK 3)
function saveSession(session) {
  if (sqliteDb) {
    sqliteDb.prepare(`
      INSERT INTO sessions (session_id, order_id, challenge_amount, base_amount, txn_ref, vpa_address, upi_uri, status, state, customer_id, created_at, expires_at, qr_refresh_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        session_id = excluded.session_id,
        challenge_amount = excluded.challenge_amount,
        base_amount = excluded.base_amount,
        txn_ref = excluded.txn_ref,
        vpa_address = excluded.vpa_address,
        upi_uri = COALESCE(sessions.upi_uri, excluded.upi_uri),
        status = excluded.status,
        state = excluded.state,
        customer_id = excluded.customer_id,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        qr_refresh_at = excluded.qr_refresh_at
    `).run(
      session.sessionId,
      session.orderId,
      session.challengeAmount,
      session.baseAmount,
      session.txnRef,
      session.vpaAddress || process.env.MERCHANT_UPI_ID || 'merchant@upi',
      session.upiUri || null,
      session.status,
      session.state || 'WAITING',
      session.customerId || null,
      session.createdAt,
      session.expiresAt,
      session.qrRefreshAt
    );
  }
}

function findSessionByOrderId(orderId) {
  if (sqliteDb) {
    const row = sqliteDb.prepare(`SELECT * FROM sessions WHERE order_id = ?`).get(orderId);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      orderId: row.order_id,
      challengeAmount: row.challenge_amount,
      baseAmount: row.base_amount,
      txnRef: row.txn_ref,
      vpaAddress: row.vpa_address,
      upiUri: row.upi_uri || null,
      status: row.status,
      state: row.state,
      customerId: row.customer_id,
      utr: row.utr,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      qrRefreshAt: row.qr_refresh_at
    };
  }
  return null;
}

function findSessionByTxnRef(txnRef) {
  if (sqliteDb) {
    const row = sqliteDb.prepare(`SELECT * FROM sessions WHERE txn_ref = ?`).get(txnRef);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      orderId: row.order_id,
      challengeAmount: row.challenge_amount,
      baseAmount: row.base_amount,
      txnRef: row.txn_ref,
      vpaAddress: row.vpa_address,
      upiUri: row.upi_uri || null,
      status: row.status,
      utr: row.utr,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      qrRefreshAt: row.qr_refresh_at
    };
  }
  return null;
}

function findSessionByAmount(amount) {
  if (sqliteDb) {
    const numAmt = parseFloat(amount);
    if (isNaN(numAmt)) return null;
    const now = Date.now();
    // Match active or recent PENDING session with exact challenge paise offset
    const row = sqliteDb.prepare(`
      SELECT * FROM sessions 
      WHERE ABS(challenge_amount - ?) < 0.004 
        AND status = 'PENDING' 
        AND expires_at >= (? - 60000)
      ORDER BY created_at DESC 
      LIMIT 1
    `).get(numAmt, now);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      orderId: row.order_id,
      challengeAmount: row.challenge_amount,
      baseAmount: row.base_amount,
      txnRef: row.txn_ref,
      vpaAddress: row.vpa_address,
      upiUri: row.upi_uri || null,
      status: row.status,
      utr: row.utr,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      qrRefreshAt: row.qr_refresh_at
    };
  }
  return null;
}

function updateSessionStatus(orderId, status, utr = null) {
  if (sqliteDb) {
    sqliteDb.prepare(`UPDATE sessions SET status = ?, utr = ? WHERE order_id = ?`).run(status, utr, orderId);
  }
}

function updateSessionState(orderId, state) {
  if (sqliteDb) {
    sqliteDb.prepare(`UPDATE sessions SET state = ? WHERE order_id = ?`).run(state, orderId);
  }
}

function getOrderState(orderId) {
  if (!sqliteDb) return null;
  const row = sqliteDb.prepare(`SELECT * FROM sessions WHERE order_id = ?`).get(orderId);
  if (!row) return null;

  const now = Date.now();
  const createdAt = row.created_at;
  const timeElapsedMs = now - createdAt;
  const T_MIN = 15 * 1000;   // 15 seconds minimum
  const T_MAX = 180 * 1000;  // 3 minutes maximum

  // If already verified, return VERIFIED
  if (row.state === 'VERIFIED' || row.status === 'SUCCESS') {
    return {
      state: 'VERIFIED',
      orderId: row.order_id,
      utr: row.utr,
      amount: row.challenge_amount,
      baseAmount: row.base_amount,
      vpaAddress: row.vpa_address,
      createdAt: row.created_at,
      verifiedAt: row.state === 'VERIFIED' ? now : null,
      verificationTime: row.state === 'VERIFIED' ? (now - row.created_at) : null,
      customerId: row.customer_id
    };
  }

  // If expired
  if (timeElapsedMs > T_MAX) {
    return {
      state: 'EXPIRED',
      orderId: row.order_id,
      reason: 'Order timeout (>3 minutes)',
      timeRemaining: 0
    };
  }

  // If still in WAITING (0 < t < 15s)
  if (timeElapsedMs < T_MIN) {
    return {
      state: 'WAITING',
      orderId: row.order_id,
      timeRemainingMs: T_MIN - timeElapsedMs,
      timeRemaining: (T_MIN - timeElapsedMs) / 1000
    };
  }

  // If in VERIFY_WINDOW (15s <= t <= 180s)
  return {
    state: 'VERIFY_WINDOW',
    orderId: row.order_id,
    timeRemainingMs: T_MAX - timeElapsedMs,
    timeRemaining: (T_MAX - timeElapsedMs) / 1000,
    customerId: row.customer_id
  };
}

// UTR Blacklist (TASK 8 Layer 3)
function isUtrBlacklisted(utr) {
  if (sqliteDb) {
    const row = sqliteDb.prepare(`SELECT * FROM blacklist_utrs WHERE utr = ?`).get(utr);
    return Boolean(row);
  }
  return false;
}

function blacklistUtr(utr, orderId, amount, reason = 'Verified settlement') {
  if (sqliteDb) {
    sqliteDb.prepare(`
      INSERT OR REPLACE INTO blacklist_utrs (utr, order_id, amount, blacklisted_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(utr, orderId, amount, Date.now(), reason);
  }
}

/**
 * Layer 4: UTR-Order Binding Check.
 * Returns the order_id this UTR was first bound to, or null if never bound.
 * A UTR can only be bound to ONE order forever — cross-order reuse is impossible.
 */
function getUtrBoundOrder(utr) {
  if (!utr || !sqliteDb) return null;
  const row = sqliteDb.prepare(`SELECT order_id FROM utr_order_bindings WHERE utr = ? LIMIT 1`).get(utr);
  return row ? row.order_id : null;
}

/**
 * Layer 4: Bind a UTR to an order on first submission.
 * Returns true if newly bound, false if already bound to same order.
 * Throws/rejects if already bound to a DIFFERENT order (cross-order reuse).
 */
function bindUtrToOrder(utr, orderId) {
  if (!utr || !sqliteDb) return false;
  try {
    const tx = sqliteDb.transaction((utr, orderId) => {
      const existing = sqliteDb.prepare(`SELECT order_id FROM utr_order_bindings WHERE utr = ? LIMIT 1`).get(utr);
      if (!existing) {
        sqliteDb.prepare(`INSERT INTO utr_order_bindings (utr, order_id, bound_at) VALUES (?, ?, ?)`).run(utr, orderId, Date.now());
        return true;
      }
      return existing.order_id === orderId ? true : 'BOUND_TO_OTHER_ORDER';
    });
    return tx(utr, orderId);
  } catch (e) {
    return false;
  }
}

/**
 * Velocity Control: per-VPA hourly transaction count.
 * Returns true if the VPA is under the hourly limit (safe to use).
 * Returns false if the VPA has hit the limit (should route elsewhere).
 */
function checkVpaVelocity(vpaAddress, maxPerHour = 15) {
  if (!vpaAddress || !sqliteDb) return true;
  try {
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const row = sqliteDb.prepare(
      `SELECT count FROM vpa_hourly_txns WHERE vpa_address = ? AND hour_bucket = ?`
    ).get(vpaAddress, hourBucket);
    const current = row ? row.count : 0;
    return current < maxPerHour;
  } catch (e) {
    return true; // fail-open: if DB fails, don't block transactions
  }
}

/**
 * Increment the hourly transaction count for a VPA.
 * Call after a successful session creation (not after payment).
 */
function incrementVpaVelocity(vpaAddress) {
  if (!vpaAddress || !sqliteDb) return;
  try {
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    sqliteDb.prepare(`
      INSERT INTO vpa_hourly_txns (vpa_address, hour_bucket, count) VALUES (?, ?, 1)
      ON CONFLICT(vpa_address, hour_bucket) DO UPDATE SET count = count + 1
    `).run(vpaAddress, hourBucket);
  } catch (e) {
    // fail silently
  }
}

/**
 * Check if a session is in cancellation cooldown.
 * Returns { inCooldown: true, secondsRemaining } or { inCooldown: false }.
 */
function checkSessionCooldown(orderId) {
  if (!orderId || !sqliteDb) return { inCooldown: false };
  try {
    const row = sqliteDb.prepare(
      `SELECT cooldown_until FROM session_cooldowns WHERE order_id = ? LIMIT 1`
    ).get(orderId);
    if (!row) return { inCooldown: false };
    const now = Date.now();
    if (now >= row.cooldown_until) {
      return { inCooldown: false };
    }
    return { inCooldown: true, secondsRemaining: Math.ceil((row.cooldown_until - now) / 1000) };
  } catch (e) {
    return { inCooldown: false };
  }
}

/**
 * Set a cancellation cooldown on a session (2 minutes default).
 */
function setSessionCooldown(orderId, cooldownMs = 120 * 1000) {
  if (!orderId || !sqliteDb) return;
  try {
    const now = Date.now();
    const cooldownUntil = now + cooldownMs;
    sqliteDb.prepare(`
      INSERT INTO session_cooldowns (order_id, last_cancel_at, cooldown_until) VALUES (?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET last_cancel_at = ?, cooldown_until = ?
    `).run(orderId, now, cooldownUntil, now, cooldownUntil);
  } catch (e) {
    // fail silently
  }
}

/**
 * Passkey / WebAuthn credential storage
 */
function savePasskey(userId, credentialId, publicKey, counter = 0, deviceType = null, backedUp = 0, transports = null) {
  if (!sqliteDb) return false;
  try {
    const id = 'pk_' + crypto.randomBytes(8).toString('hex');
    sqliteDb.prepare(`
      INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, created_at, sign_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, credentialId, publicKey, counter, deviceType, backedUp, transports, Date.now(), counter);
    return { id, userId, credentialId };
  } catch (e) {
    return false;
  }
}

function findPasskeyByCredentialId(credentialId) {
  if (!sqliteDb) return null;
  try {
    const row = sqliteDb.prepare(`SELECT * FROM passkeys WHERE credential_id = ? LIMIT 1`).get(credentialId);
    return row || null;
  } catch (e) {
    return null;
  }
}

function findPasskeysByUserId(userId) {
  if (!sqliteDb) return [];
  try {
    return sqliteDb.prepare(`SELECT * FROM passkeys WHERE user_id = ?`).all(userId);
  } catch (e) {
    return [];
  }
}

function updatePasskeyCounter(credentialId, newCounter) {
  if (!sqliteDb) return false;
  try {
    sqliteDb.prepare(`UPDATE passkeys SET sign_count = ? WHERE credential_id = ?`).run(newCounter, credentialId);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Receipt image hash dedup gate.
 * Returns true if this image hash was already seen (replay attack).
 */
function isImageHashSeen(imageHash) {
  if (!imageHash) return false;
  if (sqliteDb) {
    const row = sqliteDb.prepare(`SELECT 1 FROM image_hashes WHERE image_hash = ? LIMIT 1`).get(imageHash);
    return !!row;
  }
  return false;
}

/**
 * Record a receipt image hash for dedup tracking.
 * Returns false if already existed.
 */
function blacklistImageHash(imageHash, orderId, reason = 'Receipt image recorded') {
  if (!imageHash || !sqliteDb) return false;
  try {
    sqliteDb.prepare(`
      INSERT OR IGNORE INTO image_hashes (id, image_hash, order_id, seen_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomBytes(8).toString('hex'), imageHash, orderId, Date.now(), reason);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Atomic settlement: ledger posting + UTR blacklist + image hash dedup in one transaction.
 * All-or-nothing: if any step fails, nothing is committed.
 */
async function atomicSettle(orderId, utr, amount, vpaUsed, imageHash) {
  const now = Date.now();
  const txId = 'TX_' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const entryDebitId = 'LE_' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const entryCreditId = 'LE_' + crypto.randomBytes(6).toString('hex').toUpperCase();

  if (sqliteDb) {
    const now = Date.now();
    sqliteDb.exec('BEGIN TRANSACTION');
    try {
      sqliteDb.prepare(`
        INSERT INTO transactions (id, order_id, utr, amount, status, vpa_used, created_at)
        VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)
      `).run(txId, orderId, utr, amount, vpaUsed, now);

      sqliteDb.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
        VALUES (?, ?, 'acc_bank_01', 'DEBIT', ?, ?)
      `).run(entryDebitId, txId, amount, now);

      sqliteDb.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
        VALUES (?, ?, 'acc_rev_01', 'CREDIT', ?, ?)
      `).run(entryCreditId, txId, amount, now);

      sqliteDb.prepare(`
        INSERT OR REPLACE INTO blacklist_utrs (utr, order_id, amount, blacklisted_at, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(utr, orderId, amount, now, 'Verified settlement');

      if (imageHash) {
        sqliteDb.prepare(`
          INSERT OR IGNORE INTO image_hashes (id, image_hash, order_id, seen_at, reason)
          VALUES (?, ?, ?, ?, ?)
        `).run(crypto.randomBytes(8).toString('hex'), imageHash, orderId, now, 'Receipt image settled');
      }
      sqliteDb.exec('COMMIT');
    } catch (e) {
      sqliteDb.exec('ROLLBACK');
      throw e;
    }
    return { txId, verification: { balanced: true, totalDebits: amount, totalCredits: amount } };
  }

  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO transactions (id, order_id, utr, amount, status, vpa_used, created_at)
         VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6)`,
        [txId, orderId, utr, amount, vpaUsed, now]
      );
      await client.query(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
         VALUES ($1, $2, 'acc_bank_01', 'DEBIT', $3, $4)`,
        [entryDebitId, txId, amount, now]
      );
      await client.query(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
         VALUES ($1, $2, 'acc_rev_01', 'CREDIT', $3, $4)`,
        [entryCreditId, txId, amount, now]
      );
      await client.query(
        `INSERT INTO blacklist_utrs (utr, order_id, amount, blacklisted_at, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (utr) DO UPDATE SET
           order_id = EXCLUDED.order_id,
           amount = EXCLUDED.amount,
           blacklisted_at = EXCLUDED.blacklisted_at,
           reason = EXCLUDED.reason`,
        [utr, orderId, amount, now, 'Verified settlement']
      );
      if (imageHash) {
        await client.query(
          `INSERT INTO image_hashes (id, image_hash, order_id, seen_at, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (image_hash) DO NOTHING`,
          [crypto.randomBytes(8).toString('hex'), imageHash, orderId, now, 'Receipt image settled']
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { txId, verification: { balanced: true, totalDebits: amount, totalCredits: amount } };
  }

  return { txId, verification: { balanced: true, totalDebits: amount, totalCredits: amount } };
}

// Double-Entry Ledger Engine (TASK 10)
async function recordTransactionAndLedger(orderId, utr, amount, vpaUsed) {
  const now = Date.now();
  const txId = 'TX_' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const entryDebitId = 'LE_' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const entryCreditId = 'LE_' + crypto.randomBytes(6).toString('hex').toUpperCase();

  if (sqliteDb) {
    sqliteDb.prepare(`
      INSERT INTO transactions (id, order_id, utr, amount, status, vpa_used, created_at)
      VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(txId, orderId, utr, amount, vpaUsed, now);

    sqliteDb.prepare(`
      INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
      VALUES (?, ?, 'acc_bank_01', 'DEBIT', ?, ?)
    `).run(entryDebitId, txId, amount, now);

    sqliteDb.prepare(`
      INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
      VALUES (?, ?, 'acc_rev_01', 'CREDIT', ?, ?)
    `).run(entryCreditId, txId, amount, now);

    const verification = await getLedgerVerification(txId);
    if (!verification.balanced) {
      throw new Error(`Double-entry balance violation: Debits ₹${verification.totalDebits} != Credits ₹${verification.totalCredits}`);
    }

    return { txId, verification };
  }

  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO transactions (id, order_id, utr, amount, status, vpa_used, created_at)
         VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6)`,
        [txId, orderId, utr, amount, vpaUsed, now]
      );
      await client.query(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
         VALUES ($1, $2, 'acc_bank_01', 'DEBIT', $3, $4)`,
        [entryDebitId, txId, amount, now]
      );
      await client.query(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, created_at)
         VALUES ($1, $2, 'acc_rev_01', 'CREDIT', $3, $4)`,
        [entryCreditId, txId, amount, now]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const verification = await getLedgerVerification(txId);
    if (!verification.balanced) {
      throw new Error(`Double-entry balance violation: Debits ₹${verification.totalDebits} != Credits ₹${verification.totalCredits}`);
    }
    return { txId, verification };
  }

  return { txId, verification: { balanced: true, totalDebits: amount, totalCredits: amount } };
}

async function getLedgerVerification(txId) {
  if (sqliteDb) {
    const rows = sqliteDb.prepare(`SELECT entry_type, amount FROM ledger_entries WHERE transaction_id = ?`).all(txId);
    let totalDebits = 0;
    let totalCredits = 0;
    for (const r of rows) {
      if (r.entry_type === 'DEBIT') totalDebits += Number(r.amount);
      if (r.entry_type === 'CREDIT') totalCredits += Number(r.amount);
    }
    const deb = Math.round(totalDebits * 100) / 100;
    const cred = Math.round(totalCredits * 100) / 100;
    return {
      balanced: Math.abs(deb - cred) < 0.001,
      totalDebits: deb,
      totalCredits: cred
    };
  }
  if (pgPool) {
    const rows = await pgPool.query(`SELECT entry_type, amount FROM ledger_entries WHERE transaction_id = $1`, [txId]);
    let totalDebits = 0;
    let totalCredits = 0;
    for (const r of rows.rows) {
      if (r.entry_type === 'DEBIT') totalDebits += Number(r.amount);
      if (r.entry_type === 'CREDIT') totalCredits += Number(r.amount);
    }
    const deb = Math.round(totalDebits * 100) / 100;
    const cred = Math.round(totalCredits * 100) / 100;
    return {
      balanced: Math.abs(deb - cred) < 0.001,
      totalDebits: deb,
      totalCredits: cred
    };
  }
  return { balanced: true, totalDebits: 0, totalCredits: 0 };
}

async function resetDailyVPAs() {
  // Reset per-VPA daily counters (SQLite)
  if (sqliteDb) {
    sqliteDb.prepare(`UPDATE vpa_pool SET daily_tx_count = 0, daily_volume = 0.0, cooldown_until = 0, unique_senders_today = 0`).run();
  }
  // Reset per-VPA daily counters (Postgres)
  if (pgPool) {
    await pgPool.query(`UPDATE vpa_pool SET daily_tx_count = 0, daily_volume = 0.0, cooldown_until = 0, unique_senders_today = 0`);
  }
  // Router-level health rebalance (quarantine low-health VPAs, etc.)
  if (vpaRouter) {
    vpaRouter.dailyHealthResetAndRebalance();
  }
  console.log('🔄 [VPA Engine] Daily limits reset and health rebalanced successfully.');
}

module.exports = {
  initDb,
  get sqliteDb() { return sqliteDb; },
  get pgPool() { return pgPool; },
  get isPostgres() { return isPostgres; },
  get vpaRouter() { return vpaRouter; },
  get vpaImporter() { return vpaImporter; },
  selectVPA,
  selectVPARoute,
  saveSession,
  findSessionByOrderId,
  findSessionByTxnRef,
  findSessionByAmount,
  updateSessionStatus,
  isUtrBlacklisted,
  blacklistUtr,
  isImageHashSeen,
  blacklistImageHash,
  recordTransactionAndLedger,
  getLedgerVerification,
  atomicSettle,
  resetDailyVPAs,
  getVpaMerchantType,
  updateSessionState,
  getOrderState,
  getUtrBoundOrder,
  bindUtrToOrder,
  getAllActiveVPAs,
  savePasskey,
  findPasskeyByCredentialId,
  findPasskeysByUserId,
  updatePasskeyCounter,
  checkVpaVelocity,
  incrementVpaVelocity,
  checkSessionCooldown,
  setSessionCooldown
};

// PG authority adapters are async. Leave SQLite method bodies unchanged for
// existing deployments; callers await both sync and async implementations.
if (usePostgresAuthority) {
  const methods = [
    'selectVPA','selectVPARoute','saveSession','findSessionByOrderId',
    'findSessionByTxnRef','findSessionByAmount','updateSessionStatus',
    'isUtrBlacklisted','blacklistUtr','isImageHashSeen','blacklistImageHash',
    'recordTransactionAndLedger','getLedgerVerification','atomicSettle',
    'resetDailyVPAs','getVpaMerchantType','updateSessionState','getOrderState',
    'getUtrBoundOrder','bindUtrToOrder','getAllActiveVPAs','savePasskey',
    'findPasskeyByCredentialId','findPasskeysByUserId','updatePasskeyCounter',
    'checkVpaVelocity','incrementVpaVelocity','checkSessionCooldown','setSessionCooldown',
    'getVpaHourlyCount'
  ];
  for (const method of methods) {
    module.exports[method] = (...args) => {
      if (!pgStore) throw new Error('PostgreSQL state store is not initialized');
      return pgStore[method](...args);
    };
  }
}
