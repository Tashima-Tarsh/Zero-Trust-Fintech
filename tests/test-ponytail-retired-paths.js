#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// Removed features must not return through generated mirrors or dormant CI.
const retired = [
  ".github/workflows/forensic-upi-ci.yml",
  ".github/workflows/forensic-upi-intent-ci.yml",
  "public/app.js",
  "dist/app.js",
  "disha-cinematic/public/app.js",
  "disha-cinematic/dist/app.js",
  "public/debug.html",
  "dist/debug.html",
  "disha-cinematic/public/debug.html",
  "disha-cinematic/dist/debug.html",
  "workflows/n8n/workflow-1-vpa-bulk-upload.json",
  "workflows/n8n/workflow-2-vpa-daily-health-check.json",
  "workflows/n8n/workflow-3-vpa-realtime-routing.json",
  "workflows/n8n/workflow-4-vpa-emergency-quarantine.json"
];
for (const file of retired) {
  assert.equal(fs.existsSync(path.join(root, file)), false, 'Retired file must stay removed: ' + file);
}
console.log('Ponytail: ' + retired.length + ' retired file paths are absent.');
