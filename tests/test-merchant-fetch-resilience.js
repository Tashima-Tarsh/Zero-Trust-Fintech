'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
const source=read('public/premium-dashboard.js');
const from=source.indexOf('async function api(path,options={}){');
const to=source.indexOf('\nfunction view(',from);
assert.ok(from>=0&&to>from,'Merchant client must expose an API wrapper');
assert.match(source,/MERCHANT_APPROVAL_PENDING/);
assert.match(source,/ownerCandidate/);
assert.match(source,/Merchant access denied:/);
const platform=read('public/platform-console.js');
assert.match(platform,/PLATFORM_API_NETWORK_FAILURE/);
const owner=read('platform-control.js');
assert.match(owner,/OWNER_PRIMARY_EMAIL_NOT_VERIFIED/);
async function call(fetcher,options){
 const env={authHeaders:async()=>({Authorization:'Bearer CI_TOKEN'}),
  fetch:fetcher,setTimeout:fn=>fn(),Promise,Error,String};
 vm.createContext(env);
 vm.runInContext(source.slice(from,to)+'\nthis.api=api;',env);
 return env.api('/api/auth/me',options||{});
}
const ok=()=>({ok:true,status:200,json:async()=>({success:true})});
(async()=>{
 let count=0;
 const result=await call(async()=>{
  count++;return count===1?{ok:false,status:502,json:async()=>({error:'Bad Gateway'})}:ok()
 });
 assert.equal(result.success,true);assert.equal(count,2,'GET may retry 502 once');
 count=0;
 await assert.rejects(call(async()=>{
  count++;return {ok:false,status:403,json:async()=>({
   error:'Awaiting approval',code:'MERCHANT_APPROVAL_PENDING'})}
 }),e=>e.status===403&&e.code==='MERCHANT_APPROVAL_PENDING');
 assert.equal(count,1,'403 must not retry or bypass approval');
 count=0;
 await assert.rejects(call(async()=>{
  count++;return {ok:false,status:502,json:async()=>({error:'Bad Gateway'})}
 },{method:'POST',body:'{}'}),e=>e.status===502);
 assert.equal(count,1,'Never retry state-changing requests');
 count=0;
 await assert.rejects(call(async()=>{count++;throw Error('offline')},{method:'POST',body:'{}'}),
  e=>e.code==='MERCHANT_API_NETWORK_FAILURE');
 assert.equal(count,1);
 console.log('MERCHANT_FETCH_RESILIENCE_PASS: GET-only gateway retry, correct approval errors, no replay of writes');
})().catch(e=>{console.error(e);process.exitCode=1});