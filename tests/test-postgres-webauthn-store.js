'use strict';
// Durable, cross-replica one-use WebAuthn challenges. No bank/UPI simulation.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {createChallengeStore,initializeChallengeStore}=
  require('../financial/webauthn-challenge-store');

(async()=>{
 const dburl=process.env.TEST_DATABASE_URL;
 if(!dburl||!['127.0.0.1','localhost','::1'].includes(new URL(dburl).hostname))
   throw Error('Only disposable local PostgreSQL is permitted');
 const pool=new Pool({connectionString:dburl,max:4});
 try{
  await initializeChallengeStore(pool);
  const first=createChallengeStore(()=>pool);
  const second=createChallengeStore(()=>pool);
  const id=crypto.randomBytes(16).toString('hex');
  const row={type:'authentication',userId:'dev01',orderId:'ORD_DEV01',
    challenge:'fresh-challenge',expiresAt:Date.now()+60_000};
  await first.set(id,row);
  assert.deepEqual(await second.get(id),row,'Second process must see the challenge');
  const result=await Promise.all([first.take(id),second.take(id)]);
  assert.equal(result.filter(Boolean).length,1,'Challenge must be consumed only once');
  assert.equal(await first.get(id),null,'Consumed challenges cannot be replayed');
  assert.equal(await second.take(id),null);
  const verified={...row,status:'VAULT_VERIFIED_AWAITING_UPI',
    expiresAt:Date.now()+120_000};
  await first.set(id,verified);
  assert.deepEqual(await second.get(id),verified,'Verified state survives process switch');
  await second.delete(id);
  assert.equal(await first.get(id),null);
  const expired=crypto.randomBytes(16).toString('hex');
  await first.set(expired,{...row,expiresAt:Date.now()-1000});
  assert.equal(await second.get(expired),null,'Expired challenges fail closed');
  assert.equal(await second.take(expired),null);
  const local=createChallengeStore(()=>null);
  await local.set('local',{...row,expiresAt:Date.now()+10_000});
  assert.equal((await local.take('local')).challenge,'fresh-challenge');
  assert.equal(await local.take('local'),null);
  console.log('WEBAUTHN_DURABILITY_PASS: cross-instance, consume-once, expiration and local fallback');
 }finally{await pool.end()}
})().catch(e=>{console.error(e);process.exitCode=1});
