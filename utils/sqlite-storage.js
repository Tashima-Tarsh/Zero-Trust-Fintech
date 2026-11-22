'use strict';
/**
 * Keep native SQLite sessions, passkeys and ledger on Railway's mounted volume.
 * In production a missing database fails closed to avoid silent data loss.
 */
const fs = require('node:fs');
const path = require('node:path');

function configuredDirectory(env, appDir) {
  return env.RAILWAY_VOLUME_MOUNT_PATH || env.DATA_DIR || appDir;
}

function resolveSqliteDatabasePath(env = process.env, appDir = path.resolve(__dirname, '..')) {
  return path.resolve(configuredDirectory(env, appDir), 'disha82.db');
}

function prepareSqliteDatabasePath(env = process.env, appDir = path.resolve(__dirname, '..')) {
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH;
  const dataDir = configuredDirectory(env, appDir);
  const dbPath = resolveSqliteDatabasePath(env, appDir);
  if (volume && (!fs.existsSync(volume) || !fs.statSync(volume).isDirectory())) {
    throw new Error('Configured Railway volume is not mounted: ' + volume);
  }
  const persistentLocation = Boolean(volume || env.DATA_DIR);
  const isProduction = env.NODE_ENV === 'production';
  if (persistentLocation && isProduction && !fs.existsSync(dbPath)
      && env.SQLITE_BOOTSTRAP_NEW_DB !== 'true') {
    throw new Error(
      'Persistent SQLite file missing at ' + dbPath + '. ' +
      'Copy a consistent online backup of /app/disha82.db ' +
      'to the mounted volume BEFORE deploying. Refusing to create a blank database.'
    );
  }
  fs.mkdirSync(dataDir, { recursive: true });
  return dbPath;
}

module.exports = { configuredDirectory, resolveSqliteDatabasePath, prepareSqliteDatabasePath };
