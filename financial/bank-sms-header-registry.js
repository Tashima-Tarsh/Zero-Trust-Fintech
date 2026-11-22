'use strict';
/**
 * DISHA source-backed bank sender registry.
 * Identifies a sender HEADER only. It never authenticates an SMS delivery,
 * proves that the bank sent the message, or verifies a payer debit.
 */
const source = require('./data/india-bank-sms-headers.json');

function parseSender(input) {
  if (typeof input !== 'string' || input.length > 40) return null;
  const s = input.trim().toUpperCase();
  // Indian routes often expose AA-XXXXXX-T; some clients show XXXXXX alone.
  // Reject telephone numbers, formatting tricks and unrecognized shapes.
  if (!/^[A-Z0-9-]+$/.test(s)) return null;
  const full = s.match(/^[A-Z]{2}-([A-Z0-9]{4,9})(?:-([PSTG]))?$/);
  const bare = s.match(/^[A-Z][A-Z0-9]{3,8}$/);
  if (full) return {core:full[1],kind:full[2] || null,format:'ROUTED'};
  if (bare) return {core:s,kind:null,format:'BARE'};
  return null;
}

function lookupBankSender(sender) {
  const parsed = parseSender(sender);
  if (!parsed) return {matched:false,reason:'INVALID_SENDER_FORMAT',debitVerified:false};
  const matches = [];
  for (const bank of source.banks) {
    for (const header of (bank.headers || [])) {
      if (String(header.core_header).toUpperCase() === parsed.core) {
        matches.push({
          bankName:bank.bank_name,
          header:parsed.core,
          purpose:header.purpose,
          source:header.evidence_source,
          headerStatus:header.status
        });
      }
    }
  }
  return {
    matched:matches.length > 0,
    reason:matches.length?'BANK_PUBLISHED_HEADER_MATCH':'HEADER_NOT_IN_SOURCED_REGISTRY',
    matches,
    senderFormat:parsed.format,
    typeSuffix:parsed.kind,
    // Do not promote a caller-supplied sender label to a payment result.
    debitVerified:false,
    paymentVerified:false,
    proofOfOrigin:false
  };
}
function coverage() {
  const published=source.banks.filter(b=>(b.headers||[]).length);
  return {
    bankCount:source.banks.length,
    banksWithPublishedHeaders:published.length,
    headerEntries:published.reduce((n,b)=>n+b.headers.length,0),
    currentTraiVerified:0,
    allBanksCovered:false,
    paymentVerificationSupported:false,
    sources:source.primary_sources
  };
}
module.exports={parseSender,lookupBankSender,coverage};
