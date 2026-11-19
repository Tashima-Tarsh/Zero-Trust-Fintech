'use strict';
/**
 * PostgreSQL-only checkout state. Calls are Promise-based and never fall back
 * to SQLite. This module is activated only with DB_BACKEND=postgres, AFTER
 * verified data migration. The old SQLite implementation remains the default.
 */
const crypto = require('node:crypto');
const { rupeesToPaise } = require('./money');
const {resolvePaymentType} = require('./payment-session-type');

const scalar = async (pg, sql, args = []) => (await pg.query(sql, args)).rows[0] || null;
const nowMs = () => Date.now();
const asNum = (value) => value === null || value === undefined ? value : Number(value);
function fromRow(r) {
  if (!r) return null;
  return {
    sessionId:r.session_id, orderId:r.order_id,
    challengeAmount:asNum(r.challenge_amount),baseAmount:asNum(r.base_amount),
    txnRef:r.txn_ref, vpaAddress:r.vpa_address,upiUri:r.upi_uri||null,
    merchantType:resolvePaymentType({paymentType:r.payment_type,upiUri:r.upi_uri,
      vpaAddress:r.vpa_address,challengeAmount:r.challenge_amount}),
    status:r.status,state:r.state,
    customerId:r.customer_id,utr:r.utr,
    createdAt:asNum(r.created_at),expiresAt:asNum(r.expires_at),
    qrRefreshAt:asNum(r.qr_refresh_at)
  };
}

function buildStore(pg, vpaRouter) {
  if (!pg) throw new TypeError('PostgreSQL pool is mandatory');

  async function findSessionByOrderId(id) {
    return fromRow(await scalar(pg, 'SELECT * FROM sessions WHERE order_id = $1', [id]));
  }
  async function findSessionByTxnRef(ref) {
    return fromRow(await scalar(pg, 'SELECT * FROM sessions WHERE txn_ref = $1', [ref]));
  }
  async function findSessionByAmount(amount) {
    const row = await scalar(pg,
      "SELECT * FROM sessions WHERE challenge_amount = $1 AND status = 'PENDING' " +
      'AND expires_at >= $2 ORDER BY created_at DESC LIMIT 1', [amount, nowMs() - 60000]);
    return fromRow(row);
  }
  async function saveSession(s) {
    const paymentType=resolvePaymentType(s);
    await pg.query(
      'INSERT INTO sessions (session_id,order_id,challenge_amount,base_amount,txn_ref,vpa_address,upi_uri,status,state,customer_id,created_at,expires_at,qr_refresh_at,payment_type) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ' +
      'ON CONFLICT (order_id) DO UPDATE SET ' +
      'session_id=EXCLUDED.session_id,challenge_amount=EXCLUDED.challenge_amount,' +
      'base_amount=EXCLUDED.base_amount,txn_ref=EXCLUDED.txn_ref,' +
      'vpa_address=EXCLUDED.vpa_address,upi_uri=COALESCE(sessions.upi_uri,EXCLUDED.upi_uri),status=EXCLUDED.status,state=EXCLUDED.state,' +
      'customer_id=EXCLUDED.customer_id,created_at=EXCLUDED.created_at,' +
      'expires_at=EXCLUDED.expires_at,qr_refresh_at=EXCLUDED.qr_refresh_at,'+
      'payment_type=COALESCE(sessions.payment_type,EXCLUDED.payment_type)',
      [s.sessionId,s.orderId,s.challengeAmount,s.baseAmount,s.txnRef,
        s.vpaAddress,s.upiUri||null,s.status,s.state||'WAITING',s.customerId||null,
        s.createdAt,s.expiresAt,s.qrRefreshAt,paymentType]
    );
  }
  async function updateSessionStatus(id,status,utr=null) {
    await pg.query("UPDATE sessions SET status = $2, utr = COALESCE($3,utr) WHERE order_id = $1 AND (status <> 'SUCCESS' OR $2 = 'SUCCESS')",
      [id,status,utr]);
  }
  async function updateSessionState(id,state) {
    await pg.query("UPDATE sessions SET state = $2 WHERE order_id = $1 AND (state <> 'VERIFIED' OR $2 = 'VERIFIED')",
      [id,state]);
  }
  async function getOrderState(id) {
    const r=await findSessionByOrderId(id); if(!r)return null;
    const elapsed=nowMs()-r.createdAt, min=15000, max=180000;
    if(r.state==='VERIFIED'||r.status==='SUCCESS')return {
      state:'VERIFIED',orderId:r.orderId,utr:r.utr,amount:r.challengeAmount,
      baseAmount:r.baseAmount,vpaAddress:r.vpaAddress,createdAt:r.createdAt,
      customerId:r.customerId,verifiedAt:nowMs(),verificationTime:elapsed
    };
    if(elapsed>max)return {state:'EXPIRED',orderId:r.orderId,reason:'Order timeout (>3 minutes)',timeRemaining:0};
    if(elapsed<min)return {state:'WAITING',orderId:r.orderId,timeRemainingMs:min-elapsed,timeRemaining:(min-elapsed)/1000};
    return {state:'VERIFY_WINDOW',orderId:r.orderId,timeRemainingMs:max-elapsed,timeRemaining:(max-elapsed)/1000,customerId:r.customerId};
  }
  async function isUtrBlacklisted(utr) {
    return Boolean(await scalar(pg,'SELECT 1 FROM blacklist_utrs WHERE utr=$1',[utr]));
  }
  async function blacklistUtr(utr,orderId,amount,reason='Verified settlement') {
    const row=await scalar(pg,
      'INSERT INTO blacklist_utrs (utr,order_id,amount,blacklisted_at,reason) '+
      'VALUES ($1,$2,$3,$4,$5) ON CONFLICT (utr) DO UPDATE '+
      'SET reason=EXCLUDED.reason WHERE blacklist_utrs.order_id=EXCLUDED.order_id RETURNING order_id',
      [utr,orderId,amount,nowMs(),reason]);
    if(!row)throw new Error('UTR_BOUND_TO_OTHER_ORDER');
  }
  async function getUtrBoundOrder(utr) {
    if(!utr)return null;
    const r=await scalar(pg,'SELECT order_id FROM utr_order_bindings WHERE utr=$1',[utr]);
    return r?.order_id||null;
  }
  async function bindUtrToOrder(utr,orderId) {
    if(!utr)return false;
    await pg.query('INSERT INTO utr_order_bindings (utr,order_id,bound_at) VALUES ($1,$2,$3) ON CONFLICT (utr) DO NOTHING',
      [utr,orderId,nowMs()]);
    const bound=await getUtrBoundOrder(utr);
    return bound===orderId?true:'BOUND_TO_OTHER_ORDER';
  }
  async function checkVpaVelocity(vpa,maxPerHour=15) {
    if(!vpa)return false;
    const r=await scalar(pg,'SELECT count FROM vpa_hourly_txns WHERE vpa_address=$1 AND hour_bucket=$2',
      [vpa,Math.floor(nowMs()/3600000)]);
    return (!r||Number(r.count)<maxPerHour);
  }
  // Atomic check-and-consume: concurrent checkout requests cannot exceed
  // the configured limit because the conflict predicate is row-locked.
  async function checkAndIncrementVpaVelocity(vpa,maxPerHour=15) {
    if(!vpa)return false;
    if(!Number.isSafeInteger(maxPerHour)||maxPerHour<1)
      throw new TypeError('Invalid VPA hourly limit');
    const result=await pg.query(
      'INSERT INTO vpa_hourly_txns(vpa_address,hour_bucket,count) VALUES($1,$2,1) '+
      'ON CONFLICT(vpa_address,hour_bucket) DO UPDATE '+
      'SET count=vpa_hourly_txns.count+1 '+
      'WHERE vpa_hourly_txns.count<$3 RETURNING count',
      [vpa,Math.floor(nowMs()/3600000),maxPerHour]);
    return result.rowCount===1;
  }
  async function getVpaHourlyCount(vpa) {
    const r=await scalar(pg,'SELECT count FROM vpa_hourly_txns WHERE vpa_address=$1 AND hour_bucket=$2',
      [vpa,Math.floor(nowMs()/3600000)]);
    return Number(r?.count||0);
  }
  async function incrementVpaVelocity(vpa) {
    await pg.query('INSERT INTO vpa_hourly_txns (vpa_address,hour_bucket,count) VALUES ($1,$2,1) '+
      'ON CONFLICT (vpa_address,hour_bucket) DO UPDATE SET count=vpa_hourly_txns.count+1',
      [vpa,Math.floor(nowMs()/3600000)]);
  }
  async function checkSessionCooldown(orderId) {
    const r=await scalar(pg,'SELECT cooldown_until FROM session_cooldowns WHERE order_id=$1',[orderId]);
    const remaining=asNum(r?.cooldown_until||0)-nowMs();
    return remaining>0?{inCooldown:true,secondsRemaining:Math.ceil(remaining/1000)}:{inCooldown:false};
  }
  async function setSessionCooldown(orderId,cooldownMs=120000) {
    const now=nowMs();
    await pg.query('INSERT INTO session_cooldowns (order_id,last_cancel_at,cooldown_until) VALUES ($1,$2,$3) '+
      'ON CONFLICT (order_id) DO UPDATE SET last_cancel_at=EXCLUDED.last_cancel_at,cooldown_until=EXCLUDED.cooldown_until',
      [orderId,now,now+cooldownMs]);
  }
  async function savePasskey(userId,credentialId,publicKey,counter=0,deviceType=null,backedUp=0,transports=null) {
    const id='pk_'+crypto.randomBytes(8).toString('hex');
    await pg.query('INSERT INTO passkeys (id,user_id,credential_id,public_key,counter,device_type,backed_up,transports,created_at,sign_count) '+
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5)',
      [id,userId,credentialId,publicKey,counter,deviceType,backedUp,transports,nowMs()]);
    return {id,userId,credentialId};
  }
  async function findPasskeyByCredentialId(credentialId) {
    return (await scalar(pg,'SELECT * FROM passkeys WHERE credential_id=$1',[credentialId]))||null;
  }
  async function findPasskeysByUserId(userId) {
    return (await pg.query('SELECT * FROM passkeys WHERE user_id=$1',[userId])).rows;
  }
  async function updatePasskeyCounter(credentialId,count) {
    const result=await pg.query(
      'UPDATE passkeys SET sign_count=$2 WHERE credential_id=$1 AND sign_count<=$2',
      [credentialId,count]);
    return result.rowCount===1;
  }
  async function isImageHashSeen(hash) {
    if(!hash)return false;
    return Boolean(await scalar(pg,'SELECT 1 FROM image_hashes WHERE image_hash=$1',[hash]));
  }
  async function blacklistImageHash(hash,orderId,reason='Receipt image recorded') {
    const r=await pg.query('INSERT INTO image_hashes (id,image_hash,order_id,seen_at,reason) VALUES ($1,$2,$3,$4,$5) '+
      'ON CONFLICT (image_hash) DO NOTHING',
      [crypto.randomBytes(8).toString('hex'),hash,orderId,nowMs(),reason]);
    return r.rowCount===1;
  }
  async function getVpaMerchantType(vpa) {
    const r=await scalar(pg,'SELECT account_type,mcc,holder_name FROM vpa_pool WHERE vpa_address=$1',[vpa]);
    return {accountType:r?.account_type||'PERSONAL',mcc:r?.mcc||null,holderName:r?.holder_name||null};
  }
  async function getAllActiveVPAs() {
    return (await pg.query("SELECT vpa_address,holder_name,bank_name,account_type,mcc,status,health_score FROM vpa_pool WHERE status='ACTIVE'")).rows;
  }
  async function selectVPA(merchantId='mer_default',amount=100) {
    const r=await vpaRouter.selectVPA(merchantId,amount);
    return r?.vpaAddress || process.env.MERCHANT_UPI_ID;
  }
  async function selectVPARoute(merchantId='mer_default',amount=100,region='MH',hour=null,sender=null) {
    const route=await vpaRouter.selectVPA(merchantId,amount,region,hour,sender);
    if(!route?.vpaAddress)throw new Error('NO_HEALTHY_VPA_AVAILABLE');
    const mt=await getVpaMerchantType(route.vpaAddress);
    return { ...route,merchantType:mt.accountType,mcc:mt.mcc,holderName:mt.holderName||route.holderName||null };
  }
  async function getLedgerVerification(txId) {
    const rows=(await pg.query('SELECT entry_type, amount FROM ledger_entries WHERE transaction_id=$1',[txId])).rows;
    const debit=rows.filter(r=>r.entry_type==='DEBIT').reduce((v,r)=>v+BigInt(rupeesToPaise(String(r.amount))),0n);
    const credit=rows.filter(r=>r.entry_type==='CREDIT').reduce((v,r)=>v+BigInt(rupeesToPaise(String(r.amount))),0n);
    return {balanced:rows.length===2&&debit===credit&&debit>0n,totalDebits:Number(debit)/100,totalCredits:Number(credit)/100};
  }
  async function settle(orderId,utr,amount,vpa,imageHash,requiresSession) {
    // Ledger, UTR, session state and optional image hash commit in ONE transaction.
    const client=await pg.connect();
    const txId='TX_'+crypto.randomBytes(6).toString('hex').toUpperCase();
    const merchantId='mer_default';
    const amountPaise=rupeesToPaise(String(amount));
    let begun=false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      begun=true;
      const session=(await client.query('SELECT * FROM sessions WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
      if(requiresSession&&!session)throw new Error('SESSION_NOT_FOUND');
      if(session) {
        if(session.status==='SUCCESS')throw new Error('SESSION_ALREADY_SETTLED');
        if(rupeesToPaise(String(session.challenge_amount))!==amountPaise)throw new Error('AMOUNT_MISMATCH');
      }
      const bound=await client.query('INSERT INTO utr_order_bindings (utr,order_id,bound_at) VALUES ($1,$2,$3) '+
        'ON CONFLICT (utr) DO NOTHING RETURNING order_id',[utr,orderId,nowMs()]);
      if(bound.rowCount===0) {
        const existing=(await client.query('SELECT order_id FROM utr_order_bindings WHERE utr=$1',[utr])).rows[0];
        if(!existing||existing.order_id!==orderId)throw new Error('UTR_BOUND_TO_OTHER_ORDER');
      }
      const journalId=crypto.randomUUID();
      await client.query('INSERT INTO disha_core_journals (journal_id,merchant_id,order_id,utr,idempotency_key,amount_paise) '+
        'VALUES ($1,$2,$3,$4,$5,$6)',[journalId,merchantId,orderId,utr,merchantId+':'+orderId,amountPaise]);
      await client.query('INSERT INTO disha_core_postings (journal_id,merchant_id,account_id,side,amount_paise) '+
        "VALUES ($1,$2,'acc_bank_01','DEBIT',$3),($1,$2,'acc_rev_01','CREDIT',$3)",
        [journalId,merchantId,amountPaise]);
      await client.query("UPDATE disha_core_journals SET state='POSTED',posted_at=now() WHERE journal_id=$1",[journalId]);
      await client.query("INSERT INTO transactions (id,order_id,utr,amount,status,vpa_used,created_at) VALUES ($1,$2,$3,$4,'COMPLETED',$5,$6)",
        [txId,orderId,utr,amount,vpa,nowMs()]);
      await client.query("INSERT INTO ledger_entries (id,transaction_id,account_id,entry_type,amount,created_at) " +
        "VALUES ($1,$3,'acc_bank_01','DEBIT',$4,$5),($2,$3,'acc_rev_01','CREDIT',$4,$5)",
        ['LE_'+crypto.randomBytes(6).toString('hex').toUpperCase(),
        'LE_'+crypto.randomBytes(6).toString('hex').toUpperCase(),txId,amount,nowMs()]);
      await client.query('INSERT INTO blacklist_utrs (utr,order_id,amount,blacklisted_at,reason) VALUES ($1,$2,$3,$4,$5)',
        [utr,orderId,amount,nowMs(),'Recorded payment claim']);
      if(imageHash)await client.query('INSERT INTO image_hashes (id,image_hash,order_id,seen_at,reason) VALUES ($1,$2,$3,$4,$5)',
        [crypto.randomBytes(8).toString('hex'),imageHash,orderId,nowMs(),'Recorded receipt claim']);
      if(session) await client.query("UPDATE sessions SET status='SUCCESS',state='VERIFIED',utr=$2 WHERE order_id=$1",[orderId,utr]);
      await client.query('COMMIT');
      begun=false;
      return {txId,verification:{balanced:true,totalDebits:Number(amountPaise)/100,totalCredits:Number(amountPaise)/100}};
    } catch(e) {
      if(begun) try {await client.query('ROLLBACK');}catch(_){}
      throw e;
    } finally {client.release();}
  }
  async function resetDailyVPAs() {
    await pg.query("UPDATE vpa_pool SET daily_tx_count=0,daily_volume=0,unique_senders_today=0");
    await vpaRouter.dailyHealthResetAndRebalance();
  }
  return {
    findSessionByOrderId,findSessionByTxnRef,findSessionByAmount,saveSession,
    updateSessionStatus,updateSessionState,getOrderState,isUtrBlacklisted,
    blacklistUtr,getUtrBoundOrder,bindUtrToOrder,checkVpaVelocity,
    incrementVpaVelocity,checkAndIncrementVpaVelocity,getVpaHourlyCount,checkSessionCooldown,setSessionCooldown,
    savePasskey,findPasskeyByCredentialId,findPasskeysByUserId,updatePasskeyCounter,
    isImageHashSeen,blacklistImageHash,getVpaMerchantType,getAllActiveVPAs,
    selectVPA,selectVPARoute,getLedgerVerification,
    atomicSettle:(...args)=>settle(...args,true),
    recordTransactionAndLedger:(...args)=>settle(...args,null,false),
    resetDailyVPAs
  };
}
module.exports={buildStore};
