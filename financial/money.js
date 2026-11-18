'use strict';

// Strings are deliberate: JavaScript binary floating point cannot represent
// most decimal rupee amounts exactly. Never use Number(amount) * 100.
const MAX_INT64 = 9223372036854775807n;

function rupeesToPaise(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) {
    throw new TypeError('Amount must be a nonnegative decimal string with at most two fractional digits');
  }
  const parts = value.split('.');
  const paise = BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0') || '0');
  if (paise <= 0n || paise > MAX_INT64) {
    throw new RangeError('Amount must be positive and fit BIGINT paise');
  }
  return paise.toString();
}

function paiseToRupees(value) {
  const paise = typeof value === 'bigint' ? value : BigInt(value);
  if (paise < 0n || paise > MAX_INT64) {
    throw new RangeError('Paise is outside PostgreSQL BIGINT range');
  }
  const fraction = (paise % 100n).toString().padStart(2, '0');
  return (paise / 100n).toString() + '.' + fraction;
}

module.exports = { rupeesToPaise, paiseToRupees };
