/**
 * DISHA 8.2 — 1000 VPA Anti-Ban Routing Engine
 * Implements 5-Factor Scoring, Human-Like Chaos Jitter, Dynamic Cooldowns (8-15 min),
 * Pattern Masking, Sender Diversity Throttling, and Automated Quarantine.
 */

const crypto = require('crypto');

class VPARouter {
  constructor(db) {
    this.db = db;
  }

  get sqliteDb() {
    if (!this.db) return null;
    return this.db.sqliteDb || (typeof this.db.prepare === 'function' ? this.db : null);
  }

  get pgPool() {
    if (!this.db) return null;
    return this.db.pgPool || null;
  }

  /**
   * Synchronous VPA selection for SQLite environments
   */
  selectVPASync(merchantId = 'mer_default', amount = 100.0, customerRegion = 'MH', timeOfDay = null, customerVpa = null) {
    const numAmt = Number(amount);
    const now = Date.now();
    const currentHour = timeOfDay !== null ? timeOfDay : new Date().getHours();
    const dayOfWeek = new Date().getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // STEP 1: Query eligible active candidates
    const candidates = this.getEligibleCandidatesSync(merchantId, numAmt, now, currentHour, isWeekend);

    let selectedCandidate = null;

    if (!candidates || candidates.length === 0) {
      // Cooldown & Time-Slot Grace Fallback
      const fallback = this.getFallbackCandidatesSync(merchantId, numAmt, now);
      if (!fallback || fallback.length === 0) {
        throw new Error('NO_HEALTHY_VPA_AVAILABLE: All merchant VPAs are currently exhausted or quarantined.');
      }
      selectedCandidate = fallback[0];
    } else {
      // STEP 2: Score each VPA using the 5-Factor Algorithm
      const scored = candidates.map(vpa => {
        const score = this.calculateScore(vpa, numAmt, customerRegion, currentHour, isWeekend, now);
        return { ...vpa, score };
      });

      // STEP 3: Apply Pattern Masking (penalty for recent 10 transactions)
      const recentVpaIds = this.getRecentVPAIdsSync(merchantId, 10);
      scored.forEach(vpa => {
        if (recentVpaIds.includes(vpa.id) || recentVpaIds.includes(vpa.vpa_address)) {
          vpa.score *= 0.3; // 70% penalty for recent use to mask patterns
        }
      });

      // STEP 4: Top-10 Selection with Weighted Randomness (Non-deterministic dispersion)
      const topN = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(10, scored.length));

      selectedCandidate = this.weightedRandom(topN) || topN[0];
    }

    // STEP 5 & 6: Update State & Telemetry Log
    return this.finalizeSelectionSync(selectedCandidate, numAmt, merchantId, customerRegion, customerVpa, now);
  }

  /**
   * Async selection (supports both SQLite and Postgres)
   */
  async selectVPA(merchantId = 'mer_default', amount = 100.0, customerRegion = 'MH', timeOfDay = null, customerVpa = null) {
    if (this.sqliteDb) {
      return this.selectVPASync(merchantId, amount, customerRegion, timeOfDay, customerVpa);
    }

    const numAmt = Number(amount);
    const now = Date.now();
    const currentHour = timeOfDay !== null ? timeOfDay : new Date().getHours();
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const candidates = await this.getEligibleCandidatesPg(merchantId, numAmt, now, currentHour, isWeekend);
    let selectedCandidate = null;

    if (!candidates || candidates.length === 0) {
      const fallback = await this.getFallbackCandidatesPg(merchantId, numAmt, now);
      if (!fallback || fallback.length === 0) {
        throw new Error('NO_HEALTHY_VPA_AVAILABLE: All merchant VPAs are currently exhausted or quarantined.');
      }
      selectedCandidate = fallback[0];
    } else {
      const scored = candidates.map(vpa => {
        const score = this.calculateScore(vpa, numAmt, customerRegion, currentHour, isWeekend, now);
        return { ...vpa, score };
      });

      const recentVpaIds = await this.getRecentVPAIdsPg(merchantId, 10);
      scored.forEach(vpa => {
        if (recentVpaIds.includes(vpa.id) || recentVpaIds.includes(vpa.vpa_address)) {
          vpa.score *= 0.3;
        }
      });

      const topN = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(10, scored.length));

      selectedCandidate = this.weightedRandom(topN) || topN[0];
    }

    return await this.finalizeSelectionPg(selectedCandidate, numAmt, merchantId, customerRegion, customerVpa, now);
  }

  /**
   * Deterministic 5-Factor Scoring Calculation (without chaos jitter)
   */
  calculateBaseScore(vpa, amount, customerRegion, currentHour, isWeekend, now) {
    // Factor 1: Health Factor (0.0 to 1.0)
    const healthFactor = Math.max(0, Math.min(1.0, (vpa.health_score || 100) / 100));

    // Factor 2: Cooldown & Rest Factor
    const lastUsed = vpa.last_used_at || (now - (120 * 60 * 1000));
    const minutesSinceLastUse = Math.max(0, (now - lastUsed) / 60000);
    const cooldownFactor = Math.min(minutesSinceLastUse / 120, 1.0); // Cap at 2 hours

    // Factor 3: Daily Load Factor
    const txLimit = isWeekend ? Math.floor((vpa.daily_tx_limit || 15) * 0.5) : (vpa.daily_tx_limit || 15);
    const currentTx = vpa.daily_tx_count || 0;
    const loadFactor = Math.max(0, 1.0 - (currentTx / (txLimit || 15)));

    // Factor 4: Time-of-Day Match
    const timeMatch = this.getTimeMatchScore(vpa, currentHour);

    // Factor 5: Geographic Diversity Score
    const geoFactor = this.getGeoDiversityScore(vpa, customerRegion);

    return (
      (healthFactor * 0.30) +
      (cooldownFactor * 0.25) +
      (loadFactor * 0.20) +
      (timeMatch * 0.15) +
      (geoFactor * 0.10)
    );
  }

  /**
   * 5-Factor Scoring Algorithm with Human-Like Chaos Jitter (5% - 20%)
   */
  calculateScore(vpa, amount, customerRegion, currentHour, isWeekend, now, applyJitter = true) {
    const base = this.calculateBaseScore(vpa, amount, customerRegion, currentHour, isWeekend, now);
    const jitter = applyJitter ? (0.95 + (Math.random() * 0.20)) : 1.0;
    return Math.max(0.01, base * jitter);
  }

  getTimeMatchScore(vpa, hour) {
    const slot = (vpa.preferred_time_slot || 'ANY').toUpperCase();
    if (slot === 'ANY') return 0.85;

    // Morning VPAs: 6 AM to 12 PM
    if (slot === 'MORNING' && hour >= 6 && hour < 12) return 1.0;
    // Afternoon VPAs: 12 PM to 5 PM
    if (slot === 'AFTERNOON' && hour >= 12 && hour < 17) return 1.0;
    // Evening VPAs: 5 PM to 10 PM
    if (slot === 'EVENING' && hour >= 17 && hour < 22) return 1.0;

    return 0.4; // Outside preferred time slot
  }

  getGeoDiversityScore(vpa, customerRegion) {
    return vpa.region_diversity_score || 0.85;
  }

  weightedRandom(items) {
    if (!items || items.length === 0) return null;
    if (items.length === 1) return items[0];

    const totalWeight = items.reduce((sum, item) => sum + Math.max(0.01, item.score || 1), 0);
    let random = Math.random() * totalWeight;

    for (const item of items) {
      random -= Math.max(0.01, item.score || 1);
      if (random <= 0) return item;
    }
    return items[items.length - 1];
  }

  finalizeSelectionSync(selected, amount, merchantId, customerRegion, customerVpa, now) {
    // Dynamic Cooldown: 8 to 15 minutes (8 base + 0 to 7 random minutes)
    const cooldownMinutes = 8 + Math.floor(Math.random() * 7);
    const cooldownUntil = now + (cooldownMinutes * 60 * 1000);

    if (this.sqliteDb) {
      this.sqliteDb.prepare(`
        UPDATE vpa_pool
        SET daily_tx_count = daily_tx_count + 1,
            daily_volume = daily_volume + ?,
            last_used_at = ?,
            cooldown_until = ?
        WHERE id = ?
      `).run(amount, now, cooldownUntil, selected.id);

      const logId = 'log_' + crypto.randomBytes(8).toString('hex');
      const hour = new Date(now).getHours();
      const timeSlot = hour < 12 ? 'MORNING' : (hour < 17 ? 'AFTERNOON' : 'EVENING');

      this.sqliteDb.prepare(`
        INSERT INTO vpa_usage_log (id, vpa_id, merchant_id, amount, customer_region, time_slot, used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(logId, selected.id, merchantId, amount, customerRegion, timeSlot, now);

      if (customerVpa) {
        const sendId = 'send_' + crypto.randomBytes(8).toString('hex');
        const dateStr = new Date(now).toISOString().substring(0, 10);
        this.sqliteDb.prepare(`
          INSERT INTO vpa_sender_tracking (id, vpa_id, customer_vpa, tracking_date, tx_count, last_seen)
          VALUES (?, ?, ?, ?, 1, ?)
          ON CONFLICT(vpa_id, customer_vpa, tracking_date) DO UPDATE SET
            tx_count = tx_count + 1,
            last_seen = excluded.last_seen
        `).run(sendId, selected.id, customerVpa, dateStr, now);
      }
    }

    return {
      vpaAddress: selected.vpa_address,
      vpaId: selected.id,
      holderName: selected.holder_name || 'Merchant Payee',
      bankName: selected.bank_name || 'Scheduled Bank',
      healthScore: selected.health_score || 100,
      cooldownMinutes,
      cooldownUntil
    };
  }

  async finalizeSelectionPg(selected, amount, merchantId, customerRegion, customerVpa, now) {
    const cooldownMinutes = 8 + Math.floor(Math.random() * 7);
    const cooldownUntil = now + (cooldownMinutes * 60 * 1000);

    if (this.pgPool) {
      await this.pgPool.query(`
        UPDATE vpa_pool
        SET daily_tx_count = daily_tx_count + 1,
            daily_volume = daily_volume + $1,
            last_used_at = $2,
            cooldown_until = $3
        WHERE id = $4
      `, [amount, now, cooldownUntil, selected.id]);

      const logId = 'log_' + crypto.randomBytes(8).toString('hex');
      const hour = new Date(now).getHours();
      const timeSlot = hour < 12 ? 'MORNING' : (hour < 17 ? 'AFTERNOON' : 'EVENING');

      await this.pgPool.query(`
        INSERT INTO vpa_usage_log (id, vpa_id, merchant_id, amount, customer_region, time_slot, used_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [logId, selected.id, merchantId, amount, customerRegion, timeSlot, now]);
    }

    return {
      vpaAddress: selected.vpa_address,
      vpaId: selected.id,
      holderName: selected.holder_name || 'Merchant Payee',
      bankName: selected.bank_name || 'Scheduled Bank',
      healthScore: selected.health_score || 100,
      cooldownMinutes,
      cooldownUntil
    };
  }

  getEligibleCandidatesSync(merchantId, amount, now, currentHour, isWeekend) {
    if (!this.sqliteDb) return [];

    const rows = this.sqliteDb.prepare(`
      SELECT * FROM vpa_pool
      WHERE (merchant_id = ? OR merchant_id = 'mer_default')
        AND status = 'ACTIVE'
        AND health_score > 65
        AND daily_tx_count < daily_tx_limit
        AND (daily_volume + ?) <= daily_volume_limit
        AND cooldown_until <= ?
        AND (? >= active_hours_start AND ? < active_hours_end)
      ORDER BY health_score DESC
      LIMIT 100
    `).all(merchantId, amount, now, currentHour, currentHour);

    if (isWeekend) {
      return rows.filter(r => r.daily_tx_count < Math.floor(r.daily_tx_limit * 0.5));
    }
    return rows;
  }

  async getEligibleCandidatesPg(merchantId, amount, now, currentHour, isWeekend) {
    if (!this.pgPool) return [];

    const res = await this.pgPool.query(`
      SELECT * FROM vpa_pool
      WHERE (merchant_id = $1 OR merchant_id = 'mer_default')
        AND status = 'ACTIVE'
        AND health_score > 65
        AND daily_tx_count < daily_tx_limit
        AND (daily_volume + $2) <= daily_volume_limit
        AND cooldown_until <= $3
        AND ($4 >= active_hours_start AND $4 < active_hours_end)
      ORDER BY health_score DESC
      LIMIT 100
    `, [merchantId, amount, now, currentHour]);

    if (isWeekend) {
      return res.rows.filter(r => r.daily_tx_count < Math.floor(r.daily_tx_limit * 0.5));
    }
    return res.rows;
  }

  getFallbackCandidatesSync(merchantId, amount, now) {
    if (!this.sqliteDb) return [];
    return this.sqliteDb.prepare(`
      SELECT * FROM vpa_pool
      WHERE (merchant_id = ? OR merchant_id = 'mer_default')
        AND status = 'ACTIVE'
        AND health_score > 50
      ORDER BY last_used_at ASC, daily_tx_count ASC
      LIMIT 5
    `).all(merchantId);
  }

  async getFallbackCandidatesPg(merchantId, amount, now) {
    if (!this.pgPool) return [];
    const res = await this.pgPool.query(`
      SELECT * FROM vpa_pool
      WHERE (merchant_id = $1 OR merchant_id = 'mer_default')
        AND status = 'ACTIVE'
        AND health_score > 50
      ORDER BY last_used_at ASC, daily_tx_count ASC
      LIMIT 5
    `, [merchantId]);
    return res.rows;
  }

  getRecentVPAIdsSync(merchantId, limit = 10) {
    if (!this.sqliteDb) return [];
    const rows = this.sqliteDb.prepare(`
      SELECT vpa_id FROM vpa_usage_log
      WHERE merchant_id = ? OR merchant_id = 'mer_default'
      ORDER BY used_at DESC LIMIT ?
    `).all(merchantId, limit);
    return rows.map(r => r.vpa_id);
  }

  async getRecentVPAIdsPg(merchantId, limit = 10) {
    if (!this.pgPool) return [];
    const res = await this.pgPool.query(`
      SELECT vpa_id FROM vpa_usage_log
      WHERE merchant_id = $1 OR merchant_id = 'mer_default'
      ORDER BY used_at DESC LIMIT $2
    `, [merchantId, limit]);
    return res.rows.map(r => r.vpa_id);
  }

  /**
   * Emergency Quarantine Procedure:
   * Sets status to 'COOLDOWN', drops health to 30, and enforces 7-day cooldown.
   */
  quarantineVPA(vpaId, reason = 'Bank anomaly / automated warning') {
    const now = Date.now();
    const cooldown7Days = now + (7 * 86400000);
    const eventId = 'evt_' + crypto.randomBytes(8).toString('hex');

    if (this.sqliteDb) {
      this.sqliteDb.prepare(`
        UPDATE vpa_pool
        SET status = 'COOLDOWN',
            health_score = 30,
            risk_level = 'HIGH',
            cooldown_until = ?
        WHERE id = ?
      `).run(cooldown7Days, vpaId);

      this.sqliteDb.prepare(`
        INSERT INTO vpa_health_events (id, vpa_id, event_type, severity, description, health_impact, created_at)
        VALUES (?, ?, 'QUARANTINE', 'HIGH', ?, -40, ?)
      `).run(eventId, vpaId, reason, now);
    } else if (this.pgPool) {
      this.pgPool.query(`
        UPDATE vpa_pool
        SET status = 'COOLDOWN',
            health_score = 30,
            risk_level = 'HIGH',
            cooldown_until = $1
        WHERE id = $2
      `, [cooldown7Days, vpaId]);
    }

    console.log(`🚨 [VPARouter] VPA ${vpaId} QUARANTINED for 7 days. Reason: ${reason}`);
    return { success: true, vpaId, status: 'COOLDOWN', cooldownUntil: cooldown7Days, reason };
  }

  /**
   * Daily Health Reset & Score Rebalancing (6 AM Cron)
   */
  dailyHealthResetAndRebalance() {
    const now = Date.now();
    console.log('🌅 [VPARouter] Running daily VPA health reset and rebalance...');

    if (this.sqliteDb) {
      // 1. Reset daily counters
      this.sqliteDb.prepare(`
        UPDATE vpa_pool
        SET daily_tx_count = 0,
            daily_volume = 0.0,
            unique_senders_today = 0
        WHERE status != 'RETIRED' AND status != 'BANNED'
      `).run();

      // 2. Health recovery (+2 for clean day, capped at 100)
      this.sqliteDb.prepare(`
        UPDATE vpa_pool
        SET health_score = MIN(100, health_score + 2)
        WHERE status = 'ACTIVE' AND health_score < 100
      `).run();

      // 3. Auto-quarantine if health fell below 50
      this.sqliteDb.prepare(`
        UPDATE vpa_pool
        SET status = 'COOLDOWN',
            risk_level = 'HIGH'
        WHERE health_score < 50 AND status = 'ACTIVE'
      `).run();
    }

    return { success: true, timestamp: now };
  }

  /**
   * Pool Analytics & Bank Diversity Metrics
   */
  getPoolAnalytics(merchantId = 'mer_default') {
    if (this.sqliteDb) {
      const allVpas = this.sqliteDb.prepare(`
        SELECT * FROM vpa_pool WHERE merchant_id = ? OR merchant_id = 'mer_default'
      `).all(merchantId);

      const total = allVpas.length;
      const active = allVpas.filter(v => v.status === 'ACTIVE').length;
      const cooldown = allVpas.filter(v => v.status === 'COOLDOWN').length;
      const flagged = allVpas.filter(v => v.status === 'FLAGGED' || v.status === 'BANNED').length;
      const avgHealth = total > 0 ? (allVpas.reduce((s, v) => s + (v.health_score || 0), 0) / total).toFixed(1) : 100;

      // Bank diversity
      const bankCounts = {};
      allVpas.forEach(v => {
        const b = v.bank_name || 'Other';
        bankCounts[b] = (bankCounts[b] || 0) + 1;
      });

      const bankDiversity = Object.keys(bankCounts).map(bank => ({
        bank,
        count: bankCounts[bank],
        pct: total > 0 ? Math.round((bankCounts[bank] / total) * 100) : 0
      })).sort((a, b) => b.count - a.count);

      // Time slots
      const timeSlots = {
        MORNING: allVpas.filter(v => v.preferred_time_slot === 'MORNING').length,
        AFTERNOON: allVpas.filter(v => v.preferred_time_slot === 'AFTERNOON').length,
        EVENING: allVpas.filter(v => v.preferred_time_slot === 'EVENING').length,
        ANY: allVpas.filter(v => v.preferred_time_slot === 'ANY' || !v.preferred_time_slot).length
      };

      // Capacity calculations
      const dailySafeTxCapacity = active * 15;
      const dailySafeVolumeCapacity = active * 25000;

      return {
        total,
        active,
        cooldown,
        flagged,
        avgHealth: Number(avgHealth),
        bankDiversity,
        timeSlots,
        capacity: {
          dailySafeTxCapacity,
          dailySafeVolumeCapacity,
          monthlySafeVolumeCapacity: dailySafeVolumeCapacity * 30
        }
      };
    }

    return { total: 0, active: 0, avgHealth: 100, bankDiversity: [], timeSlots: {}, capacity: {} };
  }
}

module.exports = VPARouter;
