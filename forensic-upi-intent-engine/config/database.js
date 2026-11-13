/**
 * Native PostgreSQL connection settings for the Phase 1 Node/n8n environment.
 * Never hardcode database credentials or expose this config in a browser bundle.
 * Loaded from the service environment (systemd EnvironmentFile or shell).
 */
'use strict';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

module.exports = {
  host: process.env.DB_POSTGRESDB_HOST || '127.0.0.1',
  port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
  database: process.env.DB_POSTGRESDB_DATABASE || 'forensic_db',
  user: process.env.DB_POSTGRESDB_USER || 'forensic_user',
  password: required('DB_POSTGRESDB_PASSWORD'),
};
