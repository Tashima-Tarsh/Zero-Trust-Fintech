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
 assert.match(page,/Quantum Fusion/);
 assert.match(page,/data-payment-mode="P2P"/);
 assert.match(page,/data-payment-mode="P2M"/);
 assert.doesNotMatch(page,/<form\\b|<input\\b|id="tryAmount"|id="tryVpa"/i);
 assert.match(page,/\/try-checkout\\.js\\?v=quantum-fusion-20261120/);
 const js=await get('/try-checkout.js?v=quantum-fusion-20261120');
 assert.match(js,/checkout\\.searchParams\\.set\\('proofbridge','1'\\)/);
 assert.match(js,/location\\.assign\\('\/login\\?mode=P2M'\\)/);
 assert.match(js,/if\\(mode==='P2M'\\)/);
 const checkout=await get('/p2p?proofbridge=1&amount=1');
 assert.match(checkout,/id="proofbridgeConsent"/);
 assert.match(checkout,/id="proofbridgeProceed"/);
 assert.match(checkout,/Quantum Fusion/);
 assert.match(checkout,/id="payerDebitEvidence"/);
 assert.match(checkout,/id="receiptUtr"/);
 const merchant=await get('/p2m');
 assert.match(merchant,/MERCHANT LANE/);
 console.log('LIVE_QUANTUM_FUSION_CHOOSER_PASS: no payer fields, P2P consent/Proceed, P2M separate; no money moved');
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
