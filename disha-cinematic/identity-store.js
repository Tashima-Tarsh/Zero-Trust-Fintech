const crypto = require('crypto');
const data = require('./db');
const db = data.db;
db.exec(`CREATE TABLE IF NOT EXISTS clerk_merchants (
  clerk_user_id TEXT PRIMARY KEY,
  merchant_id TEXT UNIQUE NOT NULL REFERENCES merchants(id),
  welcome_status TEXT NOT NULL DEFAULT 'pending',
  welcome_attempts INTEGER NOT NULL DEFAULT 0,
  welcome_last_attempt INTEGER NOT NULL DEFAULT 0
);`);

function find(userId) {
  const row = db.prepare('SELECT merchant_id FROM clerk_merchants WHERE clerk_user_id = ?').get(userId);
  return row ? data.findMerchantById(row.merchant_id) : null;
}
function resolve(userId, email) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let merchant = find(userId);
    if (!merchant) {
      const existing = db.prepare('SELECT id FROM merchants WHERE LOWER(email) = ?').get(email);
      if (existing) {
        const linked = db.prepare('SELECT clerk_user_id FROM clerk_merchants WHERE merchant_id = ?').get(existing.id);
        if (linked) { db.exec('ROLLBACK'); return null; }
        merchant = data.findMerchantById(existing.id);
      } else {
        merchant = data.createMerchant({ email, password: crypto.randomBytes(48).toString('hex') });
      }
      db.prepare('INSERT INTO clerk_merchants (clerk_user_id,merchant_id,welcome_status) VALUES (?,?,?)').run(userId, merchant.id, existing ? 'skipped' : 'pending');
    }
    db.exec('COMMIT');
    return merchant;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
async function sendWelcome(userId, merchant) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const claimed = db.prepare(`UPDATE clerk_merchants SET welcome_attempts = welcome_attempts + 1, welcome_last_attempt = ?
    WHERE clerk_user_id = ? AND welcome_status = 'pending' AND welcome_attempts < 3 AND welcome_last_attempt < ?`).run(Date.now(), userId, Date.now() - 300000);
  if (!claimed.changes) return;
  const { Resend } = require('resend');
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.EMAIL_FROM, to: merchant.email,
    subject: 'Welcome to DISHA 8.2',
    text: `Your DISHA 8.2 account is ready. Complete your business setup at ${new URL('/setup', process.env.APP_URL).href}`,
  }, { idempotencyKey: `welcome-${userId}` });
  if (result.error || !result.data?.id) throw new Error('Welcome email not accepted');
  db.prepare("UPDATE clerk_merchants SET welcome_status = 'sent' WHERE clerk_user_id = ?").run(userId);
}
module.exports = { find, resolve, sendWelcome };
