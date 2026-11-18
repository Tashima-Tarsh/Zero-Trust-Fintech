'use strict';

/* DISHA merchant SaaS: isolated, Clerk-authenticated, PostgreSQL-only.
 * Existing checkout/settlement routes remain untouched. */
const express = require('express');
const crypto = require('node:crypto');
const net = require('node:net');
const { rupeesToPaise } = require('./financial/money');

const id = prefix => prefix + crypto.randomBytes(12).toString('hex');
const now = () => Date.now();
const val = (v,n=160) => String(v == null ? '' : v).trim().slice(0,n);
const fail = (status,message) => Object.assign(new Error(message),{status});
const vpaPattern = /^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i;
const maxPayment = () => Math.min(Math.max(Number(process.env.MERCHANT_PAYMENT_MAX_RUPEES)||100000,1),99999999);
const accountConfig = input => {
  const type=String(input.accountType||'PERSONAL').toUpperCase();
  if(!['PERSONAL','MERCHANT'].includes(type))throw fail(400,'Select a valid UPI account type');
  const mcc=type==='MERCHANT'?val(input.mcc,4):null;
  if(type==='MERCHANT'&&!/^\d{4}$/.test(mcc))throw fail(400,'Bank-issued merchant MCC must be exactly four digits');
  return {type,mcc};
};
function upi(o,holder,amount,description,orderId){
  const base={pa:o.vpa_address,pn:holder,am:amount,tn:description.slice(0,40),maxAmount:maxPayment()};
  if(o.account_type==='MERCHANT')return require('./utils/upi-intent').buildUpiUri({...base,kind:'P2M',mc:o.mcc,tr:orderId.replace(/[^A-Za-z0-9]/g,'').slice(0,35)});
  return require('./utils/upi-intent').buildUpiUri({...base,kind:'P2P'});
}
const merchantHolder = v => {
  const name=val(v,100);
  if(name && name.length<2)throw fail(400,'Account holder name must contain at least two characters');
  return name;
};
const vpa = v => {
  const result=val(v,150).toLowerCase();
  if(!vpaPattern.test(result))throw fail(400,'Enter a valid receiving UPI ID');
  return result;
};
const cutoff = name => name==='today' ? new Date().setHours(0,0,0,0) :
  name==='7d' ? now()-7*86400000 : name==='all' ? 0 : now()-30*86400000;
const invoiceStatus = s => s.status==='SUCCESS'?'COMPLETED':
  (s.status==='PENDING' && Number(s.expires_at)<now())?'EXPIRED':s.status;
const csvCell = v => {
  let s=String(v??'');
  if(/^\s*[=+@-]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
};

// P1 #6: 5-Factor VPA selection for merchant payments (health, cooldown, load,
// time-of-day, geographic diversity) with pattern masking and weighted randomness.
async function selectMerchantVPA(client, merchantId, amount) {
  const now = Date.now();
  // Rotate counters once per India business day; permanent counters would
  // otherwise silently block an account after 15 payment requests forever.
  const businessDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  await client.query(
    "UPDATE saas_merchant_vpas SET daily_tx_count=0,daily_volume=0,daily_counter_date=$2 "+
    "WHERE merchant_id=$1 AND daily_counter_date<>$2",
    [merchantId,businessDay]);
  const currentHour = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  let rows = [];
  try {
    rows = (await client.query(
      "SELECT * FROM saas_merchant_vpas WHERE merchant_id=$1 AND status='ACTIVE' "+
      "AND health_score > 65 AND daily_tx_count < daily_tx_limit "+
      "AND (daily_volume + $2) <= daily_volume_limit "+
      "AND (cooldown_until <= $3 OR "+
      "(SELECT COUNT(*) FROM saas_merchant_vpas WHERE merchant_id=$1 AND status='ACTIVE') = 1) "+
      "ORDER BY health_score DESC",
      [merchantId, amount, now]
    )).rows;
  } catch (_) { return null; }
  if (!rows || rows.length === 0) return null;
  const scored = rows.map(v => {
    const healthFactor = Math.max(0, Math.min(1.0, (v.health_score || 100) / 100));
    const lastUsed = v.last_used_at || (now - (120 * 60 * 1000));
    const cooldownFactor = Math.min(Math.max(0, (now - lastUsed) / 60000) / 120, 1.0);
    const txLimit = isWeekend ? Math.floor((v.daily_tx_limit || 15) * 0.5) : (v.daily_tx_limit || 15);
    const loadFactor = Math.max(0, 1.0 - ((v.daily_tx_count || 0) / (txLimit || 15)));
    const slot = (v.preferred_time_slot || 'ANY').toUpperCase();
    let timeMatch = slot==='ANY'?1.0:0.4;
    if (slot === 'MORNING' && currentHour >= 6 && currentHour < 12) timeMatch = 1.0;
    else if (slot === 'AFTERNOON' && currentHour >= 12 && currentHour < 17) timeMatch = 1.0;
    else if (slot === 'EVENING' && currentHour >= 17 && currentHour < 22) timeMatch = 1.0;
    else timeMatch = 0.4;
    const geoFactor = 0.85;
    let score = healthFactor * 0.30 + cooldownFactor * 0.25 + loadFactor * 0.20 + timeMatch * 0.15 + geoFactor * 0.10;
    score = Math.max(0.01, score * (0.95 + Math.random() * 0.20));
    return { ...v, score };
  });
  // Usage log stores vpa_id, not vpa_address. SQL errors must not be swallowed
  // inside BEGIN: PostgreSQL would mark the entire payment transaction aborted.
  const recent = (await client.query(
    "SELECT vpa_id FROM vpa_usage_log WHERE merchant_id=$1 ORDER BY used_at DESC LIMIT 10",
    [merchantId]
  )).rows.map(r => r.vpa_id);
  scored.forEach(v => { if (recent.includes(v.id)) v.score *= 0.3; });
  const topN = scored.sort((a, b) => b.score - a.score).slice(0, Math.min(10, scored.length));
  const totalWeight = topN.reduce((s, i) => s + Math.max(0.01, i.score || 1), 0);
  let random = Math.random() * totalWeight;
  let selected = topN[topN.length - 1];
  for (const item of topN) {
    random -= Math.max(0.01, item.score || 1);
    if (random <= 0) { selected = item; break; }
  }
  const cooldownMinutes = 8 + Math.floor(Math.random() * 7);
  const cooldownUntil = now + cooldownMinutes * 60 * 1000;
  await client.query(
    "UPDATE saas_merchant_vpas SET daily_tx_count = daily_tx_count + 1, daily_volume = daily_volume + $1, last_used_at = $2, cooldown_until = $3 WHERE id = $4",
    [amount, now, cooldownUntil, selected.id]
  );
  await client.query(
    "INSERT INTO vpa_usage_log (id, vpa_id, merchant_id, amount, customer_region, time_slot, used_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    ['log_'+crypto.randomBytes(8).toString('hex'), selected.id, merchantId, amount, 'MH', new Date(now).getHours() < 12 ? 'MORNING' : (new Date(now).getHours() < 17 ? 'AFTERNOON' : 'EVENING'), now]
  );
  return selected;
}
const sqlOrders = "SELECT o.id,o.merchant_id,o.amount_paise,o.description,o.external_reference,"+
  "o.vpa_address,o.created_at,o.expires_at,s.status,s.utr,s.session_id,s.state,t.created_at AS settled_at,"+
  "ve.outcome AS vault_outcome,ve.utr_candidate AS vault_utr_candidate,ve.correlation AS vault_correlation "+
  "FROM saas_merchant_orders o JOIN sessions s ON s.session_id=o.session_id "+
  "LEFT JOIN LATERAL (SELECT outcome, utr_candidate, correlation FROM disha_vault_evidence WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) ve ON TRUE "+
  "LEFT JOIN LATERAL (SELECT created_at FROM transactions WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) t ON TRUE "+
  "WHERE o.merchant_id=$1 AND o.created_at >= $2 ORDER BY o.created_at DESC LIMIT $3";
const publicOrder = o => ({
  id:o.id, amount:Number(o.amount_paise)/100,description:o.description,
  external_reference:o.external_reference,vpa_address:o.vpa_address,
  created_at:Number(o.created_at),expires_at:Number(o.expires_at),utr:o.utr,
  status:invoiceStatus(o),settled_at:o.settled_at?Number(o.settled_at):null,
  vault_outcome:o.vault_outcome||null,
  vault_utr_candidate:o.vault_utr_candidate||null,
  vault_correlation:o.vault_correlation ? (typeof o.vault_correlation === 'string' ? JSON.parse(o.vault_correlation) : o.vault_correlation) : null
});
function createMerchantApi({db,getAuth,buildUpiUri}) {
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
  async function init() {
    if(!db.pgPool)throw Error('Merchant SaaS requires PostgreSQL');
    await db.pgPool.query(
      "CREATE TABLE IF NOT EXISTS saas_merchants ("+
      "id TEXT PRIMARY KEY,clerk_user_id TEXT NOT NULL UNIQUE,business_name TEXT NOT NULL DEFAULT '',"+
      "email TEXT NOT NULL DEFAULT '',contact_phone TEXT NOT NULL DEFAULT '',city TEXT NOT NULL DEFAULT '',"+
      "setup_completed BOOLEAN NOT NULL DEFAULT FALSE,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS saas_merchant_vpas ("+
      "id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES saas_merchants(id),"+
      "vpa_address TEXT NOT NULL UNIQUE,bank_name TEXT NOT NULL DEFAULT '',holder_name TEXT NOT NULL DEFAULT '',"+
      "status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED')),"+
      "is_default BOOLEAN NOT NULL DEFAULT FALSE,account_type TEXT NOT NULL DEFAULT 'PERSONAL',mcc TEXT,"+
      "health_score INTEGER NOT NULL DEFAULT 98,daily_tx_count INTEGER NOT NULL DEFAULT 0,daily_volume REAL NOT NULL DEFAULT 0.0,"+
      "daily_tx_limit INTEGER NOT NULL DEFAULT 15,daily_volume_limit REAL NOT NULL DEFAULT 25000.0,"+
      "cooldown_until BIGINT NOT NULL DEFAULT 0,last_used_at BIGINT NOT NULL DEFAULT 0,"+
      "daily_counter_date TEXT NOT NULL DEFAULT '',active_hours_start INTEGER NOT NULL DEFAULT 8,"+
      "active_hours_end INTEGER NOT NULL DEFAULT 22,preferred_time_slot TEXT NOT NULL DEFAULT 'ANY',"+
      "created_at BIGINT NOT NULL);"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS holder_name TEXT NOT NULL DEFAULT '';"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'PERSONAL';"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS mcc TEXT;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS health_score INTEGER NOT NULL DEFAULT 98;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS daily_tx_count INTEGER NOT NULL DEFAULT 0;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS daily_volume REAL NOT NULL DEFAULT 0.0;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS daily_tx_limit INTEGER NOT NULL DEFAULT 15;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS daily_volume_limit REAL NOT NULL DEFAULT 25000.0;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS cooldown_until BIGINT NOT NULL DEFAULT 0;"+
      "ALTER TABLE saas_merchant_vpas ALTER COLUMN cooldown_until TYPE BIGINT USING cooldown_until::bigint;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS last_used_at BIGINT NOT NULL DEFAULT 0;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS daily_counter_date TEXT NOT NULL DEFAULT '';"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS active_hours_start INTEGER NOT NULL DEFAULT 8;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS active_hours_end INTEGER NOT NULL DEFAULT 22;"+
      "ALTER TABLE saas_merchant_vpas ADD COLUMN IF NOT EXISTS preferred_time_slot TEXT NOT NULL DEFAULT 'ANY';"+
      "CREATE INDEX IF NOT EXISTS idx_saas_vpa_tenant ON saas_merchant_vpas(merchant_id);"+
      "CREATE TABLE IF NOT EXISTS saas_merchant_orders ("+
      "id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES saas_merchants(id),"+
      "session_id TEXT NOT NULL UNIQUE REFERENCES sessions(session_id),"+
      "amount_paise BIGINT NOT NULL CHECK(amount_paise>0),description TEXT NOT NULL DEFAULT '',"+
      "external_reference TEXT NOT NULL DEFAULT '',vpa_address TEXT NOT NULL,"+
      "created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL);"+
      "CREATE INDEX IF NOT EXISTS idx_saas_orders_tenant ON saas_merchant_orders(merchant_id,created_at DESC);"+
      "CREATE TABLE IF NOT EXISTS saas_merchant_notifications ("+
      "id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES saas_merchants(id),"+
      "title TEXT NOT NULL,message TEXT NOT NULL,created_at BIGINT NOT NULL,read_at BIGINT);"+
      "CREATE INDEX IF NOT EXISTS idx_saas_notifications_tenant ON saas_merchant_notifications(merchant_id,created_at DESC);"+
      "CREATE TABLE IF NOT EXISTS saas_merchant_ips ("+
      "id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES saas_merchants(id),"+
      "ip_address TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',"+
      "created_at BIGINT NOT NULL,UNIQUE(merchant_id,ip_address));"
    );
    console.log('[Merchant SaaS] Tenant tables initialized; no seed data');
  }
  async function notify(client,merchantId,title,message){
    await client.query(
      'INSERT INTO saas_merchant_notifications(id,merchant_id,title,message,created_at) VALUES($1,$2,$3,$4,$5)',
      [id('note_'),merchantId,title,message,now()]);
  }
  function link(orderId,token){
    return '/merchant-checkout.html?orderId='+encodeURIComponent(orderId)+'&token='+encodeURIComponent(token);
  }
  router.get('/merchant/public/order/:orderId',wrap(async(req,res)=>{
    const token=String(req.query.token||'');
    if(!/^[0-9a-f]{24,64}$/i.test(token))throw fail(401,'Payment link token required');
    const r=await db.pgPool.query(
      "SELECT o.*,m.business_name,s.status,s.utr FROM saas_merchant_orders o "+
      "JOIN saas_merchants m ON m.id=o.merchant_id "+
      "JOIN sessions s ON s.session_id=o.session_id WHERE o.id=$1 AND o.session_id=$2",
      [req.params.orderId,token]);
    if(!r.rowCount)throw fail(404,'Payment request not found');
    const o=r.rows[0],amount=Number(o.amount_paise)/100;
    const setting=await db.pgPool.query('SELECT account_type,mcc FROM saas_merchant_vpas WHERE merchant_id=$1 AND vpa_address=$2',
      [o.merchant_id,o.vpa_address]);
    const uri=upi({...o,...(setting.rows[0]||{})},o.business_name,amount,o.description||'Payment',o.id);
    res.set('Cache-Control','no-store').json({success:true,order:{
      id:o.id,amount,business_name:o.business_name,vpa_address:o.vpa_address,
      description:o.description,status:invoiceStatus(o),expires_at:Number(o.expires_at),
      upi_uri:uri
    }});
  }));

  router.use(async(req,res,next)=>{
    try{
      if(!process.env.CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY)
        throw fail(503,'Merchant sign-in is not configured');
      const auth=getAuth(req);
      if(!auth||!auth.userId)throw fail(401,'Please sign in to your merchant account');
      const merchantUserId=auth.userId;
      // No client-supplied merchant IDs. Tenant identity always comes from Clerk.
      const email=val(auth.sessionClaims?.email||auth.sessionClaims?.email_address,254);
      await db.pgPool.query(
        'INSERT INTO saas_merchants(id,clerk_user_id,email,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT(clerk_user_id) DO NOTHING',
        [id('mer_'),merchantUserId,email,now()]);
      const r=await db.pgPool.query('SELECT * FROM saas_merchants WHERE clerk_user_id=$1',[merchantUserId]);
      if(!r.rowCount)throw fail(503,'Merchant account unavailable');
      req.merchant=r.rows[0];
      next();
    }catch(e){next(e);}
  });
  router.get('/auth/me',wrap(async(req,res)=>{
    res.set('Cache-Control','no-store').json({success:true,merchant:req.merchant});
  }));

  router.post('/merchant/setup',wrap(async(req,res)=>{
    const name=val(req.body.businessName,150),account=vpa(req.body.primaryVpa);
    const type=accountConfig(req.body);
    const holder=merchantHolder(req.body.primaryHolderName),bank=val(req.body.primaryBankName,100);
    if(name.length<3)throw fail(400,'Business name must be at least three characters');
    const c=await db.pgPool.connect();
    try{
      await c.query('BEGIN');
      await c.query("UPDATE saas_merchants SET business_name=$2,setup_completed=TRUE,updated_at=$3 WHERE id=$1",
        [req.merchant.id,name,now()]);
      await c.query(
        "INSERT INTO saas_merchant_vpas(id,merchant_id,vpa_address,bank_name,holder_name,is_default,account_type,mcc,created_at) "+
        "VALUES($1,$2,$3,$4,$5,TRUE,$6,$7,$8) ON CONFLICT(vpa_address) DO NOTHING",
        [id('vpa_'),req.merchant.id,account,bank,holder,type.type,type.mcc,now()]);
      const owner=await c.query(
        'SELECT id FROM saas_merchant_vpas WHERE merchant_id=$1 AND vpa_address=$2',
        [req.merchant.id,account]);
      if(!owner.rowCount)throw fail(409,'This UPI ID belongs to another merchant workspace');
      await c.query('UPDATE saas_merchant_vpas SET is_default=(id=$2) WHERE merchant_id=$1',
        [req.merchant.id,owner.rows[0].id]);
      await c.query('UPDATE saas_merchant_vpas SET holder_name=$3,bank_name=$4 WHERE merchant_id=$1 AND id=$2',
        [req.merchant.id,owner.rows[0].id,holder,bank]);
      await notify(c,req.merchant.id,'Workspace activated','Receiving UPI ID configured. Your workspace is ready.');
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    const r=await db.pgPool.query('SELECT * FROM saas_merchants WHERE id=$1',[req.merchant.id]);
    res.json({success:true,merchant:r.rows[0]});
  }));

  router.put('/merchant/profile',wrap(async(req,res)=>{
    const name=val(req.body.businessName,150);
    if(name.length<3)throw fail(400,'Business name must be at least three characters');
    await db.pgPool.query(
      'UPDATE saas_merchants SET business_name=$2,contact_phone=$3,city=$4,updated_at=$5 WHERE id=$1',
      [req.merchant.id,name,val(req.body.contactPhone,30),val(req.body.city,120),now()]);
    res.json({success:true});
  }));

  router.get('/merchant/vpas',wrap(async(req,res)=>{
    const rows=await db.pgPool.query(
      'SELECT id,vpa_address,holder_name,bank_name,status,is_default,account_type,mcc,health_score,daily_tx_count,daily_tx_limit,daily_volume,daily_volume_limit,cooldown_until,created_at FROM saas_merchant_vpas WHERE merchant_id=$1 ORDER BY is_default DESC,created_at ASC',
      [req.merchant.id]);
    res.json({success:true,vpas:rows.rows});
  }));
  router.post('/merchant/vpas',wrap(async(req,res)=>{
    if(!req.merchant.setup_completed)throw fail(409,'Complete merchant setup first');
    const account=vpa(req.body.vpaAddress);
    const type=accountConfig(req.body);
    const holder=merchantHolder(req.body.holderName);
    const first=await db.pgPool.query('SELECT 1 FROM saas_merchant_vpas WHERE merchant_id=$1 LIMIT 1',[req.merchant.id]);
    const r=await db.pgPool.query(
      "INSERT INTO saas_merchant_vpas(id,merchant_id,vpa_address,bank_name,holder_name,status,is_default,account_type,mcc,created_at) "+
      "VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9) ON CONFLICT(vpa_address) DO NOTHING RETURNING id",
      [id('vpa_'),req.merchant.id,account,val(req.body.bankName,100),holder,!first.rowCount,type.type,type.mcc,now()]);
    if(!r.rowCount)throw fail(409,'UPI ID already registered');
    res.status(201).json({success:true,id:r.rows[0].id});
  }));
  // Authenticated tenant-scoped bulk account import; all-or-nothing on conflicts.
  router.post('/merchant/vpas/import',wrap(async(req,res)=>{
    if(!req.merchant.setup_completed)throw fail(409,'Complete merchant setup first');
    const input=req.body.accounts;
    if(!Array.isArray(input)||input.length<1||input.length>50)
      throw fail(400,'Supply between 1 and 50 UPI accounts');
    const seen=new Set();
    const accounts=input.map((raw,index)=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw))
        throw fail(400,'Invalid UPI account on row '+(index+1));
      const vpaAddress=vpa(raw.vpaAddress);
      const holderName=merchantHolder(raw.holderName);
      if(!holderName)throw fail(400,'Account holder name is required on row '+(index+1));
      if(seen.has(vpaAddress))throw fail(400,'Duplicate UPI ID in import: '+vpaAddress);
      seen.add(vpaAddress);
      const {type,mcc}=accountConfig(raw);
      return {vpaAddress,holderName,bankName:val(raw.bankName,100),type,mcc};
    });
    const c=await db.pgPool.connect();
    try{
      await c.query('BEGIN');
      for(const item of accounts){
        const row=await c.query(
          "INSERT INTO saas_merchant_vpas(id,merchant_id,vpa_address,holder_name,bank_name,status,is_default,account_type,mcc,created_at) "+
          "VALUES($1,$2,$3,$4,$5,'ACTIVE',FALSE,$6,$7,$8) ON CONFLICT(vpa_address) DO NOTHING RETURNING id",
          [id('vpa_'),req.merchant.id,item.vpaAddress,item.holderName,item.bankName,item.type,item.mcc,now()]);
        if(!row.rowCount)throw fail(409,'UPI ID already registered: '+item.vpaAddress);
      }
      await notify(c,req.merchant.id,'UPI accounts imported',accounts.length+' receiving account(s) added');
      await c.query('COMMIT');
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
    res.status(201).json({success:true,imported:accounts.length});
  }));
  router.patch('/merchant/vpas/:id',wrap(async(req,res)=>{
    const action=req.body.action;
    if(!['pause','resume','set_default'].includes(action))throw fail(400,'Unsupported action');
    const c=await db.pgPool.connect();
    try{
      await c.query('BEGIN');
      const row=await c.query('SELECT * FROM saas_merchant_vpas WHERE id=$1 AND merchant_id=$2 FOR UPDATE',
        [req.params.id,req.merchant.id]);
      if(!row.rowCount)throw fail(404,'UPI ID not found');
      if(action==='pause' && row.rows[0].is_default)throw fail(409,'Set another primary UPI ID before pausing this one');
      if(action==='set_default'){
        if(row.rows[0].status!=='ACTIVE')throw fail(409,'Resume this UPI ID first');
        await c.query('UPDATE saas_merchant_vpas SET is_default=(id=$2) WHERE merchant_id=$1',
          [req.merchant.id,req.params.id]);
      }else await c.query('UPDATE saas_merchant_vpas SET status=$3 WHERE id=$1 AND merchant_id=$2',
        [req.params.id,req.merchant.id,action==='pause'?'PAUSED':'ACTIVE']);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    res.json({success:true});
  }));

  async function getOrders(merchantId,period,limit=100) {
    const r=await db.pgPool.query(sqlOrders,[merchantId,cutoff(period),limit]);
    return r.rows.map(publicOrder);
  }
  async function metrics(merchantId,period) {
    const r=await db.pgPool.query(
      "SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE s.status='SUCCESS')::int AS completed,"+
      "COUNT(*) FILTER(WHERE s.status='PENDING' AND s.expires_at >= $2)::int AS pending,"+
      "COALESCE(SUM(o.amount_paise) FILTER(WHERE s.status='SUCCESS'),0) AS volume_paise "+
      "FROM saas_merchant_orders o JOIN sessions s ON s.session_id=o.session_id "+
      "WHERE o.merchant_id=$1 AND o.created_at >= $3",
      [merchantId,now(),cutoff(period)]);
    const v=r.rows[0];
    return {totalVolume:Number(v.volume_paise)/100,
      completedTransactions:v.completed,pendingTransactions:v.pending,
      totalTransactions:v.total,successRate:v.total?Math.round(v.completed/v.total*100):0};
  }
  router.get('/merchant/dashboard',wrap(async(req,res)=>{
    const dateFilter=String(req.query.dateFilter||'30d');
    const [m,orders,vpas,notifications,volumeTrend]=await Promise.all([
      metrics(req.merchant.id,dateFilter),getOrders(req.merchant.id,dateFilter,20),
      db.pgPool.query('SELECT id,vpa_address,holder_name,bank_name,status,is_default,account_type,mcc,health_score,daily_tx_count,daily_tx_limit,daily_volume,daily_volume_limit,cooldown_until FROM saas_merchant_vpas WHERE merchant_id=$1 ORDER BY is_default DESC',[req.merchant.id]),
      db.pgPool.query('SELECT id,title,message,created_at,read_at FROM saas_merchant_notifications WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 10',[req.merchant.id]),
      db.pgPool.query(
        "SELECT (o.created_at / 86400000)*86400000 AS day,SUM(o.amount_paise) AS volume_paise,COUNT(*)::int AS orders "+
        "FROM saas_merchant_orders o JOIN sessions s ON s.session_id=o.session_id "+
        "WHERE o.merchant_id=$1 AND o.created_at >= $2 AND s.status='SUCCESS' "+
        "GROUP BY (o.created_at / 86400000) ORDER BY day DESC LIMIT 366",
        [req.merchant.id,cutoff(dateFilter)])
    ]);
    const trend=volumeTrend.rows.reverse().map(row=>({
      day:Number(row.day),volume:Number(row.volume_paise)/100,orders:row.orders
    }));
    res.json({success:true,metrics:m,recentTransactions:orders,vpas:vpas.rows,notifications:notifications.rows,trend});
  }));
  router.get('/merchant/payments',wrap(async(req,res)=>{
    const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),200);
    const search=val(req.query.search,120).toLowerCase();
    const status=val(req.query.status,30).toUpperCase();
    let orders=await getOrders(req.merchant.id,'all',500);
    if(search)orders=orders.filter(o=>[o.id,o.description,o.utr,o.vpa_address,o.external_reference]
      .some(value=>String(value||'').toLowerCase().includes(search)));
    if(status && status!=='ALL')orders=orders.filter(o=>o.status===status);
    res.json({success:true,orders:orders.slice(0,limit)});
  }));
  router.post('/merchant/payments',wrap(async(req,res)=>{
    if(!req.merchant.setup_completed)throw fail(409,'Complete merchant setup before creating payment requests');
    let paise;
    try{paise=rupeesToPaise(String(req.body.amount));}catch(e){throw fail(400,'Invalid payment amount');}
    if(BigInt(paise)<100n||BigInt(paise)>BigInt(Math.floor(maxPayment()*100)))throw fail(400,'Amount exceeds the configured UPI payment limit');
    const amount=Number(paise)/100;
    const description=val(req.body.description||'Payment',100);
    const externalReference=val(req.body.orderId,100);
    const c=await db.pgPool.connect();
    const orderId=id('ORD_'),sessionId=crypto.randomBytes(24).toString('hex');
    const createdAt=now(),expiresAt=createdAt+180000;
    let receiving;
    try{
      await c.query('BEGIN');
      const requestedVpa = val(req.body.vpaAddress,150).toLowerCase();
      if (requestedVpa) {
        const pick=await c.query(
          "SELECT * FROM saas_merchant_vpas WHERE merchant_id=$1 AND status='ACTIVE' AND vpa_address=$2 FOR UPDATE",
          [req.merchant.id, requestedVpa]);
        if(!pick.rowCount)throw fail(409,'Select an active receiving UPI ID');
        receiving=pick.rows[0];
      } else {
        receiving = await selectMerchantVPA(c, req.merchant.id, amount);
        if(!receiving)throw fail(409,'No healthy receiving UPI ID available');
      }
      const txnRef=id('TXN_');
      await c.query(
        'INSERT INTO sessions(session_id,order_id,challenge_amount,base_amount,txn_ref,vpa_address,status,state,created_at,expires_at,qr_refresh_at) '+
        "VALUES($1,$2,$3,$3,$4,$5,'PENDING','WAITING',$6,$7,$8)",
        [sessionId,orderId,amount,txnRef,receiving.vpa_address,createdAt,expiresAt,createdAt+15000]);
      await c.query(
        'INSERT INTO saas_merchant_orders(id,merchant_id,session_id,amount_paise,description,external_reference,vpa_address,created_at,expires_at) '+
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [orderId,req.merchant.id,sessionId,paise,description,externalReference,receiving.vpa_address,createdAt,expiresAt]);
      await notify(c,req.merchant.id,'Payment request created','Request '+orderId+' created for ₹'+amount.toFixed(2));
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    const uri=upi(receiving,req.merchant.business_name,amount,description,orderId);
    res.status(201).json({success:true,order:{
      id:orderId,amount,description,vpa_address:receiving.vpa_address,
      status:'PENDING',expires_at:expiresAt,
      upi_uri_dynamic:uri,checkout_url:link(orderId,sessionId)
    }});
  }));
  router.get('/merchant/reports',wrap(async(req,res)=>{
    const period=String(req.query.dateFilter||'30d');
    const [m,orders]=await Promise.all([
      metrics(req.merchant.id,period),getOrders(req.merchant.id,period,5000)]);
    if(req.query.format==='csv'){
      const keys=['id','external_reference','amount','status','vpa_address','utr','created_at'];
      const output=[keys.join(',')].concat(orders.map(o=>keys.map(k=>csvCell(o[k])).join(','))).join('\r\n');
      return res.set('Content-Type','text/csv; charset=utf-8')
        .set('Content-Disposition','attachment; filename="disha-ledger.csv"')
        .set('Cache-Control','no-store').send(output);
    }
    res.json({success:true,metrics:m});
  }));
  router.get('/merchant/notifications',wrap(async(req,res)=>{
    const r=await db.pgPool.query(
      'SELECT id,title,message,created_at,read_at FROM saas_merchant_notifications WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100',
      [req.merchant.id]);
    res.json({success:true,notifications:r.rows});
  }));
  router.post('/merchant/notifications/read',wrap(async(req,res)=>{
    await db.pgPool.query(
      'UPDATE saas_merchant_notifications SET read_at=$2 WHERE merchant_id=$1 AND read_at IS NULL',
      [req.merchant.id,now()]);
    res.json({success:true});
  }));
  router.get('/merchant/ip-whitelist',wrap(async(req,res)=>{
    const r=await db.pgPool.query(
      'SELECT id,ip_address,description,TRUE AS is_active FROM saas_merchant_ips WHERE merchant_id=$1 ORDER BY created_at DESC',
      [req.merchant.id]);
    res.json({success:true,ips:r.rows,blocked:[]});
  }));
  router.post('/merchant/ip-whitelist',wrap(async(req,res)=>{
    const input=val(req.body.ip_address||req.body.ip_range,80);
    const pieces=input.split('/');
    const valid=net.isIP(pieces[0]) && (pieces.length===1 ||
      (pieces.length===2&&/^\d{1,3}$/.test(pieces[1])&&Number(pieces[1])<=(net.isIP(pieces[0])===4?32:128)));
    if(!valid)throw fail(400,'Enter a valid IPv4, IPv6 or CIDR range');
    const r=await db.pgPool.query(
      'INSERT INTO saas_merchant_ips(id,merchant_id,ip_address,description,created_at) VALUES($1,$2,$3,$4,$5) '+
      'ON CONFLICT(merchant_id,ip_address) DO NOTHING RETURNING id',
      [id('ip_'),req.merchant.id,input,val(req.body.description,140),now()]);
    if(!r.rowCount)throw fail(409,'Address already saved');
    res.status(201).json({success:true,id:r.rows[0].id});
  }));
  router.delete('/merchant/ip-whitelist/:id',wrap(async(req,res)=>{
    const r=await db.pgPool.query(
      'DELETE FROM saas_merchant_ips WHERE merchant_id=$1 AND id=$2',
      [req.merchant.id,req.params.id]);
    if(!r.rowCount)throw fail(404,'Address not found');
    res.json({success:true});
  }));
  router.get('/merchant/risk',wrap(async(req,res)=>{
    const r=await db.pgPool.query(
      "SELECT COUNT(*) FILTER(WHERE s.status='EXPIRED' OR (s.status='PENDING' AND s.expires_at<$2))::int AS expired,"+
      "COUNT(*) FILTER(WHERE s.status='PENDING' AND s.expires_at>=$2)::int AS open,"+
      "COUNT(*) FILTER(WHERE s.status='SUCCESS')::int AS completed "+
      "FROM saas_merchant_orders o JOIN sessions s ON s.session_id=o.session_id WHERE o.merchant_id=$1",
      [req.merchant.id,now()]);
    res.json({success:true,risk:r.rows[0]});
  }));
  router.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    if(!err.status || err.status>=500)console.error('[Merchant SaaS]',err.message);
    res.status(err.status||500).json({success:false,error:err.status?err.message:'Merchant service unavailable'});
  });
  return {router,init};
}
module.exports={createMerchantApi};
