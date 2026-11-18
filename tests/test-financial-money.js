#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { rupeesToPaise, paiseToRupees } = require('../financial/money');
for (const [rupees, paise] of [
  ['0.01', '1'], ['1', '100'], ['1.2', '120'], ['1.20', '120'],
  ['1000.99', '100099'], ['999999999999.99', '99999999999999']
]) {
  assert.equal(rupeesToPaise(rupees), paise, rupees);
  assert.equal(paiseToRupees(paise), Number.isInteger(Number(rupees)) ? rupees + '.00' : (rupees.includes('.') && rupees.split('.')[1].length === 1 ? rupees + '0' : rupees), paise);
}
for (const bad of [0.1, '0.005', '0', '-1', '01', '1e3', '', NaN, Infinity, null, '1,000', '92233720368547758.08']) {
  assert.throws(() => rupeesToPaise(bad), 'Rejected ambiguous or non-integer-paise amount: ' + bad);
}
assert.equal(paiseToRupees('1'), '0.01');
assert.equal(paiseToRupees('100'), '1.00');
console.log('Exact monetary arithmetic and invalid decimal amounts: PASS');
