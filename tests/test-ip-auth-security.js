'use strict';
/* Deterministic security regression that does not assume hard-coded live keys,
 * a seeded customer database, or spoofable X-Forwarded-For headers. */
const assert=require('node:assert/strict');
const {IPWhitelistMiddleware}=require('../middleware/ip-whitelist');
const {getClientIP,isIPInCIDR}=require('../utils/ip-utils');
const req={headers:{'x-forwarded-for':'185.220.101.5','x-api-key':'test-secret'},socket:{remoteAddress:'127.0.0.1'},ip:'127.0.0.1',app:{get:()=>false},baseUrl:'/api/gaming',path:'/verify-payment'};
assert.equal(getClientIP(req),'127.0.0.1','Do not trust forged client IP from headers when proxy trust disabled');
assert.ok(isIPInCIDR('52.84.123.45','52.84.0.0/16'));
assert.ok(!isIPInCIDR('185.220.101.5','52.84.0.0/16'));
async function check(headers,allowed){
 const mw=new IPWhitelistMiddleware(null);
 mw.getCompanyByAPIKey=async key=>key==='test-secret'?{id:'tenant_test',status:'ACTIVE'}:null;
 mw.isIPWhitelisted=async()=>allowed;
 mw.logBlockedAttempt=async()=>{};
 mw.checkBruteForce=async()=>1;
 mw.updateIPUsage=async()=>{};
 mw.logAccess=async()=>{};
 let status=null,payload=null,next=false;
 const res={status(n){status=n;return this},json(v){payload=v;return this}};
 await mw.check()({...req,headers},res,()=>{next=true});
 return {status,payload,next};
}
(async()=>{
 const absent=await check({},false);
 assert.equal(absent.status,401);assert.equal(absent.payload.error,'MISSING_API_KEY');
 const invalid=await check({'x-api-key':'wrong'},false);
 assert.equal(invalid.status,401);assert.equal(invalid.payload.error,'INVALID_API_KEY');
 const blocked=await check({'x-api-key':'test-secret','x-forwarded-for':'52.84.123.45'},false);
 assert.equal(blocked.status,403);assert.equal(blocked.payload.error,'IP_NOT_WHITELISTED');assert.equal(blocked.payload.your_ip,'127.0.0.1');
 const accepted=await check({'x-api-key':'test-secret','x-forwarded-for':'185.220.101.5'},true);
 assert.equal(accepted.next,true);assert.equal(accepted.status,null);
 console.log('IP_AUTH_SECURITY_PASS: missing/invalid key denied, forged IP ignored, CIDR checked, unauthorized 403');
})().catch(e=>{console.error(e);process.exitCode=1});
