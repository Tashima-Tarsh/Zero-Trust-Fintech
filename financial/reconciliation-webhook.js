'use strict';
// DISHA 8.2: internal statement-credit reconciliation endpoint.
// This endpoint is NOT a bank integration. Only a separately authenticated,
// read-only bank statement connector may sign an event after validating source.
const crypto = require('node:crypto');
const express = require('express');
const {rupeesToPaise,paiseToRupees} = require('./money');

const fail=(code,status=409)=>Object.assign(new Error(code),{code,status});
const cleanId=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(v);
const cleanVpa=v=>typeof v==='string'&&/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i.test(v);

async function initializeReconciliationSchema(pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS disha_reconciliation_inbox ("+
    "source TEXT NOT NULL,event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,"+
    "order_id TEXT NOT NULL,merchant_id TEXT NOT NULL,utr TEXT NOT NULL,"+
    "amount_paise BIGINT NOT NULL CHECK(amount_paise>0),payee_vpa TEXT NOT NULL,"+
    "credited_at BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'RECEIVED' "+
    "CHECK(status IN ('RECEIVED','QUARANTINED','POSTED')),"+
    "reason TEXT,transaction_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"+
    "processed_at TIMESTAMPTZ,PRIMARY KEY(source,event_id));"+
    "CREATE INDEX IF NOT EXISTS idx_disha_recon_order ON disha_reconciliation_inbox(order_id,status)"
  );
}

function validateCredit(p,source) {
  if(!p||typeof p!=='object'||Array.isArray(p)||
     p.source!==source||p.direction!=='CREDIT'||p.status!=='POSTED'||
     p.bankEvidence!=='VERIFIED_STATEMENT') throw fail('CREDIT_SOURCE_NOT_VERIFIED',422);
  if(![p.eventId,p.statementEntryId,p.orderId,p.merchantId].every(cleanId))
    throw fail('CREDIT_EVENT_MISSING_ID',422);
  if(typeof p.utr!=='string'||!/^[0-9]{12}$/.test(p.utr))
    throw fail('CREDIT_UTR_INVALID',422);
  if(!cleanVpa(p.payeeVpa))throw fail('CREDIT_VPA_INVALID',422);
  if(typeof p.amountPaise!=='string'||!/^[1-9][0-9]{0,15}$/.test(p.amountPaise))
    throw fail('CREDIT_AMOUNT_INVALID',422);
  if(!Number.isSafeInteger(p.creditedAt)||p.creditedAt<0||p.creditedAt>Date.now()+300000)
    throw fail('CREDIT_TIME_INVALID',422);
  return {...p,payeeVpa:p.payeeVpa.toLowerCase()};
}

async function reconcileCredit(pool,payload,source,payloadHash) {
  const e=validateCredit(payload,source);
  const c=await pool.connect();
  let active=false;
  try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');active=true;
    const original=await c.query(
      'SELECT payload_hash,status,transaction_id FROM disha_reconciliation_inbox '+
      'WHERE source=$1 AND event_id=$2 FOR UPDATE',[source,e.eventId]);
    if(original.rowCount) {
      const o=original.rows[0];
      if(o.payload_hash!==payloadHash)throw fail('CREDIT_EVENT_REPLAY_MISMATCH');
      if(o.status==='POSTED') {
        await c.query('COMMIT');active=false;
        return {state:'POSTED',orderId:e.orderId,txId:o.transaction_id,replayed:true};
      }
    }else{
      await c.query(
        'INSERT INTO disha_reconciliation_inbox(source,event_id,payload_hash,order_id,'+
        'merchant_id,utr,amount_paise,payee_vpa,credited_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [source,e.eventId,payloadHash,e.orderId,e.merchantId,e.utr,e.amountPaise,e.payeeVpa,e.creditedAt]);
    }

    const q=await c.query(
      'SELECT s.*,o.merchant_id AS saas_merchant_id FROM sessions s '+
      'LEFT JOIN saas_merchant_orders o ON o.session_id=s.session_id '+
      'WHERE s.order_id=$1 FOR UPDATE OF s',[e.orderId]);
    const s=q.rows[0];let reason=null;
    if(!s)reason='UNKNOWN_ORDER';
    else if((s.saas_merchant_id||'mer_default')!==e.merchantId)reason='MERCHANT_MISMATCH';
    else if(String(s.vpa_address).toLowerCase()!==e.payeeVpa)reason='PAYEE_MISMATCH';
    else if(rupeesToPaise(String(s.challenge_amount))!==e.amountPaise)reason='AMOUNT_MISMATCH';
    else if(e.creditedAt<Number(s.created_at)-30000 ||
            e.creditedAt>Number(s.expires_at)+60000)reason='OUTSIDE_PAYMENT_WINDOW';
    else if(s.status==='SUCCESS')reason='ORDER_ALREADY_POSTED';
    if(!reason){
      const bound=await c.query('SELECT order_id FROM utr_order_bindings WHERE utr=$1 FOR UPDATE',[e.utr]);
      if(bound.rowCount&&bound.rows[0].order_id!==e.orderId)reason='UTR_BOUND_TO_OTHER_ORDER';
    }
    if(!reason){
      const previous=await c.query('SELECT order_id FROM transactions WHERE utr=$1 OR order_id=$2 LIMIT 1',
        [e.utr,e.orderId]);
      if(previous.rowCount)reason='DUPLICATE_CREDIT';
    }
    if(reason){
      await c.query(
        "UPDATE disha_reconciliation_inbox SET status='QUARANTINED',reason=$3,processed_at=now() "+
        "WHERE source=$1 AND event_id=$2",[source,e.eventId,reason]);
      await c.query('COMMIT');active=false;
      return {state:'QUARANTINED',orderId:e.orderId,reason,replayed:false};
    }

    const merchant=e.merchantId;
    const suffix=crypto.createHash('sha256').update(merchant).digest('hex').slice(0,22);
    const bank=merchant==='mer_default'?'acc_bank_01':'acc_b_'+suffix;
    const revenue=merchant==='mer_default'?'acc_rev_01':'acc_r_'+suffix;
    for(const [id,code,name,type] of [
      [bank,'B'+suffix,'Bank account credits','ASSET'],
      [revenue,'R'+suffix,'Payment revenue','REVENUE']
    ]){
      if(merchant!=='mer_default')await c.query(
        'INSERT INTO accounts(id,code,name,type,merchant_id,created_at) '+
        'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        [id,code,name,type,merchant,Date.now()]);
      await c.query(
        'INSERT INTO disha_core_accounts(account_id,merchant_id,account_type) VALUES($1,$2,$3) '+
        'ON CONFLICT(account_id) DO NOTHING',[id,merchant,type]);
    }
    const journal=crypto.randomUUID();
    const txId='TX_'+crypto.randomBytes(12).toString('hex').toUpperCase();
    const amount=paiseToRupees(e.amountPaise),now=Date.now();
    await c.query(
      'INSERT INTO utr_order_bindings(utr,order_id,bound_at) VALUES($1,$2,$3) '+
      'ON CONFLICT(utr) DO NOTHING',[e.utr,e.orderId,now]);
    await c.query(
      'INSERT INTO disha_core_journals(journal_id,merchant_id,order_id,utr,idempotency_key,amount_paise) '+
      'VALUES($1,$2,$3,$4,$5,$6)',
      [journal,merchant,e.orderId,e.utr,'credit:'+source+':'+e.eventId,e.amountPaise]);
    await c.query(
      "INSERT INTO disha_core_postings(journal_id,merchant_id,account_id,side,amount_paise) "+
      "VALUES($1,$2,$3,'DEBIT',$5),($1,$2,$4,'CREDIT',$5)",
      [journal,merchant,bank,revenue,e.amountPaise]);
    await c.query("UPDATE disha_core_journals SET state='POSTED',posted_at=now() WHERE journal_id=$1",
      [journal]);
    await c.query(
      "INSERT INTO transactions(id,order_id,utr,amount,status,vpa_used,created_at) "+
      "VALUES($1,$2,$3,$4,'COMPLETED',$5,$6)",
      [txId,e.orderId,e.utr,amount,e.payeeVpa,now]);
    await c.query(
      "INSERT INTO ledger_entries(id,transaction_id,account_id,entry_type,amount,created_at) "+
      "VALUES($1,$3,$4,'DEBIT',$6,$7),($2,$3,$5,'CREDIT',$6,$7)",
      ['LE_'+crypto.randomBytes(8).toString('hex'),
       'LE_'+crypto.randomBytes(8).toString('hex'),txId,bank,revenue,amount,now]);
    await c.query(
      "INSERT INTO blacklist_utrs(utr,order_id,amount,blacklisted_at,reason) "+
      "VALUES($1,$2,$3,$4,'Verified statement credit') ON CONFLICT(utr) DO NOTHING",
      [e.utr,e.orderId,amount,now]);
    await c.query(
      "UPDATE sessions SET status='SUCCESS',state='VERIFIED',utr=$2 WHERE order_id=$1",
      [e.orderId,e.utr]);
    if(s.saas_merchant_id)await c.query(
      'INSERT INTO saas_merchant_notifications(id,merchant_id,title,message,created_at) '+
      'VALUES($1,$2,$3,$4,$5)',
      ['note_'+crypto.randomBytes(12).toString('hex'),merchant,'Payment credited',
       'Verified statement credit received for order '+e.orderId,now]);
    await c.query(
      "UPDATE disha_reconciliation_inbox SET status='POSTED',reason=NULL,transaction_id=$3,processed_at=now() "+
      'WHERE source=$1 AND event_id=$2',[source,e.eventId,txId]);
    await c.query('COMMIT');active=false;
    return {state:'POSTED',orderId:e.orderId,utr:e.utr,txId,amount,vpaAddress:e.payeeVpa,replayed:false};
  }catch(err){
    if(active)try{await c.query('ROLLBACK')}catch(_){}
    throw err;
  }finally{c.release()}
}

function createReconciliationRouter({getPool,onSettled=()=>{}}){
  const router=express.Router();
  router.post('/credit',async(req,res)=>{
    const secret=process.env.RECONCILIATION_WEBHOOK_SECRET;
    const source=process.env.RECONCILIATION_SOURCE_ID;
    if(!secret||secret.length<32||!source)return res.status(503)
      .json({success:false,error:'RECONCILIATION_NOT_CONFIGURED'});
    if(!Buffer.isBuffer(req.rawReconciliationBody)||!req.is('application/json'))
      return res.status(400).json({success:false,error:'JSON_BODY_REQUIRED'});
    const t=req.get('x-disha-timestamp'),s=req.get('x-disha-signature')||'';
    if(!/^[0-9]{10}$/.test(t||'')||
       Math.abs(Math.floor(Date.now()/1000)-Number(t))>300||
       !/^sha256=[0-9a-f]{64}$/i.test(s))
      return res.status(401).json({success:false,error:'INVALID_SIGNATURE'});
    const target=crypto.createHmac('sha256',secret).update(t+'.')
      .update(req.rawReconciliationBody).digest();
    const given=Buffer.from(s.slice(7),'hex');
    if(given.length!==target.length||!crypto.timingSafeEqual(target,given))
      return res.status(401).json({success:false,error:'INVALID_SIGNATURE'});
    const pool=getPool();
    if(!pool)return res.status(503).json({success:false,error:'POSTGRES_REQUIRED'});
    try{
      const hash=crypto.createHash('sha256').update(req.rawReconciliationBody).digest('hex');
      const result=await reconcileCredit(pool,req.body,source,hash);
      if(result.state==='POSTED'&&!result.replayed)
        try{onSettled(result.orderId,result)}catch(_){}
      res.status(result.state==='QUARANTINED'?202:200).json({success:true,...result});
    }catch(err){
      if(!err.status)console.error('[Credit reconciliation]',err.code||err.message);
      res.status(err.status||500).json({success:false,
        error:err.status?err.code:'RECONCILIATION_UNAVAILABLE'});
    }
  });
  return router;
}
/**
 * Atomic UTR claim + settlement in single SERIALIZABLE transaction.
 * Combines observeClaim + reconcileCredit to prevent race conditions
 * where two parallel requests claim the same UTR on different orders.
 * 
 * @param {Pool} pool - PostgreSQL pool
 * @param {Object} payload - Reconciliation payload (same as reconcileCredit)
 * @param {string} source - Source identifier
 * @param {string} payloadHash - SHA256 hash of payload
 * @param {string} utrClaimSource - Source for UTR claim (e.g., 'CFC', 'VAULT_FINALIZE')
 * @returns {Object} Result with state, orderId, utr, txId, etc.
 */
async function reconcileCreditWithUtrClaim(pool, payload, source, payloadHash, utrClaimSource = 'CFC') {
  const e = validateCredit(payload, source);
  const c = await pool.connect();
  let active = false;
  try {
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    active = true;
    
    // Step 1: Atomic UTR claim with advisory lock (same as observeClaim)
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [e.utr]);
    const prior = await c.query(
      'SELECT order_id FROM disha_untrusted_utr_claims ' +
      'WHERE utr = $1 AND order_id <> $2 LIMIT 1', [e.utr, e.orderId]);
    
    if (prior.rowCount > 0) {
      await c.query('COMMIT');
      active = false;
      return { state: 'CONFLICTING_EVIDENCE', orderId: e.orderId, reason: 'UTR_BOUND_TO_OTHER_ORDER', replayed: false };
    }
    
    // Record the UTR claim
    await c.query(
      'INSERT INTO disha_untrusted_utr_claims(order_id, utr, source, observed_at) ' +
      'VALUES($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [e.orderId, e.utr, utrClaimSource, Date.now()]
    );
    
    // Step 2: Reconciliation (same logic as reconcileCredit but within same transaction)
    const original = await c.query(
      'SELECT payload_hash, status, transaction_id FROM disha_reconciliation_inbox ' +
      'WHERE source = $1 AND event_id = $2 FOR UPDATE', [source, e.eventId]);
    
    if (original.rowCount) {
      const o = original.rows[0];
      if (o.payload_hash !== payloadHash) throw fail('CREDIT_EVENT_REPLAY_MISMATCH');
      if (o.status === 'POSTED') {
        await c.query('COMMIT'); active = false;
        return { state: 'POSTED', orderId: e.orderId, txId: o.transaction_id, replayed: true };
      }
    } else {
      await c.query(
        'INSERT INTO disha_reconciliation_inbox(source, event_id, payload_hash, order_id, ' +
        'merchant_id, utr, amount_paise, payee_vpa, credited_at) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [source, e.eventId, payloadHash, e.orderId, e.merchantId, e.utr, e.amountPaise, e.payeeVpa, e.creditedAt]);
    }

    const q = await c.query(
      'SELECT s.*, o.merchant_id AS saas_merchant_id FROM sessions s ' +
      'LEFT JOIN saas_merchant_orders o ON o.session_id = s.session_id ' +
      'WHERE s.order_id = $1 FOR UPDATE OF s', [e.orderId]);
    const s = q.rows[0];
    let reason = null;
    if (!s) reason = 'UNKNOWN_ORDER';
    else if ((s.saas_merchant_id || 'mer_default') !== e.merchantId) reason = 'MERCHANT_MISMATCH';
    else if (String(s.vpa_address).toLowerCase() !== e.payeeVpa) reason = 'PAYEE_MISMATCH';
    else if (rupeesToPaise(String(s.challenge_amount)) !== e.amountPaise) reason = 'AMOUNT_MISMATCH';
    else if (e.creditedAt < Number(s.created_at) - 30000 ||
             e.creditedAt > Number(s.expires_at) + 60000) reason = 'OUTSIDE_PAYMENT_WINDOW';
    else if (s.status === 'SUCCESS') reason = 'ORDER_ALREADY_POSTED';
    if (!reason) {
      const bound = await c.query('SELECT order_id FROM utr_order_bindings WHERE utr = $1 FOR UPDATE', [e.utr]);
      if (bound.rowCount && bound.rows[0].order_id !== e.orderId) reason = 'UTR_BOUND_TO_OTHER_ORDER';
    }
    if (!reason) {
      const previous = await c.query('SELECT order_id FROM transactions WHERE utr = $1 OR order_id = $2 LIMIT 1',
        [e.utr, e.orderId]);
      if (previous.rowCount) reason = 'DUPLICATE_CREDIT';
    }
    if (reason) {
      await c.query(
        "UPDATE disha_reconciliation_inbox SET status = 'QUARANTINED', reason = $3, processed_at = now() " +
        "WHERE source = $1 AND event_id = $2", [source, e.eventId, reason]);
      await c.query('COMMIT'); active = false;
      return { state: 'QUARANTINED', orderId: e.orderId, reason, replayed: false };
    }

    const merchant = e.merchantId;
    const suffix = crypto.createHash('sha256').update(merchant).digest('hex').slice(0, 22);
    const bank = merchant === 'mer_default' ? 'acc_bank_01' : 'acc_b_' + suffix;
    const revenue = merchant === 'mer_default' ? 'acc_rev_01' : 'acc_r_' + suffix;
    const txId = 'tx_' + crypto.randomBytes(8).toString('hex');
    const amount = paiseToRupees(e.amountPaise);
    
    await c.query(
      'INSERT INTO transactions (id, order_id, utr, amount_paise, amount, vpa_address, credited_at, source, merchant_id, status) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [txId, e.orderId, e.utr, e.amountPaise, amount, e.payeeVpa, e.creditedAt, source, e.merchantId, 'POSTED']
    );
    await c.query(
      'INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount_paise, description, created_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $2, $9, $10, $11, $6, $7), ($12, $2, $13, $14, $15, $6, $7)',
      [
        'le_' + crypto.randomBytes(8).toString('hex'), txId, bank, 'DEBIT', e.amountPaise,
        `Credit received: ${e.utr} for order ${e.orderId}`, e.creditedAt,
        'le_' + crypto.randomBytes(8).toString('hex'), revenue, 'CREDIT', e.amountPaise,
        `Revenue: ${e.utr} for order ${e.orderId}`,
        'le_' + crypto.randomBytes(8).toString('hex'), merchant, 'BALANCE', 0,
        `Balance adjustment for ${e.utr}`
      ]
    );
    await c.query('UPDATE sessions SET status = $1, utr = $2, state = $3, updated_at = now() WHERE order_id = $4',
      ['SUCCESS', e.utr, 'VERIFIED', e.orderId]);
    await c.query(
      'INSERT INTO utr_order_bindings (utr, order_id, bound_at) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (utr) DO UPDATE SET order_id = EXCLUDED.order_id, bound_at = EXCLUDED.bound_at',
      [e.utr, e.orderId, e.creditedAt]
    );
    await c.query(
      "UPDATE disha_reconciliation_inbox SET status = 'POSTED', transaction_id = $3, processed_at = now() " +
      "WHERE source = $1 AND event_id = $2", [source, e.eventId, txId]
    );
    
    await c.query('COMMIT'); active = false;
    return { state: 'POSTED', orderId: e.orderId, utr: e.utr, txId, amount, vpaAddress: e.payeeVpa, replayed: false };
  } catch (err) {
    if (active) try { await c.query('ROLLBACK') } catch (_) {}
    throw err;
  } finally { c.release() }
}

module.exports = { initializeReconciliationSchema, createReconciliationRouter, reconcileCredit, reconcileCreditInternal, reconcileCreditWithUtrClaim };
