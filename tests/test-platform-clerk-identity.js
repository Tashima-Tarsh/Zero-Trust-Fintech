'use strict';
const assert=require('node:assert/strict');
const {getClerkVerifiedEmail}=require('../utils/platform-clerk-identity');
(async()=>{
 const oldFetch=global.fetch,oldSecret=process.env.CLERK_SECRET_KEY;
 try{
  process.env.CLERK_SECRET_KEY='sk_test_only_ci';
  global.fetch=async()=>({ok:true,status:200,json:async()=>({
   primary_email_address_id:'e_primary',email_addresses:[
    {id:'e_primary',email_address:'OWNER@EXAMPLE.TEST',verification:{status:'verified'}}
   ]
  })});
  assert.equal(await getClerkVerifiedEmail('user_123abc'),'owner@example.test');
  for(const code of [401,403,429,500,503]){
   global.fetch=async()=>({ok:false,status:code,json:async()=>({})});
   await assert.rejects(getClerkVerifiedEmail('user_123abc'),
    e=>e.code==='CLERK_IDENTITY_UNAVAILABLE'&&e.status===503);
  }
  global.fetch=async()=>{throw Error('network unreachable')};
  await assert.rejects(getClerkVerifiedEmail('user_123abc'),
   e=>e.status===503&&e.code==='CLERK_IDENTITY_UNAVAILABLE');
  global.fetch=async()=>({ok:true,status:200,json:async()=>({
   primary_email_address_id:'e_primary',
   email_addresses:[{id:'e_primary',email_address:'owner@example.test',verification:{status:'pending'}}]
  })});
  assert.equal(await getClerkVerifiedEmail('user_123abc'),null,
   'A pending email verification must never grant platform-owner access');
  assert.equal(await getClerkVerifiedEmail('bad_id'),null);
  console.log('CLERK_IDENTITY_RESILIENCE_PASS: verified primary email only; upstream failures classified as 503');
 }finally{
  global.fetch=oldFetch;
  if(oldSecret===undefined)delete process.env.CLERK_SECRET_KEY;else process.env.CLERK_SECRET_KEY=oldSecret;
 }
})().catch(error=>{console.error(error);process.exitCode=1});
