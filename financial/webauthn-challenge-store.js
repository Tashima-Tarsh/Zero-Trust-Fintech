'use strict';
// WebAuthn challenge state must survive process restarts and be single-use.
// PostgreSQL is authoritative in production. Memory fallback is local-only.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
async function initializeChallengeStore(pool){
 if(!pool)return;
 await pool.query(
  'CREATE TABLE IF NOT EXISTS disha_webauthn_challenges ('+
  'session_id TEXT PRIMARY KEY,payload JSONB NOT NULL,'+
  'expires_at BIGINT NOT NULL,consumed_at BIGINT,'+
  'created_at TIMESTAMPTZ NOT NULL DEFAULT now());'+
  'CREATE INDEX IF NOT EXISTS idx_disha_webauthn_challenges_expiry '+
  'ON disha_webauthn_challenges(expires_at)'
 );
}
function createChallengeStore(getPool){
 const memory=new Map();
 function backend(){
  const pg=getPool();
  if(!pg&&(process.env.DB_BACKEND==='postgres'||process.env.NODE_ENV==='production'))
   throw Error('DURABLE_WEBAUTHN_STORE_UNAVAILABLE');
  return pg;
 }
 function valid(id){
  if(typeof id!=='string'||!ID.test(id))throw Error('INVALID_WEBAUTHN_SESSION_ID');
 }
 async function set(id,payload){
  valid(id);
  if(!payload||!Number.isSafeInteger(payload.expiresAt))
   throw Error('INVALID_WEBAUTHN_CHALLENGE');
  const pg=backend();
  if(pg){
   await pg.query(
    'INSERT INTO disha_webauthn_challenges(session_id,payload,expires_at,consumed_at) '+
    'VALUES($1,$2::jsonb,$3,NULL) ON CONFLICT(session_id) DO UPDATE SET '+
    'payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,consumed_at=NULL',
    [id,JSON.stringify(payload),payload.expiresAt]
   );
  }else memory.set(id,payload);
 }
 async function get(id){
  valid(id);
  const now=Date.now(),pg=backend();
  if(pg){
   const r=await pg.query(
    'SELECT payload FROM disha_webauthn_challenges '+
    'WHERE session_id=$1 AND consumed_at IS NULL AND expires_at>$2',
    [id,now]);
   return r.rows[0]?.payload||null;
  }
  const row=memory.get(id);
  return row&&row.expiresAt>now?row:null;
 }
 async function take(id){
  valid(id);
  const now=Date.now(),pg=backend();
  if(pg){
   const r=await pg.query(
    'UPDATE disha_webauthn_challenges SET consumed_at=$2 '+
    'WHERE session_id=$1 AND consumed_at IS NULL AND expires_at>$2 '+
    'RETURNING payload',[id,now]);
   return r.rows[0]?.payload||null;
  }
  const row=memory.get(id);
  memory.delete(id);
  return row&&row.expiresAt>now?row:null;
 }
 async function del(id){
  valid(id);
  const pg=backend();
  if(pg)await pg.query('DELETE FROM disha_webauthn_challenges WHERE session_id=$1',[id]);
  else memory.delete(id);
 }
 return Object.freeze({set,get,take,delete:del});
}
module.exports={initializeChallengeStore,createChallengeStore};
