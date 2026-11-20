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
   amount:'500.01',description:'Real request',orderId:'invoice-1',paymentMode:'P2P'});
  assert.equal(r.status,201);
  const order=r.data.order;
  assert.equal(order.amount,500.01);
  assert.equal(order.status,'PENDING');
  assert.ok(order.checkout_url.includes('/merchant-checkout.html?'));
  assert.equal(order.payment_type,'P2P','Personal receiving account remains P2P');
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
  // Snapshot contract: changing a VPA later must not mutate a customer's
  // already-issued payee identity or downgrade a P2P intent into P2M.
  let earlier=await call('/api/merchant/public/order/'+encodeURIComponent(order.id)+'?token='+encodeURIComponent(token));
  const initialUri=earlier.data.order.upi_uri;
  let initialParams=new URL(initialUri).searchParams;
  assert.equal(initialParams.get('pn'),'Acme Treasury','Personal UPI shows actual account holder');
  assert.equal(initialParams.get('mc'),null);
  assert.equal(initialParams.get('tr'),null);
  await pg.query("UPDATE saas_merchant_vpas SET account_type='MERCHANT',mcc='5411',holder_name='Renamed Payee' WHERE vpa_address=$1",
    ['acme'+nonce+'@oksbi']);
  earlier=await call('/api/merchant/public/order/'+encodeURIComponent(order.id)+'?token='+encodeURIComponent(token));
  assert.equal(earlier.status,200);
  assert.equal(earlier.data.order.upi_uri,initialUri,'Existing P2P payment must not mutate after VPA modification');
  await pg.query("UPDATE saas_merchant_vpas SET account_type='PERSONAL',mcc=NULL,holder_name='Acme Treasury' WHERE vpa_address=$1",
    ['acme'+nonce+'@oksbi']);


  // Regression: changing the existing primary receiving account from P2P to
  // bank-issued P2M via the merchant setup form must update the stored type/MCC.
  const upgradedSetup=await call('/api/merchant/setup',alice,'POST',{
    businessName:'Acme '+nonce,primaryVpa:'acme'+nonce+'@oksbi',
    primaryHolderName:'Acme Treasury',primaryBankName:'SBI',
    accountType:'MERCHANT',mcc:'5411'});
  assert.equal(upgradedSetup.status,200);
  const afterUpgrade=await call('/api/merchant/vpas',alice);
  const updatedPrimary=afterUpgrade.data.vpas.find(x=>x.vpa_address==='acme'+nonce+'@oksbi');
  assert.equal(updatedPrimary.account_type,'MERCHANT','Existing VPA must not silently remain P2P');
  assert.equal(updatedPrimary.mcc,'5411','Bank MCC must persist on existing account');
  const upgradedPayment=await call('/api/merchant/payments',alice,'POST',{
    amount:'1.00',vpaAddress:'acme'+nonce+'@oksbi',description:'Merchant classification test'});
  assert.equal(upgradedPayment.status,201);
  const upgradedParams=new URL(upgradedPayment.data.order.upi_uri_dynamic).searchParams;
  assert.equal(upgradedParams.get('mc'),'5411');
  assert.match(upgradedParams.get('tr'),/^SRV[A-F0-9]{24}$/);
  const newToken=new URL(upgradedPayment.data.order.checkout_url,base).searchParams.get('token');
  const reloadedUpgrade=await call('/api/merchant/public/payment/'+encodeURIComponent(upgradedPayment.data.order.id)+
    '?token='+encodeURIComponent(newToken));
  assert.equal(reloadedUpgrade.data.order.payment_type,'P2M');
  assert.equal(reloadedUpgrade.data.order.upi_uri,upgradedPayment.data.order.upi_uri_dynamic);

  // Restoring a personal account changes future requests only, never a
  // previously issued P2M link or an earlier P2P link.
  const restoredSetup=await call('/api/merchant/setup',alice,'POST',{
    businessName:'Acme '+nonce,primaryVpa:'acme'+nonce+'@oksbi',
    primaryHolderName:'Acme Treasury',primaryBankName:'SBI',
    accountType:'PERSONAL',mcc:''});
  assert.equal(restoredSetup.status,200);
  const upgradedAfterRestore=await call('/api/merchant/public/payment/'+encodeURIComponent(upgradedPayment.data.order.id)+
    '?token='+encodeURIComponent(newToken));
  assert.equal(upgradedAfterRestore.data.order.upi_uri,upgradedPayment.data.order.upi_uri_dynamic);
  const originalAfterRestore=await call('/api/merchant/public/order/'+encodeURIComponent(order.id)+
    '?token='+encodeURIComponent(token));
  assert.equal(originalAfterRestore.data.order.upi_uri,initialUri);


  // Selected merchant lane must reject a personal VPA or implicit account rotation.
  let mismatched=await call('/api/merchant/payments',alice,'POST',{
   amount:'1.00',paymentMode:'P2M',vpaAddress:'finance'+nonce+'@oksbi'});
  assert.equal(mismatched.status,409,'P2M personal VPA must fail closed');
  mismatched=await call('/api/merchant/payments',alice,'POST',{
   amount:'1.00',paymentMode:'P2M'});
  assert.equal(mismatched.status,409,'P2M requires explicit merchant VPA');


  const merchantVpa='counter'+nonce+'@ybl';
  let p2m=await call('/api/merchant/payments',alice,'POST',{
    amount:'1.00',paymentMode:'P2M',vpaAddress:merchantVpa,description:'Company receipt'});
  assert.equal(p2m.status,201,'Validated P2M receiving VPA creates a merchant payment');
  const p2mLink=new URL(p2m.data.order.checkout_url,base);
  assert.equal(p2mLink.pathname,'/p2m/checkout','P2M receives distinct merchant checkout');
  assert.equal(p2m.data.order.payment_type,'P2M');
  const p2mParams=new URL(p2m.data.order.upi_uri_dynamic).searchParams;
  assert.equal(p2mParams.get('pa'),merchantVpa);
  assert.equal(p2mParams.get('mc'),'5411');
  assert.match(p2mParams.get('tr'),/^SRV[A-F0-9]{24}$/,'Merchant payment uses a payment reference, never a public order identifier');
  assert.equal(p2mParams.get('tn'),'Company receipt','Purpose is preserved without payment record metadata');
  assert.equal(p2mParams.get('pn'),'Counter Team','P2M uses the saved receiving-account holder, not unrelated business branding');
  const recorded=await pg.query('SELECT payee_name,payee_account_type,payee_mcc FROM saas_merchant_orders WHERE id=$1',
    [p2m.data.order.id]);
  assert.equal(recorded.rows[0].payee_account_type,'MERCHANT');
  assert.equal(recorded.rows[0].payee_mcc,'5411');
  const backendRef=await pg.query('SELECT txn_ref FROM sessions WHERE order_id=$1',[p2m.data.order.id]);
  assert.equal(p2mParams.get('tr'),backendRef.rows[0].txn_ref,
   'Bank-visible merchant reference must be byte-for-byte identical to stored transaction reference');
  const reloadedP2m=await call('/api/merchant/public/order/'+encodeURIComponent(p2m.data.order.id)+
   '?token='+encodeURIComponent(p2mLink.searchParams.get('token')));
  assert.equal(reloadedP2m.status,200);
  assert.equal(new URL(reloadedP2m.data.order.upi_uri).searchParams.get('tr'),backendRef.rows[0].txn_ref,
   'Refreshing a payment must not switch UPI transaction reference');
  await pg.query("UPDATE saas_merchant_vpas SET account_type='PERSONAL',mcc=NULL,holder_name='Modified Payee' WHERE vpa_address=$1",[merchantVpa]);
  const p2mFetched=await call('/api/merchant/public/order/'+encodeURIComponent(p2m.data.order.id)+'?token='+encodeURIComponent(p2mLink.searchParams.get('token')));
  assert.equal(p2mFetched.status,200);
  assert.equal(p2mFetched.data.order.upi_uri,p2m.data.order.upi_uri_dynamic,'P2M MCC and payee must not change on account edits');
  await pg.query("UPDATE saas_merchant_vpas SET account_type='MERCHANT',mcc=NULL WHERE vpa_address=$1",[merchantVpa]);
  const beforeInvalid=(await pg.query('SELECT count(*)::int AS n FROM saas_merchant_orders WHERE merchant_id=$1',
    [result.data.merchant.id])).rows[0].n;
  const invalid=await call('/api/merchant/payments',alice,'POST',{
    amount:'1.00',vpaAddress:merchantVpa,description:'Invalid merchant category'});
  assert.equal(invalid.status,409,'Invalid MCC must reject P2M before creating a payment session');
  const afterInvalid=(await pg.query('SELECT count(*)::int AS n FROM saas_merchant_orders WHERE merchant_id=$1',
    [result.data.merchant.id])).rows[0].n;
  assert.equal(afterInvalid,beforeInvalid,'Invalid merchant intent must not persist an order');
  await pg.query("UPDATE saas_merchant_vpas SET account_type='MERCHANT',mcc='5411' WHERE vpa_address=$1",[merchantVpa]);
  console.log('Merchant payment snapshot: immutable P2P/P2M payee identity, MCC, transaction reference and invalid-category fail-closed PASS');
  console.log('Merchant integration: Clerk boundary, onboarding, VPA, payment QR, tenant isolation, metrics, risk, IP, CSV and state PASS');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pg.end();
 }
})().catch(error=>{console.error(error);process.exitCode=1});
