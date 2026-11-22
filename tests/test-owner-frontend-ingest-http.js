'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createPlatformControl}=require('../platform-control');
(async()=>{
 const saved=process.env.DISHA_INVITE_ONLY_ENABLED;
 process.env.DISHA_INVITE_ONLY_ENABLED='false';
 const statements=[];
 const db={pgPool:{query:async(sql,args=[])=>{
   statements.push({sql,args});
   return {rows:[],rowCount:1};
 }}};
 const app=express();
 app.use(express.json({limit:'10kb'}));
 const control=createPlatformControl({db,getAuth:()=>({userId:null}),clerkEmailResolver:async()=>null});
 let server;
 try{
  await control.init();
  app.use('/api/platform',control.router);
  server=await new Promise(resolve=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));
  });
  const base='http://127.0.0.1:'+server.address().port;
  const headers={'Content-Type':'application/json','Origin':'https://disha8-2.thenitishkr.in','Sec-Fetch-Site':'same-origin'};
  const request=(body,customHeaders={})=>fetch(base+'/api/platform/public/frontend-error',{
    method:'POST',headers:{...headers,...customHeaders},body:JSON.stringify(body)
  });
  const privacy={category:'JS_ERROR',page:'/owner',component:'OWNER',message:'UPI_123@private',stack:'secret PIN not allowed',token:'token-should-not-be-stored'};
  const success=await request(privacy);
  assert.equal(success.status,202);
  assert.equal((await success.json()).recorded,true);
  assert.ok(statements.some(x=>x.sql.includes('INSERT INTO disha_frontend_error_events')),'First-party event row must be stored');
  assert.ok(statements.some(x=>x.sql.includes("INSERT INTO disha_platform_incidents")),'Incident dedup insert must be attempted');
  for(const row of statements)for(const item of row.args){
   assert.ok(!String(item).includes('UPI_123@private'),'Sensitive client message must not be stored');
   assert.ok(!String(item).includes('secret PIN'),'Sensitive client stack must not be stored');
   assert.ok(!String(item).includes('token-should-not-be-stored'),'Client-provided token must not be stored');
  }
  assert.equal((await request({category:'FRAUD_VERIFIED',page:'/owner',component:'OWNER'})).status,400,'Untrusted clients cannot invent financial incident classes');
  assert.equal((await request({category:'JS_ERROR',page:'/owner?orderId=secret',component:'OWNER'})).status,400,'Raw query-string paths are forbidden');
  assert.equal((await request({category:'RESOURCE_ERROR',page:'/owner',component:'OWNER'},
   {'Origin':'https://untrusted.example'})).status,403,'Cross-site reports must be rejected');
  assert.equal((await request({category:'RESOURCE_ERROR',page:'/owner',component:'OWNER'},
   {'Sec-Fetch-Site':'cross-site'})).status,403,'Cross-site fetch metadata must be checked');
  const valid={category:'UNHANDLED_REJECTION',page:'/dashboard',component:'MERCHANT'};
  const codes=[];
  for(let i=0;i<12;i++)codes.push((await request(valid)).status);
  assert.ok(codes.includes(429),'Anonymous telemetry ingest must be rate limited');
  assert.equal(codes.filter(x=>x===202).length,11);
  assert.ok(statements.filter(x=>x.sql.includes('INSERT INTO disha_platform_incidents')).length===12,
    'Bounded successful reports should produce bounded deduplicated warning inserts');
  console.log('OWNER_FRONTEND_INGEST_HTTP_PASS: privacy, client classification, same-origin, rate limit and WARNING only');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(saved===undefined)delete process.env.DISHA_INVITE_ONLY_ENABLED;
  else process.env.DISHA_INVITE_ONLY_ENABLED=saved;
 }
})().catch(e=>{console.error(e);process.exitCode=1});
