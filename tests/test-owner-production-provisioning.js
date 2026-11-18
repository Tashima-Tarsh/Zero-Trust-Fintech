'use strict';
const assert=require('node:assert/strict');
const {createPlatformControl}=require('../platform-control');
(async()=>{
 const keys=['DISHA_INVITE_ONLY_ENABLED','DISHA_OWNER_CLERK_USER_ID','DISHA_OWNER_EMAIL','DISHA_OWNER_DISPLAY_NAME','DISHA_OWNER_PHONE','DISHA_OWNER_BUSINESS','DISHA_OWNER_TITLE','DISHA_OWNER_P2P_VPAS','DISHA_COMPANY_BUSINESS','DISHA_COMPANY_P2M_VPA','DISHA_COMPANY_MCC'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.DISHA_INVITE_ONLY_ENABLED='true';
  delete process.env.DISHA_OWNER_CLERK_USER_ID;
  process.env.DISHA_OWNER_EMAIL='owner@example.test';
  process.env.DISHA_OWNER_DISPLAY_NAME='Test Owner';
  process.env.DISHA_OWNER_PHONE='0000000000';
  process.env.DISHA_OWNER_BUSINESS='Test Personal Merchant';
  process.env.DISHA_OWNER_TITLE='Architect';
  process.env.DISHA_OWNER_P2P_VPAS='testowner@upi,secondowner@upi';
  process.env.DISHA_COMPANY_BUSINESS='Example Company';
  process.env.DISHA_COMPANY_P2M_VPA='examplecompany@upi';
  process.env.DISHA_COMPANY_MCC='4705';
  const statements=[];
  const pool={query:async(sql,args=[])=>{
    statements.push({sql,args});
    return {rows:sql.includes('SELECT * FROM saas_merchants WHERE id=')?[{id:'test_owner_tenant',is_internal_test:true}]:[],rowCount:1};
   }};
  const db={pgPool:null};
  const api=createPlatformControl({db,getAuth:()=>({userId:'user_test'}),clerkEmailResolver:async id=>id==='user_test'?'owner@example.test':'other@example.test'});
  db.pgPool=pool;
  await api.init();
  assert.ok(statements.some(x=>x.sql.includes('CREATE TABLE IF NOT EXISTS disha_owner_profile')),'Owner profile must have schema');
  assert.ok(statements.some(x=>x.sql.includes('INSERT INTO disha_owner_profile')),'Owner business profile must be stored');
  assert.ok(statements.some(x=>x.sql.includes("saas_merchant_vpas")&&x.args.includes('testowner@upi')),'Primary P2P must be provisioned');
  assert.ok(statements.some(x=>x.sql.includes("saas_merchant_vpas")&&x.args.includes('secondowner@upi')),'Secondary P2P must be provisioned');
  assert.ok(statements.some(x=>x.sql.includes("saas_merchant_vpas")&&x.args.includes('examplecompany@upi')&&x.sql.includes("'PAUSED'")),'P2M must be separate and paused');
  assert.ok(statements.some(x=>x.sql.includes("VALUES($1,NULL,$2,'',FALSE,'PENDING',FALSE")),'Company must be a separate pending tenant');
  assert.ok(statements.every(x=>!/^\s*(DELETE|TRUNCATE|DROP)\b/i.test(x.sql)),'Provisioning must never delete financial history');
  const tenant=await api.verifyMerchant('user_test',{});
  assert.ok(tenant.is_internal_test,'Verified owner must receive isolated test tenant');
  assert.ok(statements.some(x=>x.sql.includes('ON CONFLICT(id) DO UPDATE')),'Owner bootstrap must be idempotent');
  console.log('OWNER_PROVISION_PASS: verified owner, personal P2P, isolated paused company P2M, no destructive queries');
 }finally{
  for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
