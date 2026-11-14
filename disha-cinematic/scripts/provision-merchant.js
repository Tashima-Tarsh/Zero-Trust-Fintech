#!/usr/bin/env node
/**
 * DISHA Sovereign Merchant Provisioning Tool
 * Usage: node scripts/provision-merchant.js <email> <password> [businessName] [phone] [city] [primaryVpa]
 */

const path = require('path');
const db = require('../db');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
============================================================
🏦 DISHA Sovereign Fintech - Merchant Provisioning CLI
============================================================
Usage:
  node scripts/provision-merchant.js <email> <password> [businessName] [phone] [city] [primaryVpa]

Examples:
  # Provision a merchant needing first-time setup:
  node scripts/provision-merchant.js merchant1@store.com SecurePass123!

  # Provision a merchant with full pre-configured profile:
  node scripts/provision-merchant.js patil@supermarket.in PatilPass99! "Patil Supermarket" 9823011223 "Solapur" "patil.market@icici"
============================================================
  `);
  process.exit(1);
}

const [email, password, businessName = '', phone = '', city = '', primaryVpa = ''] = args;

try {
  const existing = db.findMerchantByEmail(email);
  if (existing) {
    console.error(`❌ Error: Merchant with email "${email}" already exists (ID: ${existing.id}).`);
    process.exit(1);
  }

  const setupCompleted = businessName && primaryVpa ? 1 : 0;
  const merchant = db.createMerchant({
    email,
    password,
    businessName,
    phone,
    city,
    primaryVpa,
    setupCompleted
  });

  console.log(`
============================================================
✅ MERCHANT PROVISIONED SUCCESSFULLY
============================================================
Merchant ID:       ${merchant.id}
Email / Login ID:  ${merchant.email}
Business Name:     ${merchant.business_name || '(Pending first-time setup)'}
Contact Phone:     ${merchant.contact_phone || '(Not provided)'}
Primary UPI VPA:   ${merchant.primary_vpa || '(Pending setup)'}
Setup Status:      ${merchant.setup_completed ? 'COMPLETE' : 'PENDING (Will prompt on first login)'}
Portal Login URL:  http://localhost:5000/login
============================================================
  `);
} catch (err) {
  console.error(`❌ Failed to provision merchant: ${err.message}`);
  process.exit(1);
}
