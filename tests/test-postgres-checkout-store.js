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
      txnRef:'TXN_'+suffix,vpaAddress:'test@upi',
      upiUri:'upi://pay?pa=test@upi&pn=Tester&am=500.01&cu=INR&mc=5411&tr=PAY'+suffix.slice(0,16),
      status:'PENDING',state:'WAITING',
      createdAt:now,expiresAt:now+180000,qrRefreshAt:now+15000
    });
    let session=await db.findSessionByOrderId(orderId);
    assert.equal(session?.orderId,orderId);
    assert.equal(session?.challengeAmount,500.01);
    assert.equal(session.merchantType,'P2M','Merchant classification survives PostgreSQL reload');
    assert.equal((await pool.query('SELECT payment_type FROM sessions WHERE order_id=$1',[orderId])).rows[0].payment_type,'P2M');
    const originalUpiUri=session.upiUri;
    assert.match(originalUpiUri,/mc=5411/,'Merchant URI persists after database reload');
    await pool.query("UPDATE vpa_pool SET account_type='PERSONAL',mcc=NULL WHERE vpa_address=$1",['test@upi']);
    assert.equal((await db.findSessionByOrderId(orderId)).upiUri,originalUpiUri,
     'Bank QR does not change even when VPA classification is edited');
    assert.equal((await db.findSessionByTxnRef('TXN_'+suffix)).sessionId,'sess_'+suffix);
    const personalId='order_personal_'+suffix;
    const personalUri='upi://pay?pa=personal@oksbi&pn=Personal&am=1.00&cu=INR&tn=Direct';
    const personal={sessionId:'sess_p2p_'+suffix,orderId:personalId,
      challengeAmount:'1.00',baseAmount:'1.00',txnRef:'P2P'+suffix,
      vpaAddress:'personal@oksbi',upiUri:personalUri,merchantType:'PERSONAL',
      status:'PENDING',state:'WAITING',createdAt:now,expiresAt:now+180000,qrRefreshAt:now+15000};
    await db.saveSession(personal);
    const personalReload=await db.findSessionByOrderId(personalId);
    assert.equal(personalReload.merchantType,'P2P','P2P type persists after PostgreSQL reload');
    assert.equal(personalReload.upiUri,personalUri,'Original P2P QR persists');
    assert.equal((await pool.query('SELECT payment_type FROM sessions WHERE order_id=$1',[personalId])).rows[0].payment_type,'P2P');
    await pool.query('UPDATE sessions SET payment_type=NULL WHERE order_id=$1',[personalId]);
    assert.equal((await db.findSessionByOrderId(personalId)).merchantType,'P2P',
      'Legacy P2P row without type derives it from original QR');
    await assert.rejects(db.saveSession({...personal,merchantType:'MERCHANT'}),/SESSION_PAYMENT_TYPE_URI_CONFLICT/);
    await assert.rejects(db.saveSession({...personal,challengeAmount:1.02}),/SESSION_AMOUNT_URI_CONFLICT/);
    await assert.rejects(db.saveSession({...personal,vpaAddress:'attacker@upi'}),/SESSION_PAYEE_URI_CONFLICT/);
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
    // Atomic limit under contention: exactly three of ten simultaneous
    // attempts may consume a fresh VPA hourly slot, never more.
    const rateTestVpa='ci_velocity_'+suffix+'@upi';
    const attempts=await Promise.all(Array.from({length:10},
      ()=>db.checkAndIncrementVpaVelocity(rateTestVpa,3)));
    assert.equal(attempts.filter(Boolean).length,3,
      'PostgreSQL must enforce the hourly cap under concurrency');
    assert.equal(await db.getVpaHourlyCount(rateTestVpa),3);
    assert.equal(await db.checkAndIncrementVpaVelocity(rateTestVpa,3),false,
      'Rejected velocity attempts must not increase the counter');
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
