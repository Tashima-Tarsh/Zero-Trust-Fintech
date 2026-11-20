'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/quantum-fusion.css'), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
for (const target of ['#upiAppOptions', '#vaultProceed', '#paymentStageCopy']) {
  for (const match of rules) {
    const selector = match[1];
    const declarations = match[2];
    if (selector.includes(target) && /display\s*:\s*none\s*!important/.test(declarations)) {
      assert.ok(selector.includes(target + '[hidden]'),
        target + ' must not be forcibly hidden while active');
    }
  }
}
assert.match(css, /body\[data-checkout="generic"\] #upiAppOptions\[hidden\]/);
assert.match(css, /body\[data-checkout="generic"\] #vaultProceed\[hidden\]/);
assert.match(css, /overflow-y\s*:\s*auto\s*!important/,
  'P2P checkout stage must scroll rather than clip its controls');
console.log('QUANTUM_FUSION_P2P_CONTROLS_PASS: Android app choices, Proceed and guidance remain visible');
