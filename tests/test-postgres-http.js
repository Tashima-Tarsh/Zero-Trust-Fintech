'use strict';
/** Local PostgreSQL CI only: start actual Express/WS server in PG authority mode. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');

(async()=>{
 const dburl=process.env.TEST_DATABASE_URL;
 if(!dburl||!['localhost','127.0.0.1','::1'].includes(new URL(dburl).hostname))throw Error('Local disposable PG only');
 const port=24000+crypto.randomInt(10000);
 const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,PORT:String(port),DB_BACKEND:'postgres',DATABASE_URL:dburl,
   MERCHANT_UPI_ID:'testing@upi',NODE_ENV:'test',APP_URL:base,WEBAUTHN_RP_ORIGIN:base},
  stdio:['ignore','pipe','pipe']
 });
 let logs='';
 child.stdout.on('data',b=>logs+=b.toString());
 child.stderr.on('data',b=>logs+=b.toString());
 try{
  let ready=false;
  for(let i=0;i<50;i++){
   if(child.exitCode!==null)throw Error('Server exited before startup: '+logs.slice(-1800));
   try {
    const r=await fetch(base+'/health',{signal:AbortSignal.timeout(300)});
    if(r.ok){ready=true;break;}
   }catch(_){}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'PostgreSQL server did not become healthy: '+logs.slice(-1800));
  const checkout=await fetch(base+'/checkout/');
  assert.equal(checkout.status,200);
  assert.match(await checkout.text(),/DISHA/i);
  const newSession=await fetch(base+'/api/session/new?amount=500.01&vpa=disha82@okaxis');
  assert.equal(newSession.status,200,await newSession.text().catch(()=>'')); 
  const data=await newSession.json();
  assert.equal(data.success,true);
  assert.ok(data.sessionId&&data.orderId);
  const valid=await fetch(base+'/api/session/'+encodeURIComponent(data.orderId)+'?token='+encodeURIComponent(data.sessionId));
  assert.equal(valid.status,200);
  assert.equal((await valid.json()).session.orderId,data.orderId);
  const forbidden=await fetch(base+'/api/session/'+encodeURIComponent(data.orderId));
  assert.equal(forbidden.status,401);
  const orderState=await fetch(base+'/api/order-state/'+encodeURIComponent(data.orderId));
  assert.equal(orderState.status,200);
  console.log('PostgreSQL production path: HTTP checkout, session create, auth, polling PASS');
 }finally {
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,2500);}});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
