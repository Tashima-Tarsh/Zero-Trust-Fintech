/**
 * DISHA 8.2 — VPA Bulk Importer & Validator
 * Supports Excel CSV and JSON ingestion for 1000+ Personal VPAs.
 * Automatically distributes human time slots and validates bank diversity.
 */

const crypto = require('crypto');

const VPA_REGEX = /^[\w.-]+@[\w]+$/;

function parseCSV(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ''));
    if (values.length < headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx];
    });
    rows.push(row);
  }

  return rows;
}

class VPAImporter {
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
   * Ingest VPAs from parsed rows (CSV or JSON array)
   */
  async importVPAs(rows, merchantId = 'mer_default') {
    const results = {
      total: rows.length,
      added: 0,
      skipped: 0,
      errors: []
    };

    const slots = ['MORNING', 'AFTERNOON', 'EVENING'];
    const now = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vpaAddress = String(r.vpa_address || r.vpa || '').trim().toLowerCase();

      // Validation 1: Format
      if (!VPA_REGEX.test(vpaAddress) || vpaAddress.length > 50) {
        results.errors.push({ row: i + 1, vpa: vpaAddress, error: 'Invalid VPA format' });
        results.skipped++;
        continue;
      }

      // Time Slot assignment (distribute 33/33/34 evenly if missing)
      const timeSlot = (r.preferred_time_slot || slots[i % 3]).toUpperCase();
      const holderName = r.holder_name || `Account Holder ${i + 1}`;
      const bankName = r.bank_name || this.detectBankFromVpa(vpaAddress);
      const accountType = (r.account_type || 'PERSONAL').toUpperCase();

      // MERCHANT rows require a real 4-digit mcc; reject guesses like 5812
      let mcc = '0000';
      if (accountType === 'MERCHANT') {
        if (!r.mcc || !/^\d{4}$/.test(String(r.mcc).trim())) {
          results.errors.push({ row: i + 1, vpa: vpaAddress, error: 'MERCHANT VPA requires a real 4-digit mcc' });
          results.skipped++;
          continue;
        }
        mcc = String(r.mcc).trim();
      }

      const dailyTxLimit = parseInt(r.daily_tx_limit, 10) || 15;
      const dailyVolLimit = parseFloat(r.daily_volume_limit) || 25000.0;
      const perTxLimit = parseFloat(r.per_tx_limit) || 5000.0;
      const minGap = parseInt(r.min_gap_minutes, 10) || 8;
      const startHour = parseInt(r.active_hours_start, 10) || 8;
      const endHour = parseInt(r.active_hours_end, 10) || 22;
      const notes = r.notes || '';
      const vpaId = 'vpa_' + crypto.randomBytes(8).toString('hex');

      try {
        if (this.db.sqliteDb) {
          const stmt = this.db.sqliteDb.prepare(`
            INSERT INTO vpa_pool (
              id, vpa_address, holder_name, bank_name, account_type, status,
              health_score, risk_level, preferred_time_slot, active_hours_start,
              active_hours_end, daily_tx_limit, daily_volume_limit, per_tx_limit,
              unique_senders_daily_limit, daily_tx_count, daily_volume,
              unique_senders_today, min_gap_minutes, cooldown_until, merchant_id,
              mcc, notes, excel_row_id, created_at
            ) VALUES (
              ?, ?, ?, ?, ?, 'ACTIVE',
              100, 'LOW', ?, ?,
              ?, ?, ?, ?,
              12, 0, 0.0,
              0, ?, ?, ?,
              ?, ?, ?, ?
            )
          `);

          const info = stmt.run(
            vpaId, vpaAddress, holderName, bankName, accountType,
            timeSlot, startHour, endHour, dailyTxLimit, dailyVolLimit, perTxLimit,
            minGap, 0, merchantId, mcc, notes, `row_${i + 1}`, now
          );

          if (info.changes > 0) {
            results.added++;
          } else {
            results.skipped++;
          }
        } else if (this.pgPool) {
          const info = await this.pgPool.query(
            'INSERT INTO vpa_pool (id,vpa_address,holder_name,bank_name,account_type,status,' +
            'health_score,risk_level,preferred_time_slot,active_hours_start,active_hours_end,' +
            'daily_tx_limit,daily_volume_limit,per_tx_limit,unique_senders_daily_limit,daily_tx_count,' +
            'daily_volume,unique_senders_today,min_gap_minutes,cooldown_until,merchant_id,mcc,notes,excel_row_id,created_at) ' +
            "VALUES ($1,$2,$3,$4,$5,'ACTIVE',100,'LOW',$6,$7,$8,$9,$10,$11,12,0,0,0,$12,0,$13,$14,$15,$16,$17) " +
            'ON CONFLICT (vpa_address) DO NOTHING',
            [vpaId,vpaAddress,holderName,bankName,accountType,timeSlot,startHour,endHour,
              dailyTxLimit,dailyVolLimit,perTxLimit,minGap,merchantId,mcc,notes,'row_'+(i+1),now]
          );
          if (info.rowCount > 0) results.added++;
          else results.skipped++;
        } else {
          throw new Error('NO_DATABASE_BACKEND');
        }
      } catch (err) {
        results.errors.push({ row: i + 1, vpa: vpaAddress, error: err.message });
        results.skipped++;
      }
    }

    // Bank Diversity Audit
    results.bankDiversityWarning = this.checkBankDiversity(rows);

    return results;
  }

  detectBankFromVpa(vpa) {
    if (vpa.includes('@oksbi') || vpa.includes('@sbi')) return 'SBI';
    if (vpa.includes('@okhdfcbank') || vpa.includes('@hdfcbank')) return 'HDFC Bank';
    if (vpa.includes('@okicici') || vpa.includes('@icici')) return 'ICICI Bank';
    if (vpa.includes('@okaxis') || vpa.includes('@axisbank')) return 'Axis Bank';
    if (vpa.includes('@ybl') || vpa.includes('@yesbank')) return 'YES Bank';
    if (vpa.includes('@paytm')) return 'Paytm Payments Bank';
    if (vpa.includes('@kotak')) return 'Kotak Mahindra Bank';
    if (vpa.includes('@barodampay')) return 'Bank of Baroda';
    if (vpa.includes('@pnb')) return 'PNB';
    return 'Other Scheduled Bank';
  }

  checkBankDiversity(rows) {
    const total = rows.length;
    if (total === 0) return null;

    const bankCounts = {};
    rows.forEach(r => {
      const b = r.bank_name || this.detectBankFromVpa(r.vpa_address || '');
      bankCounts[b] = (bankCounts[b] || 0) + 1;
    });

    const dominantBanks = [];
    for (const b of Object.keys(bankCounts)) {
      const pct = (bankCounts[b] / total) * 100;
      if (pct > 30) {
        dominantBanks.push(`${b} (${pct.toFixed(1)}%)`);
      }
    }

    if (dominantBanks.length > 0) {
      return `Warning: Single bank concentration exceeds recommended 30%: ${dominantBanks.join(', ')}`;
    }
    return null;
  }

  /**
   * Generates a sample cohort of diverse personal VPAs for simulation testing
   */
  generateMockPool(count = 30) {
    const banks = [
      { name: 'SBI', handle: 'oksbi' },
      { name: 'HDFC Bank', handle: 'okhdfcbank' },
      { name: 'ICICI Bank', handle: 'okicici' },
      { name: 'Axis Bank', handle: 'okaxis' },
      { name: 'YES Bank', handle: 'ybl' },
      { name: 'Paytm Payments Bank', handle: 'paytm' },
      { name: 'Kotak Mahindra Bank', handle: 'kotak' }
    ];

    const names = [
      'Rahul Kumar', 'Priya Sharma', 'Amit Patel', 'Sneha Gupta', 'Vikram Singh',
      'Ananya Deshmukh', 'Rajesh Iyer', 'Neha Verma', 'Sanjay Joshi', 'Kavita Nair',
      'Rohan Mehta', 'Deepa Reddy', 'Manoj Kulkarni', 'Sunita Rao', 'Arjun Saxena'
    ];

    const slots = ['MORNING', 'AFTERNOON', 'EVENING'];
    const mockRows = [];

    for (let i = 0; i < count; i++) {
      const b = banks[i % banks.length];
      const name = names[i % names.length];
      const cleanPrefix = name.toLowerCase().replace(/\s+/g, '.') + (Math.floor(10 + Math.random() * 89));
      const vpa = `${cleanPrefix}@${b.handle}`;

      mockRows.push({
        vpa_address: vpa,
        holder_name: name,
        bank_name: b.name,
        account_type: 'PERSONAL',
        mcc: '0000',
        preferred_time_slot: slots[i % 3],
        active_hours_start: 8,
        active_hours_end: 22,
        daily_tx_limit: 15,
        daily_volume_limit: 25000,
        per_tx_limit: 5000,
        min_gap_minutes: 8,
        notes: `Simulated personal VPA #${i + 1}`
      });
    }

    return mockRows;
  }
}

module.exports = {
  parseCSV,
  VPAImporter
};
