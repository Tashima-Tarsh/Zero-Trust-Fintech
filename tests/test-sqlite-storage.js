#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveSqliteDatabasePath, prepareSqliteDatabasePath } = require('../utils/sqlite-storage');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disha-sqlite-'));
const source = path.join(tmp, 'app');
const volume = path.join(tmp, 'volume');
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(volume, { recursive: true });
try {
  assert.equal(resolveSqliteDatabasePath({}, source), path.join(source, 'disha82.db'));
  assert.equal(resolveSqliteDatabasePath({ DATA_DIR: volume }, source), path.join(volume, 'disha82.db'));
  assert.equal(resolveSqliteDatabasePath({
    DATA_DIR: source, RAILWAY_VOLUME_MOUNT_PATH: volume
  }, source), path.join(volume, 'disha82.db'));

  const prod = { NODE_ENV: 'production', DATA_DIR: source, RAILWAY_VOLUME_MOUNT_PATH: volume };
  assert.throws(() => prepareSqliteDatabasePath(prod, source), /Refusing to create a blank database/);
  const existing = path.join(volume, 'disha82.db');
  fs.writeFileSync(existing, 'already-backed-up');
  assert.equal(prepareSqliteDatabasePath(prod, source), existing);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'already-backed-up');
  fs.unlinkSync(existing);
  assert.equal(
    prepareSqliteDatabasePath({ ...prod, SQLITE_BOOTSTRAP_NEW_DB: 'true' }, source),
    existing
  );
  assert.ok(!fs.existsSync(existing), 'path resolution must not pre-create a database');
  assert.equal(prepareSqliteDatabasePath({ NODE_ENV: 'development' }, source),
    path.join(source, 'disha82.db'));
  console.log('SQLite volume path, preservation and fail-closed guards: PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
