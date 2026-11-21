'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { ALLOWED_PACKAGES, createSessionEvidenceRouter, initializeSessionEvidenceSchema } =
  require('../../../../financial/session-evidence');

const PACKAGE = 'ai.disha.credentialfixture';

async function createSessionLab({ report = () => {}, sessionTtlMs = 180000 } = {}) {
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1 || sessionTtlMs > 180000) {
    throw new Error('Invalid synthetic session lifetime');
  }
  const database = new PGlite();
  await initializeSessionEvidenceSchema({ query: sql => database.exec(sql) });
  // Hold the single in-process PostgreSQL connection for the complete router transaction.
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: (sql, params) => database.query(sql, params), release };
    },
    async query(sql, params) {
      const client = await this.connect();
      try { return await client.query(sql, params); }
      finally { client.release(); }
    }
  };
  const sessions = new Map();
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.post('/lab/session', (req, res) => {
    const { sourcePackage, amountPaise, payeeVpa } = req.body || {};
    const real = sourcePackage !== undefined;
    if (real && (!ALLOWED_PACKAGES.has(sourcePackage) ||
        typeof amountPaise !== 'string' || !/^[1-9][0-9]{0,15}$/.test(amountPaise) ||
        typeof payeeVpa !== 'string' || !/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i.test(payeeVpa))) {
      return res.status(422).json({ error: 'OBSERVATION_BINDING_INVALID' });
    }
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
    if (sessions.size >= 30) return res.sendStatus(429);
    const orderId = 'LAB_' + crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(orderId, {
      sessionId: token, status: 'PENDING', expiresAt: now + sessionTtlMs,
      challengeAmount: real ? (amountPaise.padStart(3,'0').slice(0,-2) + '.' + amountPaise.padStart(3,'0').slice(-2)) : '1.00',
      vpaAddress: real ? payeeVpa : 'fixture@invalid', merchantType: 'P2P',
      ...(real ? { observationPackage: sourcePackage } : {})
    });
    return res.status(201).set('Cache-Control', 'no-store').json({ orderId, token });
  });
  app.use('/api/session-evidence', (req, res, next) => {
    if (req.method === 'POST') {
      const send = res.json.bind(res);
      res.json = body => {
        const { accepted, decisionState, error, paymentVerified, debitVerified, revoked, observationState, referenceKind } = body;
        report({ path: req.path, code: res.statusCode, accepted, decisionState, error,
          paymentVerified, debitVerified, revoked, observationState, referenceKind });
        return send(body);
      };
    }
    next();
  }, createSessionEvidenceRouter({
    getPool: () => pool,
    getSession: async id => sessions.get(id),
    allowedPackages: new Set([PACKAGE])
  }));
  return { app, pool, close: () => database.close() };
}

if (require.main === module) {
  createSessionLab({
    report: result => console.log(JSON.stringify(result)),
    sessionTtlMs: Number(process.argv[3] || 180000)
  }).then(({ app }) => {
    app.listen(Number(process.argv[2] || 8766), '127.0.0.1', () => console.log('SESSION_LAB_READY'));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createSessionLab, PACKAGE };
