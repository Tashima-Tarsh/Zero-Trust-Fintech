'use strict';
// Read-only production smoke: does not issue an order, copy funds or post evidence.
const assert=require('node:assert/strict');
const base=(process.env.DISHA_SMOKE_URL||'https://disha8-2.thenitishkr.in').replace(/\/+$/,'');
const get=async(path)=>{
 const r=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
 if(!r.ok)throw Error('HTTP '+r.status+' for '+path);
 return r.text();
};
const test=async()=>{
 const page=await get('/choose-payment?mode=P2P');
 assert.match(page,/id="tryCheckoutForm"/);
 assert.match(page,/id="tryVpaLabel"/);
 assert.match(page,/Continue to P2P consent/);
 assert.match(page,/\/try-checkout\.js\?v=proofbridge-selector-20261120/);
 const js=await get('/try-checkout.js?v=proofbridge-selector-20261120');
 assert.match(js,/checkout\.searchParams\.set\('proofbridge','1'\)/);
 assert.match(js,/if\(payee\)search\.set\('vpa',payee\)/);
 assert.match(js,/vpa\.required=merchant/);
 assert.doesNotMatch(js,/checkout\.searchParams\.set\('qs','1'\)/,
  'QS must not be applied universally to P2P');
 const checkout=await get('/p2p?proofbridge=1&amount=1');
 assert.match(checkout,/id="proofbridgeConsent"/);
 assert.match(checkout,/id="proofbridgeProceed"/);
 const merchant=await get('/p2m');
 assert.match(merchant,/MERCHANT LANE/);
 console.log('LIVE_PAYMENT_CHOOSER_PROOFBRIDGE_PASS: chooser -> P2P consent/proceed; P2M separate; no money moved');
};
(async()=>{
 let last;
 for(let attempt=1;attempt<=24;attempt++){
  try{await test();return}catch(e){
   last=e;
   console.log('Waiting for Cloudflare Pages/Railway release '+attempt+'/24: '+e.message.slice(0,150));
   if(attempt<24)await new Promise(resolve=>setTimeout(resolve,5000));
  }
 }
 throw last;
})().catch(err=>{console.error('LIVE_PAYMENT_CHOOSER_PROOFBRIDGE_FAIL '+err.message);process.exitCode=1});
