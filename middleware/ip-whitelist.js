/**
 * DISHA 8.2 — Enterprise IP Whitelist Security Middleware
 * Restricts gaming and high-value verification APIs to authorized server IPs & CIDRs.
 * Provides microsecond in-memory caching, brute force detection, and audit logging.
 */

const crypto = require('crypto');
const { getClientIP, isIPInCIDR } = require('../utils/ip-utils');

class IPWhitelistMiddleware {
  constructor(db, redis = null) {
    this.db = db;
    this.redis = redis;
    // Fast in-memory cache fallback: key -> { value, expiresAt }
    this.memoryCache = new Map();
  }

  get sqliteDb() {
    if (!this.db) return null;
    return this.db.sqliteDb || (typeof this.db.prepare === 'function' ? this.db : null);
  }

  get pgPool() {
    if (!this.db) return null;
    return this.db.pgPool || null;
  }

  // Cache helpers
  async getCache(key) {
    if (this.redis) {
      try {
        const val = await this.redis.get(key);
        if (val) return JSON.parse(val);
      } catch (_) {}
    }
    const mem = this.memoryCache.get(key);
    if (mem && mem.expiresAt > Date.now()) {
      return mem.value;
    }
    return null;
  }

  async setCache(key, value, ttlSeconds = 300) {
    if (this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      } catch (_) {}
    }
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
  }

  invalidateCache(companyId = null) {
    if (!companyId) {
      this.memoryCache.clear();
      return;
    }
    for (const k of this.memoryCache.keys()) {
      if (k.includes(companyId)) {
        this.memoryCache.delete(k);
      }
    }
  }

  /**
   * Express Middleware entry point
   * Usage: app.use('/api/gaming/*', ipWhitelist.check())
   */
  check() {
    return async (req, res, next) => {
      try {
        // Step 1: Extract API key from header or query
        const apiKey = req.headers['x-api-key'] || (req.query && req.query.api_key);
        if (!apiKey) {
          return res.status(401).json({
            error: 'MISSING_API_KEY',
            message: 'X-API-Key header is required for gaming enterprise endpoints'
          });
        }

        // Step 2: Get company by API key
        const company = await this.getCompanyByAPIKey(apiKey);
        if (!company) {
          return res.status(401).json({
            error: 'INVALID_API_KEY',
            message: 'Invalid or expired API key'
          });
        }

        if (company.status !== 'ACTIVE') {
          return res.status(403).json({
            error: 'COMPANY_SUSPENDED',
            message: 'Your enterprise gaming account has been suspended. Contact support.'
          });
        }

        // Step 3: Extract client IP
        const clientIP = getClientIP(req);
        if (!clientIP) {
          return res.status(400).json({
            error: 'IP_NOT_DETECTED',
            message: 'Could not determine client IP address'
          });
        }

        // Step 4: Check if IP is whitelisted (Exact or CIDR range)
        const isWhitelisted = await this.isIPWhitelisted(company.id, clientIP);

        if (!isWhitelisted) {
          // Log blocked attempt & evaluate brute force
          await this.logBlockedAttempt(clientIP, company.id, req.baseUrl + (req.path || ''), 'IP_NOT_WHITELISTED');
          await this.checkBruteForce(clientIP);

          return res.status(403).json({
            error: 'IP_NOT_WHITELISTED',
            message: `IP ${clientIP} is not authorized. Register your server IP in the enterprise dashboard.`,
            your_ip: clientIP
          });
        }

        // Step 5: Update IP usage timestamp
        await this.updateIPUsage(company.id, clientIP);

        // Step 6: Attach company and client IP to request
        req.company = company;
        req.clientIP = clientIP;

        // Step 7: Log successful API access asynchronously
        this.logAccess(company.id, clientIP, req).catch(err => {
          console.warn('[IP Whitelist] Audit log error:', err.message);
        });

        next();
      } catch (error) {
        console.error('[IP Whitelist] Middleware error:', error);
        return res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: 'IP Whitelist authorization service error'
        });
      }
    };
  }

  async getCompanyByAPIKey(apiKey) {
    const cacheKey = `company:apikey:${apiKey}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    if (this.sqliteDb) {
      const company = this.sqliteDb.prepare(`
        SELECT * FROM gaming_companies WHERE api_key = ?
      `).get(apiKey);
      if (company) {
        await this.setCache(cacheKey, company, 300);
      }
      return company || null;
    }

    if (this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT * FROM gaming_companies WHERE api_key = $1',
        [apiKey]
      );
      if (res.rows.length > 0) {
        await this.setCache(cacheKey, res.rows[0], 300);
        return res.rows[0];
      }
    }

    return null;
  }

  async isIPWhitelisted(companyId, clientIP) {
    const cacheKey = `whitelist:${companyId}:${clientIP}`;
    const cached = await this.getCache(cacheKey);
    if (cached === true) return true;

    if (this.sqliteDb) {
      // 1. Check exact IP match
      const exact = this.sqliteDb.prepare(`
        SELECT id FROM ip_whitelist
        WHERE company_id = ? AND ip_address = ? AND is_active = 1
      `).get(companyId, clientIP);

      if (exact) {
        await this.setCache(cacheKey, true, 600);
        return true;
      }

      // 2. Check CIDR ranges for this company
      const ranges = this.sqliteDb.prepare(`
        SELECT id, ip_range FROM ip_whitelist
        WHERE company_id = ? AND ip_range IS NOT NULL AND is_active = 1
      `).all(companyId);

      for (const r of ranges) {
        if (r.ip_range && isIPInCIDR(clientIP, r.ip_range)) {
          await this.setCache(cacheKey, true, 600);
          return true;
        }
      }
    } else if (this.pgPool) {
      // Postgres supports native inet & cidr operators
      const exact = await this.pgPool.query(`
        SELECT id FROM ip_whitelist
        WHERE company_id = $1 AND ip_address = $2::inet AND is_active = true
      `, [companyId, clientIP]);

      if (exact.rows.length > 0) {
        await this.setCache(cacheKey, true, 600);
        return true;
      }

      const rangeMatch = await this.pgPool.query(`
        SELECT id FROM ip_whitelist
        WHERE company_id = $1 AND ip_range IS NOT NULL AND $2::inet << ip_range AND is_active = true
      `, [companyId, clientIP]);

      if (rangeMatch.rows.length > 0) {
        await this.setCache(cacheKey, true, 600);
        return true;
      }
    }

    return false;
  }

  async updateIPUsage(companyId, clientIP) {
    const now = Date.now();
    if (this.sqliteDb) {
      this.sqliteDb.prepare(`
        UPDATE ip_whitelist
        SET last_used_at = ?
        WHERE company_id = ? AND (ip_address = ? OR ip_range IS NOT NULL)
      `).run(now, companyId, clientIP);

      this.sqliteDb.prepare(`
        UPDATE gaming_companies
        SET last_active_at = ?
        WHERE id = ?
      `).run(now, companyId);
    } else if (this.pgPool) {
      await this.pgPool.query(`
        UPDATE ip_whitelist
        SET last_used_at = $1
        WHERE company_id = $2 AND ip_address = $3::inet
      `, [now, companyId, clientIP]);
    }
  }

  async logAccess(companyId, clientIP, req) {
    const logId = 'log_' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const endpoint = req.baseUrl + (req.path || '');
    const method = req.method;
    const bodyStr = req.body ? JSON.stringify(req.body).substring(0, 1000) : '';
    const ua = req.headers ? req.headers['user-agent'] : '';

    if (this.sqliteDb) {
      this.sqliteDb.prepare(`
        INSERT INTO api_access_log (id, company_id, ip_address, endpoint, method, status_code, request_body, user_agent, accessed_at)
        VALUES (?, ?, ?, ?, ?, 200, ?, ?, ?)
      `).run(logId, companyId, clientIP, endpoint, method, bodyStr, ua, now);
    } else if (this.pgPool) {
      await this.pgPool.query(`
        INSERT INTO api_access_log (id, company_id, ip_address, endpoint, method, status_code, request_body, user_agent, accessed_at)
        VALUES ($1, $2, $3, $4, $5, 200, $6, $7, $8)
      `, [logId, companyId, clientIP, endpoint, method, bodyStr, ua, now]);
    }
  }

  async logBlockedAttempt(ip, companyId, endpoint, reason) {
    const id = 'blk_' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();

    if (this.sqliteDb) {
      this.sqliteDb.prepare(`
        INSERT INTO blocked_ip_attempts (id, ip_address, company_id, endpoint, reason, attempt_count, first_attempt, last_attempt)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(ip_address, endpoint) DO UPDATE SET
          attempt_count = blocked_ip_attempts.attempt_count + 1,
          last_attempt = excluded.last_attempt
      `).run(id, ip, companyId || null, endpoint, reason, now, now);
    } else if (this.pgPool) {
      await this.pgPool.query(`
        INSERT INTO blocked_ip_attempts (id, ip_address, company_id, endpoint, reason, attempt_count, first_attempt, last_attempt)
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
        ON CONFLICT (ip_address, endpoint) DO UPDATE SET
          attempt_count = blocked_ip_attempts.attempt_count + 1,
          last_attempt = $7
      `, [id, ip, companyId, endpoint, reason, now, now]);
    }
  }

  async checkBruteForce(ip) {
    const oneHourAgo = Date.now() - (3600 * 1000);
    let totalAttempts = 0;

    if (this.sqliteDb) {
      const row = this.sqliteDb.prepare(`
        SELECT SUM(attempt_count) as total FROM blocked_ip_attempts
        WHERE ip_address = ? AND last_attempt >= ?
      `).get(ip, oneHourAgo);
      totalAttempts = (row && row.total) ? Number(row.total) : 0;
    } else if (this.pgPool) {
      const res = await this.pgPool.query(`
        SELECT SUM(attempt_count) as total FROM blocked_ip_attempts
        WHERE ip_address = $1 AND last_attempt >= $2
      `, [ip, oneHourAgo]);
      totalAttempts = (res.rows[0] && res.rows[0].total) ? Number(res.rows[0].total) : 0;
    }

    if (totalAttempts > 50) {
      console.error(`🚨 [CRITICAL SECURITY ALERT] IP ${ip} exceeded 50 unauthorized attempts (${totalAttempts} detected)`);
    }
    return totalAttempts;
  }
}

module.exports = { IPWhitelistMiddleware };
