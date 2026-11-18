'use strict';
// Disposable PostgreSQL integration test; explicit mock Clerk subject exists ONLY in CI.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const express=require('express');
const {Pool}=require('pg');
const {createMerchantApi}=require('../merchant-api');
const {buildUpiUri}=require('../utils/upi-intent');
(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))
   throw Error('Merchant integration test accepts only local ephemeral PostgreSQL');
 process.env.CLERK_PUBLISHABLE_KEY='pk_test_only';
 process.env.CLERK_SECRET_KEY='sk_test_only';
 const pg=new Pool({connectionString:url});
 const app=express();
 app.use(express.json());
 const ctx=createMerchantApi({
  db:{pgPool:pg},
  getAuth:req=>({userId:req.get('x-ci-clerk-subject')||null,sessionClaims:{}}),
  buildUpiUri
 });
 let server;
 try{
  for(const file of ['schema.sql','migrations/001_financial_core.sql','migrations/002_postgres_checkout.sql']){
   await pg.query(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  }
  await ctx.init();
  app.use('/api',ctx.router);
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const nonce=Date.now().toString(36);
  async function call(route,user,method='GET',body){
   const headers={};
   if(user)headers['x-ci-clerk-subject']=user;
   if(body)headers['content-type']='application/json';
   const response=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});
   const type=response.headers.get('content-type')||'';
   return {status:response.status,data:type.includes('application/json')?await response.json():await response.text()};
  }
  const alice='ci_alice_'+nonce,bob='ci_bob_'+nonce;
  let result=await call('/api/auth/me');
  assert.equal(result.status,401,'Merchant access must be unauthorized without Clerk subject');
  result=await call('/api/auth/me',alice);
  assert.equal(result.status,200);
  assert.equal(result.data.merchant.setup_completed,false);
  let b=await call('/api/auth/me',bob);
  assert.equal(b.status,200);
  assert.notEqual(result.data.merchant.id,b.data.merchant.id);
  let r=await call('/api/merchant/payments',alice,'POST',{amount:'500.01'});
  assert.equal(r.status,409,'Cannot create a payment without merchant onboarding');
  r=await call('/api/merchant/setup',alice,'POST',{businessName:'Acme '+nonce,primaryVpa:'acme'+nonce+'@oksbi',primaryHolderName:'Acme Treasury',primaryBankName:'SBI'});
  assert.equal(r.status,200);
  assert.equal(r.data.merchant.setup_completed,true);
  r=await call('/api/merchant/setup',bob,'POST',{businessName:'Other '+nonce,primaryVpa:'bob'+nonce+'@ybl'});
  assert.equal(r.status,200);
  r=await call('/api/merchant/vpas',alice);
  assert.equal(r.data.vpas.length,1);
  r=await call('/api/merchant/vpas',bob);
  assert.equal(r.data.vpas.length,1);
  r=await call('/api/merchant/vpas',bob,'POST',{vpaAddress:'acme'+nonce+'@oksbi'});
  assert.equal(r.status,409,'UPI ID ownership must be unique across tenants');
  r=await call('/api/merchant/payments',alice,'POST',{
   amount:'500.01',description:'Real request',orderId:'invoice-1'});
  assert.equal(r.status,201);
  const order=r.data.order;
  assert.equal(order.amount,500.01);
  assert.equal(order.status,'PENDING');
  assert.ok(order.checkout_url.includes('/merchant-checkout.html?'));
  assert.ok(order.upi_uri_dynamic.startsWith('upi://pay?'));
  assert.ok(order.upi_uri_dynamic.includes('pa=acme'));
  // 24/7 single-account merchant must not get blocked by routing-hours or
  // arbitrary per-request cooldown while creating consecutive requests.
  await pg.query('UPDATE saas_merchant_vpas SET active_hours_start=0,active_hours_end=1 WHERE vpa_address=$1',
    ['acme'+nonce+'@oksbi']);
  r=await call('/api/merchant/payments',alice,'POST',{
    amount:'125.00',description:'Second real request'});
  assert.equal(r.status,201,'One-account merchant must create repeated payment links without cooldown blocking');
  assert.ok(r.data.order.upi_uri_dynamic.includes('pa=acme'));
  const vpaStorage=await pg.query('SELECT daily_counter_date,last_used_at,cooldown_until FROM saas_merchant_vpas WHERE vpa_address=$1',
    ['acme'+nonce+'@oksbi']);
  assert.equal(typeof vpaStorage.rows[0].daily_counter_date,'string');
  assert.ok(Number(vpaStorage.rows[0].last_used_at)>0);
  assert.ok(Number(vpaStorage.rows[0].cooldown_until)>0);
  r=await call('/api/merchant/vpas',alice);
  assert.equal(r.status,200);
  assert.equal(r.data.vpas[0].holder_name,'Acme Treasury');
  assert.equal(r.data.vpas[0].bank_name,'SBI');
  assert.ok(Number(r.data.vpas[0].health_score)>=0,'Routing screen must receive real internal health data');
  assert.ok(Number.isFinite(Number(r.data.vpas[0].daily_tx_count)));
  assert.ok(Number.isFinite(Number(r.data.vpas[0].daily_tx_limit)));
  assert.ok(Number.isFinite(Number(r.data.vpas[0].cooldown_until)));

  r=await call('/api/merchant/vpas/import',alice,'POST',{accounts:[
    {vpaAddress:'finance'+nonce+'@oksbi',holderName:'Finance Desk',bankName:'State Bank',accountType:'PERSONAL'},
    {vpaAddress:'counter'+nonce+'@ybl',holderName:'Counter Team',bankName:'Other Bank',accountType:'MERCHANT',mcc:'5411'}
  ]});
  assert.equal(r.status,201,'Bulk account import must accept validated UPI IDs');
  assert.equal(r.data.imported,2);
  r=await call('/api/merchant/vpas',alice);
  assert.equal(r.data.vpas.length,3);
  assert.equal(r.data.vpas.find(v=>v.holder_name==='Counter Team').mcc,'5411');
  r=await call('/api/merchant/vpas',bob);
  assert.equal(r.data.vpas.length,1,'Other merchant must not see imported VPAs');
  r=await call('/api/merchant/vpas/import',bob,'POST',{accounts:[
    {vpaAddress:'new'+nonce+'@oksbi',holderName:'Other Shop'},
    {vpaAddress:'finance'+nonce+'@oksbi',holderName:'Hijack Attempt'}
  ]});
  assert.equal(r.status,409,'Cross-tenant conflicts must reject the entire import');
  r=await call('/api/merchant/vpas',bob);
  assert.equal(r.data.vpas.length,1,'Rejected import must roll back all rows');
  r=await call('/api/merchant/vpas/import',alice,'POST',{accounts:[
    {vpaAddress:'broken',holderName:'Bad Account'}
  ]});
  assert.equal(r.status,400);
  const target=new URL(order.checkout_url,base);
  const token=target.searchParams.get('token');
  r=await call('/api/merchant/public/order/'+encodeURIComponent(order.id)+'?token='+encodeURIComponent(token));
  assert.equal(r.status,200);
  assert.equal(r.data.order.status,'PENDING');
  r=await call('/api/merchant/public/order/'+encodeURIComponent(order.id)+'?token=1234');
  assert.equal(r.status,401);
  r=await call('/api/merchant/payments',bob);
  assert.equal(r.data.orders.length,0,'Tenant B must not see tenant A payment');
  r=await call('/api/merchant/payments',alice);
  assert.equal(r.data.orders.length,2);
  assert.equal(r.data.orders[0].status,'PENDING');
  r=await call('/api/merchant/dashboard',alice);
  assert.equal(r.data.metrics.completedTransactions,0,'No fake settlement');
  assert.equal(r.data.metrics.pendingTransactions,2);
  assert.ok(Array.isArray(r.data.trend),'Dashboard must provide real daily volume series');
  assert.equal(r.data.trend.length,0,'No fake completed volume points');
  r=await call('/api/merchant/risk',alice);
  assert.equal(r.data.risk.open,2);
  r=await call('/api/merchant/ip-whitelist',alice,'POST',{ip_address:'192.0.2.10',description:'Office egress'});
  assert.equal(r.status,201);
  const ipId=r.data.id;
  r=await call('/api/merchant/ip-whitelist',bob);
  assert.equal(r.data.ips.length,0);
  r=await call('/api/merchant/ip-whitelist/'+ipId,bob,'DELETE');
  assert.equal(r.status,404);
  r=await call('/api/merchant/ip-whitelist/'+ipId,alice,'DELETE');
  assert.equal(r.status,200);
  r=await call('/api/merchant/reports?dateFilter=all&format=csv',alice);
  assert.equal(r.status,200);
  assert.ok(r.data.includes(order.id));
  r=await call('/api/merchant/notifications',alice);
  assert.ok(r.data.notifications.length>=2);
  r=await call('/api/merchant/notifications/read',alice,'POST',{});
  assert.equal(r.status,200);
  // Simulate a recorded provider-side session transition only within the
  // disposable CI database; no merchant can set SUCCESS through this API.
  await pg.query("UPDATE sessions SET status='SUCCESS',state='VERIFIED' WHERE order_id=$1",[order.id]);
  r=await call('/api/merchant/dashboard',alice);
  assert.equal(r.data.metrics.completedTransactions,1);
  assert.equal(r.data.metrics.totalVolume,500.01);
  assert.equal(r.data.trend.reduce((total,point)=>total+point.volume,0),500.01);
  r=await call('/api/merchant/public/order/'+encodeURIComponent(order.id)+'?token='+encodeURIComponent(token));
  assert.equal(r.data.order.status,'COMPLETED');
  console.log('Merchant integration: Clerk boundary, onboarding, VPA, payment QR, tenant isolation, metrics, risk, IP, CSV and state PASS');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pg.end();
 }
})().catch(error=>{console.error(error);process.exitCode=1});
