#!/usr/bin/env node
/**
 * DISHA 8.2 — Lint (syntax check) all JavaScript files.
 * Cross-platform replacement for shell-based `find -exec node --check`.
 * Exits non-zero if any file has a syntax error.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['.', 'tests', 'utils', 'middleware', 'routes/admin', 'scripts', 'financial', 'public'];

let checked = 0;
let failed = 0;
const errors = [];

for (const dir of DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (!fs.existsSync(dirPath)) continue;
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const filePath = path.join(dirPath, entry.name);
    checked++;
    try {
      if (entry.name === '_worker.js') {
        // Cloudflare Pages Workers are ES modules, not Node CommonJS files.
        execSync('node --input-type=module --check', {
          input: fs.readFileSync(filePath),
          stdio: 'pipe'
        });
      } else {
        execSync('node --check "' + filePath + '"', { stdio: 'pipe' });
      }
    } catch (err) {
      failed++;
      errors.push(filePath);
      console.error(`❌ SYNTAX ERROR: ${path.relative(ROOT, filePath)}`);
    }
  }
}

console.log(`\nChecked ${checked} JavaScript file(s).`);
if (failed > 0) {
  console.error(`\n💥 ${failed} file(s) failed syntax check.`);
  process.exit(1);
} else {
  console.log('✅ All JavaScript files passed syntax check.');
  process.exit(0);
}
