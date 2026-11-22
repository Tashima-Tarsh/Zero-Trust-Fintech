'use strict';
/**
 * Untrusted UTR observations are NEVER authoritative UTR bindings.
 * An attacker may know a valid bank reference and submit it to a different
 * checkout. Such claims must not reserve the credit or reject a real order.
 */
const INVALID_UTR=/^[0-9]{12}$/;
const SOURCES=new Set(['LEGACY_VERIFY','CFC','WEB_SHARE','VAULT_FINALIZE']);
async function initializeClaimObserver(pool){
  if(!pool)return;
  await pool.query(
    'CREATE TABLE IF NOT EXISTS disha_untrusted_utr_claims ('+
    'order_id TEXT NOT NULL,utr TEXT NOT NULL,source TEXT NOT NULL,'+
    'observed_at BIGINT NOT NULL,PRIMARY KEY (order_id,utr,source));'+
    'CREATE INDEX IF NOT EXISTS disha_untrusted_claim_utr_idx '+
    'ON disha_untrusted_utr_claims(utr,observed_at DESC)'
  );
}
async function observeClaim(pool,orderId,utr,source){
  if(typeof orderId!=='string'||orderId.length>150||
     !INVALID_UTR.test(String(utr||''))||!SOURCES.has(source))
    return {recorded:false,conflict:false,error:'INVALID_UTR_CLAIM'};
  if(!pool)return {recorded:false,conflict:false,error:'OBSERVATION_STORE_UNAVAILABLE'};
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    // Serialize concurrent untrusted observations for this candidate reference.
    // Collision in a 32-bit advisory-lock hash only adds serialization, never
    // cross-merchant financial authority or a false ledger credit.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[utr]);
    const prior=await c.query(
      'SELECT order_id FROM disha_untrusted_utr_claims '+
      'WHERE utr=$1 AND order_id<>$2 LIMIT 1',[utr,orderId]);
    await c.query(
      'INSERT INTO disha_untrusted_utr_claims(order_id,utr,source,observed_at) '+
      'VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [orderId,utr,source,Date.now()]);
    await c.query('COMMIT');
    return {recorded:true,conflict:prior.rowCount>0};
  }catch(error){
    try{await c.query('ROLLBACK')}catch(_){}
    throw error;
  }finally{c.release()}
}
module.exports={initializeClaimObserver,observeClaim};
