'use strict';
/* Atomic provider evidence replay guard. Evidence bookkeeping only, NEVER a ledger write.
 * A transaction id may appear against only one order; repeat observations are rejected.
 */
const crypto=require('node:crypto');
async function initUpiAppEvidenceReplay(pool){
 if(!pool||typeof pool.query!=='function')return false;
 await pool.query(`CREATE TABLE IF NOT EXISTS disha_upi_app_evidence_replay (
   fingerprint TEXT PRIMARY KEY,
   order_id TEXT NOT NULL,
   provider TEXT NOT NULL,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS disha_upi_app_evidence_replay_created_idx ON disha_upi_app_evidence_replay(created_at)');
 return true;
}
function fingerprint(provider,transactionId,transactionReference){
 if(![provider,transactionId,transactionReference].every(v=>typeof v==='string'&&v.length>0&&v.length<=150))throw Error('INVALID_TRANSACTION_IDENTITY');
 return crypto.createHash('sha256').update(JSON.stringify([provider,transactionId,transactionReference])).digest('hex');
}
function makeReplayGuard(getPool){
 if(typeof getPool!=='function')throw Error('POOL_GETTER_REQUIRED');
 return async function consume({provider,txnId,txnRef,orderId}){
  if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(orderId))throw Error('INVALID_ORDER');
  const pool=getPool();
  if(!pool)throw Error('EVIDENCE_REPLAY_STORE_UNAVAILABLE');
  const key=fingerprint(provider,txnId,txnRef);
  const q=await pool.query(
   'INSERT INTO disha_upi_app_evidence_replay(fingerprint,order_id,provider) VALUES($1,$2,$3) ON CONFLICT (fingerprint) DO NOTHING RETURNING fingerprint',
   [key,orderId,provider]);
  return q.rowCount===1;
 };
}
module.exports={initUpiAppEvidenceReplay,fingerprint,makeReplayGuard};
