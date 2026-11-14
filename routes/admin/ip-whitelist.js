/**
 * DISHA 8.2 — Enterprise Admin IP Whitelist & Company Management Routes
 */

const express = require('express');
const crypto = require('crypto');
const defaultDb = require('../../db');
const { isValidIP, isValidCIDR } = require('../../utils/ip-utils');

const router = express.Router();

function getDb(req) {
  return req.db || defaultDb;
}

/**
 * POST /api/admin/companies
 * Create new enterprise/gaming tenant with generated API credentials
 */
router.post('/companies', async (req, res) => {
  try {
    const db = getDb(req);
    const { company_name, contact_email } = req.body;

    if (!company_name || !contact_email) {
      return res.status(400).json({ error: 'company_name and contact_email are required' });
    }

    const companyId = 'comp_' + crypto.randomBytes(8).toString('hex');
    const apiKey = 'disha_live_' + crypto.randomBytes(24).toString('hex');
    const apiSecret = 'disha_sec_' + crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    if (db.sqliteDb) {
      db.sqliteDb.prepare(`
        INSERT INTO gaming_companies (id, company_name, contact_email, api_key, api_secret, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
      `).run(companyId, company_name.trim(), contact_email.trim().toLowerCase(), apiKey, apiSecret, now);
    } else if (db.pgPool) {
      await db.pgPool.query(`
        INSERT INTO gaming_companies (id, company_name, contact_email, api_key, api_secret, status, created_at)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
      `, [companyId, company_name.trim(), contact_email.trim().toLowerCase(), apiKey, apiSecret, now]);
    }

    res.status(201).json({
      success: true,
      company: {
        id: companyId,
        company_name: company_name.trim(),
        contact_email: contact_email.trim().toLowerCase(),
        api_key: apiKey
      },
      api_key: apiKey,
      api_secret: apiSecret,
      message: 'Save API credentials securely. The secret will not be displayed again.'
    });
  } catch (error) {
    console.error('[Admin] Error creating company:', error);
    res.status(500).json({ error: 'Failed to create company: ' + error.message });
  }
});

/**
 * GET /api/admin/companies
 * List all companies with IP count and status
 */
router.get('/companies', async (req, res) => {
  try {
    const db = getDb(req);
    let companies = [];

    if (db.sqliteDb) {
      companies = db.sqliteDb.prepare(`
        SELECT c.*, COUNT(w.id) as ip_count
        FROM gaming_companies c
        LEFT JOIN ip_whitelist w ON c.id = w.company_id AND w.is_active = 1
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `).all();
    } else if (db.pgPool) {
      const result = await db.pgPool.query(`
        SELECT c.*, COUNT(w.id) as ip_count
        FROM gaming_companies c
        LEFT JOIN ip_whitelist w ON c.id = w.company_id AND w.is_active = true
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);
      companies = result.rows;
    }

    res.json({ success: true, companies });
  } catch (error) {
    console.error('[Admin] Error listing companies:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/companies/:companyId/ips
 * Add server IP or CIDR subnet to company whitelist
 */
router.post('/companies/:companyId/ips', async (req, res) => {
  try {
    const db = getDb(req);
    const { companyId } = req.params;
    const { ip_address, ip_range, description } = req.body;

    if (!ip_address && !ip_range) {
      return res.status(400).json({
        error: 'MISSING_IP',
        message: 'Either ip_address or ip_range (CIDR) is required'
      });
    }

    if (ip_address && !isValidIP(ip_address)) {
      return res.status(400).json({
        error: 'INVALID_IP',
        message: 'Invalid IP address format. Expected valid IPv4 or IPv6.'
      });
    }

    if (ip_range && !isValidCIDR(ip_range)) {
      return res.status(400).json({
        error: 'INVALID_CIDR',
        message: 'Invalid CIDR subnet format (e.g. 52.84.0.0/16 or 103.21.58.0/24)'
      });
    }

    const ipId = 'ip_' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const cleanIp = ip_address ? ip_address.trim() : null;
    const cleanRange = ip_range ? ip_range.trim() : null;
    const desc = description ? description.trim() : 'Game Server';

    if (db.sqliteDb) {
      // Check duplicate
      const existing = db.sqliteDb.prepare(`
        SELECT id FROM ip_whitelist
        WHERE company_id = ? AND (ip_address = ? OR (ip_range = ? AND ip_range IS NOT NULL))
      `).get(companyId, cleanIp, cleanRange);

      if (existing) {
        return res.status(409).json({
          error: 'DUPLICATE_IP',
          message: 'This IP or CIDR range is already whitelisted for this company'
        });
      }

      db.sqliteDb.prepare(`
        INSERT INTO ip_whitelist (id, company_id, ip_address, ip_range, description, is_active, added_by, added_at)
        VALUES (?, ?, ?, ?, ?, 1, 'admin', ?)
      `).run(ipId, companyId, cleanIp, cleanRange, desc, now);
    } else if (db.pgPool) {
      await db.pgPool.query(`
        INSERT INTO ip_whitelist (id, company_id, ip_address, ip_range, description, added_by, added_at)
        VALUES ($1, $2, $3, $4, $5, 'admin', $6)
      `, [ipId, companyId, cleanIp, cleanRange, desc, now]);
    }

    // Invalidate cached whitelist for this company
    if (req.ipWhitelist) {
      req.ipWhitelist.invalidateCache(companyId);
    }

    res.status(201).json({
      success: true,
      message: 'IP successfully whitelisted for enterprise game servers',
      whitelist_entry: {
        id: ipId,
        company_id: companyId,
        ip_address: cleanIp,
        ip_range: cleanRange,
        description: desc,
        added_at: now
      }
    });
  } catch (error) {
    console.error('[Admin] Error whitelisting IP:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/companies/:companyId/ips
 * List all whitelisted IPs for a company
 */
router.get('/companies/:companyId/ips', async (req, res) => {
  try {
    const db = getDb(req);
    const { companyId } = req.params;
    let ips = [];

    if (db.sqliteDb) {
      ips = db.sqliteDb.prepare(`
        SELECT * FROM ip_whitelist
        WHERE company_id = ?
        ORDER BY added_at DESC
      `).all(companyId);
    } else if (db.pgPool) {
      const result = await db.pgPool.query(`
        SELECT * FROM ip_whitelist
        WHERE company_id = $1
        ORDER BY added_at DESC
      `, [companyId]);
      ips = result.rows;
    }

    res.json({
      success: true,
      company_id: companyId,
      whitelisted_ips: ips,
      total: ips.length
    });
  } catch (error) {
    console.error('[Admin] Error listing whitelisted IPs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/companies/:companyId/ips/:ipId
 * Revoke IP from company whitelist
 */
router.delete('/companies/:companyId/ips/:ipId', async (req, res) => {
  try {
    const db = getDb(req);
    const { companyId, ipId } = req.params;

    if (db.sqliteDb) {
      db.sqliteDb.prepare(`
        DELETE FROM ip_whitelist WHERE id = ? AND company_id = ?
      `).run(ipId, companyId);
    } else if (db.pgPool) {
      await db.pgPool.query(`
        DELETE FROM ip_whitelist WHERE id = $1 AND company_id = $2
      `, [ipId, companyId]);
    }

    if (req.ipWhitelist) {
      req.ipWhitelist.invalidateCache(companyId);
    }

    res.json({ success: true, message: 'IP removed from whitelist' });
  } catch (error) {
    console.error('[Admin] Error revoking IP:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/blocked-attempts
 * Security monitoring: view blocked IP attempts and potential attacks
 */
router.get('/blocked-attempts', async (req, res) => {
  try {
    const db = getDb(req);
    let attempts = [];

    if (db.sqliteDb) {
      attempts = db.sqliteDb.prepare(`
        SELECT * FROM blocked_ip_attempts
        ORDER BY last_attempt DESC
        LIMIT 100
      `).all();
    } else if (db.pgPool) {
      const result = await db.pgPool.query(`
        SELECT * FROM blocked_ip_attempts
        ORDER BY last_attempt DESC
        LIMIT 100
      `);
      attempts = result.rows;
    }

    res.json({
      success: true,
      blocked_attempts: attempts,
      total: attempts.length
    });
  } catch (error) {
    console.error('[Admin] Error fetching blocked attempts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/access-logs
 * Security audit trail of authorized API accesses
 */
router.get('/access-logs', async (req, res) => {
  try {
    const db = getDb(req);
    let logs = [];

    if (db.sqliteDb) {
      logs = db.sqliteDb.prepare(`
        SELECT * FROM api_access_log
        ORDER BY accessed_at DESC
        LIMIT 100
      `).all();
    } else if (db.pgPool) {
      const result = await db.pgPool.query(`
        SELECT * FROM api_access_log
        ORDER BY accessed_at DESC
        LIMIT 100
      `);
      logs = result.rows;
    }

    res.json({
      success: true,
      logs,
      total: logs.length
    });
  } catch (error) {
    console.error('[Admin] Error fetching access logs:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
