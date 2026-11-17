'use strict';
const crypto = require('node:crypto');
const merchantDb = require('./db');
const { db } = merchantDb;
// Stable, exclusive Clerk user-to-merchant ownership without changing existing merchants.
db.exec(`CREATE TABLE IF NOT EXISTS clerk_merchant_links (
  clerk_user_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE REFERENCES merchants(id)
)`);
function linkedMerchant(userId) {
  const link = db.prepare('SELECT merchant_id FROM clerk_merchant_links WHERE clerk_user_id = ?').get(userId);
  return link ? merchantDb.findMerchantById(link.merchant_id) : null;
}
function linkVerifiedMerchant(userId, verifiedEmail) {
  if (!userId || !verifiedEmail) return null;
  const email = verifiedEmail.trim().toLowerCase();
  db.exec('BEGIN IMMEDIATE');
  try {
    let merchant = linkedMerchant(userId);
    if (!merchant) {
      const match = db.prepare('SELECT id FROM merchants WHERE LOWER(email) = ?').get(email);
      if (match && db.prepare('SELECT 1 FROM clerk_merchant_links WHERE merchant_id = ?').get(match.id)) {
        db.exec('ROLLBACK');
        return null;
      }
      merchant = match ? merchantDb.findMerchantById(match.id) : merchantDb.createMerchant({
        email, password: crypto.randomBytes(48).toString('hex')
      });
      db.prepare('INSERT INTO clerk_merchant_links (clerk_user_id, merchant_id) VALUES (?, ?)').run(userId, merchant.id);
    }
    db.exec('COMMIT');
    return merchant;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
async function authenticate(req) {
  const { getAuth, clerkClient } = require('@clerk/express');
  const { isAuthenticated, userId } = getAuth(req);
  if (!isAuthenticated || !userId) return null;
  const linked = linkedMerchant(userId);
  if (linked) return linked;
  const user = await clerkClient.users.getUser(userId);
  const primary = user.emailAddresses?.find(address => address.id === user.primaryEmailAddressId);
  if (primary?.verification?.status !== 'verified') return null;
  return linkVerifiedMerchant(userId, primary.emailAddress);
}
module.exports = { authenticate, linkedMerchant, linkVerifiedMerchant };
