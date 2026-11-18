'use strict';
// Execute only against CI's local disposable PostgreSQL database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {buildStore}=require('../financial/postgres-store');

(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname)) {
    throw Error('Refusing to test against non-local PostgreSQL');
  }
  const pool=new Pool({connectionString:url});
  const suffix=crypto.randomUUID().replace(/-/g,'');
  const orderId='order_pg_'+suffix,utr='631902'+crypto.randomInt(100000,999999);
  const vpaRouter={selectVPA:async()=>({vpaAddress:'test@upi',healthScore:100}),dailyHealthResetAndRebalance:async()=>({success:true})};
  try{
    for(const name of ['schema.sql','migrations/001_financial_core.sql','migrations/002_postgres_checkout.sql']) {
      await pool.query(fs.readFileSync(path.join(__dirname,'..',name),'utf8'));
    }
    const db=buildStore(pool,vpaRouter);
    const now=Date.now();
    await db.saveSession({
      sessionId:'sess_'+suffix,orderId,challengeAmount:'500.01',baseAmount:'500.01',
      txnRef:'TXN_'+suffix,vpaAddress:'test@upi',status:'PENDING',state:'WAITING',
      createdAt:now,expiresAt:now+180000,qrRefreshAt:now+15000
    });
    let session=await db.findSessionByOrderId(orderId);
    assert.equal(session?.orderId,orderId);
    assert.equal(session?.challengeAmount,500.01);
    assert.equal((await db.findSessionByTxnRef('TXN_'+suffix)).sessionId,'sess_'+suffix);
    assert.equal((await db.getOrderState(orderId)).state,'WAITING');
    assert.equal(await db.bindUtrToOrder(utr,orderId),true);
    assert.equal(await db.getUtrBoundOrder(utr),orderId);
    assert.equal(await db.bindUtrToOrder(utr,'other_order'), 'BOUND_TO_OTHER_ORDER');
    const pk='pkcred_'+suffix;
    assert.ok(await db.savePasskey('user_'+suffix,pk,'cHVibGlj',0));
    assert.equal((await db.findPasskeysByUserId('user_'+suffix)).length,1);
    assert.equal((await db.findPasskeyByCredentialId(pk)).credential_id,pk);
    assert.equal(await db.updatePasskeyCounter(pk,1),true);
    assert.equal(await db.updatePasskeyCounter(pk,0),false);
    assert.equal(await db.checkVpaVelocity('test@upi',1),true);
    await db.incrementVpaVelocity('test@upi');
    assert.equal(await db.checkVpaVelocity('test@upi',1),false);
    await db.setSessionCooldown(orderId,120000);
    assert.equal((await db.checkSessionCooldown(orderId)).inCooldown,true);
    const result=await db.atomicSettle(orderId,utr,'500.01','test@upi');
    assert.equal(result.verification.balanced,true);
    session=await db.findSessionByOrderId(orderId);
    assert.equal(session.status,'SUCCESS');
    assert.equal(session.utr,utr);
    assert.equal(await db.isUtrBlacklisted(utr),true);
    assert.equal((await db.getOrderState(orderId)).state,'VERIFIED');
    const legacy=await db.getLedgerVerification(result.txId);
    assert.equal(legacy.balanced,true);
    assert.equal(legacy.totalDebits,500.01);
    assert.equal(legacy.totalCredits,500.01);
    const core=await pool.query('SELECT state,amount_paise FROM disha_core_journals WHERE order_id=$1',[orderId]);
    assert.equal(core.rows[0].state,'POSTED');
    assert.equal(core.rows[0].amount_paise,'50001');
    await assert.rejects(db.atomicSettle(orderId,utr,'500.01','test@upi'),/SESSION_ALREADY_SETTLED/);
    console.log('Postgres checkout state: sessions, passkeys, UTR, velocity, cooldown, atomic ledger PASS');
  }finally {await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
