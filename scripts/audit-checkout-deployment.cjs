#!/usr/bin/env node
'use strict';
/* Ponytail read-only release audit: detect when Pages serves an older P2P
 * checkout while Railway serves new signed-payment code. No payment attempts.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const targets=Object.freeze([
 ['/api/runtime/checkout','public/checkout.html'],
 ['/api/runtime/merchant-checkout','public/merchant-checkout.html'],
 ['/api/runtime-assets/cosmic-checkout.js','public/cosmic-checkout.js'],
 ['/api/runtime-assets/cosmic-checkout-model.js','public/cosmic-checkout-model.js'],
 ['/api/runtime-assets/p2p-paymentrequest-probe.js','public/p2p-paymentrequest-probe.js'],
 ['/api/runtime-assets/one-touch-vault.js','public/one-touch-vault.js'],
 ['/api/runtime-assets/checkout-moonlight.css','public/checkout-moonlight.css'],
 ['/api/runtime-assets/disha-vault-3d.js','public/disha-vault-3d.js'],
 ['/api/runtime-assets/disha-vault-3d.css','public/disha-vault-3d.css'],
 ['/choose-payment','public/payment-modes.html'],
 ['/try-checkout.js','public/try-checkout.js'],
 ['/checkout','public/checkout.html'],
 ['/p2m/checkout','public/merchant-checkout.html']
]);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function check({base='https://disha8-2.thenitishkr.in',fetchImpl=fetch,read=filename=>fs.readFileSync(path.join(root,filename)),output=console.log}={}){
 const origin=new URL(base);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')
  throw Error('HTTPS_ORIGIN_ONLY');
 const results=[];
 for(const [url,file] of targets){
  let result;
  try{
   const response=await fetchImpl(new URL(url,origin),{
    method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('HTTP_'+response.status);
   const actual=Buffer.from(await response.arrayBuffer());
   const expected=Buffer.from(read(file));
   result={path:url,status:actual.equals(expected)?'MATCH':'STALE_CONTENT',
    sourceSha256:digest(expected).slice(0,16),
    liveSha256:digest(actual).slice(0,16),
    edge:response.headers?.get?.('x-disha-edge')||'not-reported'};
  }catch(e){result={path:url,status:'UNREACHABLE',reason:e?.message||String(e)}}
  results.push(result);
  output(JSON.stringify(result));
 }
 const failed=results.filter(r=>r.status!=='MATCH');
 output(JSON.stringify({passed:results.length-failed.length,failed:failed.length,
  verdict:failed.length?'FRONTEND_DEPLOYMENT_DRIFT':'CANONICAL_CHECKOUT_ASSETS_MATCH'}));
 return {passed:failed.length===0,results};
}
if(require.main===module){
 check({base:process.argv[2]||'https://disha8-2.thenitishkr.in'})
  .then(result=>{if(!result.passed)process.exitCode=1})
  .catch(e=>{console.error(e.message);process.exitCode=2});
}
module.exports={targets,digest,check};
