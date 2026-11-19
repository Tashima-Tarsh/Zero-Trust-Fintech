'use strict';
/* DISHA edge checkout isolation regression.
 * /checkout and /checkout/ must be served from a static Pages asset even
 * when Railway is offline; dynamic merchant order API still needs Railway.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const worker=fs.readFileSync(path.join(root,'_worker.js'),'utf8');
const routes=JSON.parse(fs.readFileSync(path.join(root,'_routes.json'),'utf8'));
const checkout=fs.readFileSync(path.join(root,'checkout.html'),'utf8');

const checkoutAssets=['checkout.html','merchant-checkout.html','cosmic-checkout.css','cosmic-checkout.js','cosmic-checkout-model.js','one-touch-vault.js','assets/upi-googlepay.svg','assets/upi-phonepe.svg','assets/upi-paytm.svg'];
for(const name of checkoutAssets){
 const canonical=fs.readFileSync(path.join(root,name));
 for(const dir of ['dist','disha-cinematic/public','disha-cinematic/dist']){
   const file=path.join(__dirname,'..',dir,name);
   assert.ok(fs.existsSync(file),'Checkout asset missing from '+dir+': '+name);
   assert.ok(fs.readFileSync(file).equals(canonical),'Stale checkout asset in '+dir+': '+name);
 }
}

assert.ok(checkout.length>1000,'Static checkout HTML must be present');
assert.ok(fs.existsSync(path.join(root,'cosmic-checkout.js')),'Checkout script must be present');
assert.ok(!routes.include.includes('/checkout'),'Checkout must be local to Cloudflare and not forced to Railway');
for(const p of ['/owner','/request-access','/dashboard','/api/*']){
 assert.ok(routes.include.includes(p),'Protected proxy route missing '+p);
}
for(const p of ['/checkout','/checkout/','/pay','/pay/']){
 assert.ok(worker.includes(p),'Static checkout mapping missing '+p);
}
const context={URL,Request,Response,Headers,console,fetch:async()=>{throw Error('SIMULATED_RAILWAY_502')}};
vm.createContext(context);
vm.runInContext(worker.replace('export default','globalThis.edge ='),context,{filename:'_worker.js'});
(async()=>{
 let upstream=0,assets=0;
 context.fetch=async()=>{upstream++;return new Response('Bad Gateway',{status:502})};
 const env={ASSETS:{fetch:async request=>{assets++;const u=new URL(request.url);
  assert.ok(['/checkout.html','/merchant-checkout.html','/cosmic-checkout.js','/cosmic-checkout-model.js',
   '/cosmic-checkout.css','/checkout-moonlight.css'].includes(u.pathname),'Allowed Pages asset '+u.pathname);
  const body=u.pathname.endsWith('.js')?'// DISHA static checkout JS':checkout;
  return new Response(body,{status:200,headers:{'content-type':u.pathname.endsWith('.js')?'text/javascript':'text/html'}});
 }}};
 for(const route of ['/checkout','/checkout/','/pay','/pay/']){
  const res=await context.edge.fetch(new Request('https://disha8-2.thenitishkr.in'+route),env);
  assert.equal(res.status,200,route+' must remain static even if Railway is down');
  assert.match(await res.text(),/<html/i);
 }
 for(const url of [
  '/api/runtime/checkout?amount=1',
  '/api/runtime/merchant-checkout?paymentRef=PAY_EXAMPLE&token=aaa',
  '/api/runtime-assets/cosmic-checkout.js?v=ci',
  '/api/runtime-assets/cosmic-checkout-model.js',
  '/api/runtime-assets/cosmic-checkout.css',
  '/api/runtime-assets/checkout-moonlight.css'
 ]){
  const result=await context.edge.fetch(new Request('https://disha8-2.thenitishkr.in'+url),env);
  assert.equal(result.status,200,'Static checkout asset failed '+url);
 }
 assert.equal(upstream,0,'Checkout HTML, CSS, and JS must work without Railway');
 assert.equal(assets,10);
 const api=await context.edge.fetch(new Request('https://disha8-2.thenitishkr.in/api/merchant/public/order/example'),env);
 assert.equal(api.status,502,'Dynamic merchant payment order depends on Railway backend');
 assert.equal(upstream,1);
 console.log('CHECKOUT_EDGE_ISOLATION_PASS: static checkout never relies on Railway availability; dynamic APIs proxy as expected');
})().catch(error=>{console.error(error);process.exitCode=1});
