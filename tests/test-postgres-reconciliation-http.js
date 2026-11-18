'use strict';
// Financial reconciliation HTTP integration tests, disposable localhost PostgreSQL only.
// Synthetic signed statements here are CI fixtures, never live-bank evidence.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const http=require('node:http');
const {Pool}=require('pg');
const {createMerchantApi}=require('../merchant-api');
const {buildUpiUri}=require('../utils/upi-intent');
const {initializeReconciliationSchema,createReconciliationRouter}=require('../financial/reconciliation-webhook');

(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))
    throw Error('Reconciliation tests must use disposable localhost PostgreSQL');
  const pool=new Pool({connectionString:url,max:4});
  let server;
  const oldSecret=process.env.RECONCILIATION_WEBHOOK_SECRET;
  const oldSource=process.env.RECONCILIATION_SOURCE_ID;
  const secret='ci-reconciliation-secret-at-least-32-characters-long';
  const source='ci-bank-statement-connector';
  const nonce=crypto.randomBytes(5).toString('hex');
  const callbacks=[];
  try{
    for(const p of ['schema.sql','migrations/001_financial_core.sql','migrations/002_postgres_checkout.sql']){
      await pool.query(fs.readFileSync(path.join(__dirname,'..',p),'utf8'));
    }
    process.env.CLERK_PUBLISHABLE_KEY='pk_test_only';
    process.env.CLERK_SECRET_KEY='sk_test_only';
    await createMerchantApi({db:{pgPool:pool},getAuth:()=>({userId:null}),buildUpiUri}).init();
    await initializeReconciliationSchema(pool);
    const app=express();
    app.use(express.json({verify:(req,res,raw)=>{req.rawReconciliationBody=Buffer.from(raw)}}));
    app.use('/api/reconciliation',createReconciliationRouter({
      getPool:()=>pool,onSettled:(orderId,data)=>callbacks.push({orderId,data})
    }));
    server=http.createServer(app);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    async function post(body,options={}){
      const payload=JSON.stringify(body);
      const timestamp=options.timestamp||String(Math.floor(Date.now()/1000));
      const signature=crypto.createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
      const res=await fetch(base+'/api/reconciliation/credit',{
        method:'POST',headers:{
          'Content-Type':'application/json','X-Disha-Timestamp':timestamp,
          'X-Disha-Signature':'sha256='+(options.invalidSignature?'a'.repeat(64):signature)
        },body:payload,signal:AbortSignal.timeout(8000)});
      return {status:res.status,data:await res.json()};
    }
    async function newSession(merchantId='mer_default',amount='500.01',vpa='qa@oksbi'){
      const orderId='ORD_RECON_'+crypto.randomBytes(8).toString('hex');
      const sessionId=crypto.randomBytes(24).toString('hex');
      const time=Date.now();
      await pool.query(
        'INSERT INTO sessions(session_id,order_id,challenge_amount,base_amount,txn_ref,'+
        'vpa_address,status,state,created_at,expires_at,qr_refresh_at) '+
        "VALUES($1,$2,$3,$3,$4,$5,'PENDING','WAITING',$6,$7,$8)",
        [sessionId,orderId,amount,'TXN_'+crypto.randomBytes(10).toString('hex'),
          vpa,time-30000,time+150000,time+5000]);
      if(merchantId!=='mer_default')await pool.query(
        'INSERT INTO saas_merchant_orders(id,merchant_id,session_id,amount_paise,'+
        'description,external_reference,vpa_address,created_at,expires_at) '+
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [orderId,merchantId,sessionId,'50001','CI credit','ci-'+nonce,vpa,time,time+150000]);
      return {orderId,createdAt:time-30000,vpa};
    }
    const event=(s,overrides={})=>({
      source,eventId:'evt_'+crypto.randomBytes(8).toString('hex'),
      statementEntryId:'stmt_'+crypto.randomBytes(8).toString('hex'),
      direction:'CREDIT',status:'POSTED',bankEvidence:'VERIFIED_STATEMENT',
      merchantId:'mer_default',orderId:s.orderId,
      utr:String(crypto.randomInt(100000000000,999999999999)),
      payeeVpa:s.vpa,amountPaise:'50001',creditedAt:Date.now(),...overrides
    });

    const disabled=await post(event({orderId:'ORD_DISABLED',vpa:'qa@oksbi'}));
    assert.equal(disabled.status,503,'Feature must fail closed without connector credentials');
    process.env.RECONCILIATION_WEBHOOK_SECRET=secret;
    process.env.RECONCILIATION_SOURCE_ID=source;
    const s=await newSession();
    const credit=event(s);
    let result=await post(credit,{invalidSignature:true});
    assert.equal(result.status,401,'Forged signature rejected');
    result=await post(credit,{timestamp:String(Math.floor(Date.now()/1000)-10000)});
    assert.equal(result.status,401,'Stale signed event rejected');
    assert.equal((await pool.query('SELECT count(*)::int n FROM transactions WHERE order_id=$1',[s.orderId])).rows[0].n,0);
    result=await post(credit);
    assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(result.data.state,'POSTED');
    assert.equal(result.data.replayed,false);
    assert.equal(callbacks.length,1);
    let rows=await pool.query('SELECT status,state,utr FROM sessions WHERE order_id=$1',[s.orderId]);
    assert.equal(rows.rows[0].status,'SUCCESS');
    assert.equal(rows.rows[0].state,'VERIFIED');
    assert.equal(rows.rows[0].utr,credit.utr);
    rows=await pool.query(
      'SELECT j.merchant_id,j.amount_paise,j.state,COUNT(p.posting_id)::int entries,'+
      "SUM(p.amount_paise) FILTER(WHERE p.side='DEBIT') debits,"+
      "SUM(p.amount_paise) FILTER(WHERE p.side='CREDIT') credits "+
      'FROM disha_core_journals j JOIN disha_core_postings p ON p.journal_id=j.journal_id '+
      'WHERE j.order_id=$1 GROUP BY j.merchant_id,j.amount_paise,j.state',[s.orderId]);
    assert.equal(rows.rows[0].entries,2);
    assert.equal(rows.rows[0].debits,'50001');
    assert.equal(rows.rows[0].credits,'50001');
    result=await post(credit);
    assert.equal(result.status,200);
    assert.equal(result.data.replayed,true);
    assert.equal(callbacks.length,1);
    result=await post({...credit,amountPaise:'50002'});
    assert.equal(result.status,409,'Event ID cannot be reused with altered payload');
    const wrong=await newSession();
    result=await post(event(wrong,{payeeVpa:'attacker@upi'}));
    assert.equal(result.status,202);
    assert.equal(result.data.reason,'PAYEE_MISMATCH');
    assert.equal((await pool.query('SELECT status FROM sessions WHERE order_id=$1',[wrong.orderId])).rows[0].status,'PENDING');
    result=await post(event(wrong,{amountPaise:'50002'}));
    assert.equal(result.status,202);
    assert.equal(result.data.reason,'AMOUNT_MISMATCH');
    result=await post(event(wrong,{utr:credit.utr}));
    assert.equal(result.status,202);
    assert.equal(result.data.reason,'UTR_BOUND_TO_OTHER_ORDER');

    // Distinct SaaS merchant receives its own postings/notification, never default.
    const tenant='mer_ci_'+nonce;
    await pool.query('INSERT INTO saas_merchants(id,clerk_user_id,business_name,created_at,updated_at) '+
      'VALUES($1,$2,$3,$4,$4)',[tenant,'ci_'+nonce,'CI Merchant',Date.now()]);
    const ms=await newSession(tenant,'500.01','tenant@okhdfcbank');
    const credited=event(ms,{merchantId:tenant});
    result=await post(credited);
    assert.equal(result.status,200,JSON.stringify(result));
    rows=await pool.query('SELECT merchant_id FROM disha_core_journals WHERE order_id=$1',[ms.orderId]);
    assert.equal(rows.rows[0].merchant_id,tenant);
    rows=await pool.query('SELECT count(*)::int n FROM saas_merchant_notifications WHERE merchant_id=$1',[tenant]);
    assert.equal(rows.rows[0].n,1);
    const stranger=await newSession();
    result=await post(event(stranger,{merchantId:tenant}));
    assert.equal(result.data.reason,'MERCHANT_MISMATCH');
    assert.equal(callbacks.length,2);
    console.log('FINANCIAL_RECONCILIATION_INTEGRATION_PASS: HMAC, replay, signed source, '+
      'quarantine, UTR, amount, payee, atomic journals, tenant isolation and notifications.');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool.end();
    if(oldSecret===undefined)delete process.env.RECONCILIATION_WEBHOOK_SECRET;
    else process.env.RECONCILIATION_WEBHOOK_SECRET=oldSecret;
    if(oldSource===undefined)delete process.env.RECONCILIATION_SOURCE_ID;
    else process.env.RECONCILIATION_SOURCE_ID=oldSource;
  }
})().catch(e=>{console.error(e);process.exitCode=1});
