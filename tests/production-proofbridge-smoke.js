'use strict';
/*
 * Read-only-live + one unpaid session smoke test for DISHA ProofBridge.
 * No UPI app, PIN, money transfer, issuer secrets or settlement mutation.
 * Test creates one PENDING checkout order in production (it expires naturally).
 */
const assert=require('node:assert/strict');
const base=(process.env.DISHA_SMOKE_URL||'https://disha8-2.thenitishkr.in').replace(/\/+$/,'');
const request=async(route,options={})=>{
 const response=await fetch(base+route,{...options,redirect:'error',signal:AbortSignal.timeout(18000),
  headers:{'Cache-Control':'no-store',...(options.headers||{})}});
 const text=await response.text();
 let json;try{json=JSON.parse(text)}catch{json=null}
 return {status:response.status,ok:response.ok,json,text};
};
const fail=(stage,r)=>{
 throw new Error(stage+' HTTP_'+r.status+' '+String(r.json?.error||'Unexpected response').slice(0,100));
};
(async()=>{
 const health=await request('/health');
 if(!health.ok)fail('HEALTH',health);
 console.log('LIVE_HEALTH_OK');

 const checkout=await request('/checkout?amount=1&proofbridge=1');
 if(!checkout.ok||!checkout.text.includes('id="proofbridgeConsent"'))fail('CHECKOUT_HTML',checkout);
 console.log('LIVE_CHECKOUT_CONSENT_HTML_OK');

 const script=await request('/api/runtime-assets/cosmic-checkout.js');
 if(!script.ok||!script.text.includes('p2pCopyOnly=proofbridgeEnabled&&model.isPersonalPayment(session.upiUri)')||
    !script.text.includes('container.replaceChildren();qrUri=null;'))
    throw new Error('P2P_NO_QR_FRONTEND_NOT_DEPLOYED');
 console.log('LIVE_P2P_QR_HIDDEN_BUNDLE_OK');

 const created=await request('/api/session/new?amount=1&description=ProofBridge+no-money+smoke');
 if(!created.ok)fail('CREATE_PENDING_TEST_SESSION',created);
 const a=created.json;
 assert.equal(a?.success,true);
 assert.equal(a?.paymentType,'P2P','Configured owner receiver must be personal P2P');
 assert.match(a?.sessionId||'',/^[a-f0-9]{24,64}$/i);
 assert.match(a?.orderId||'',/^[a-z0-9_-]{6,150}$/i);
 assert.match(a?.vpaAddress||'',/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/);
 const qr=new URL(a.upiLink);
 assert.equal(qr.protocol,'upi:');
 assert.equal(qr.hostname,'pay');
 assert.equal(qr.searchParams.get('pa').toLowerCase(),a.vpaAddress.toLowerCase());
 assert.equal(qr.searchParams.get('mc'),null);
 assert.equal(qr.searchParams.get('tr'),null);
 // UPI ID is the only receiving-account identity; token is never printed.
 console.log('LIVE_P2P_RECEIVER='+a.vpaAddress.toLowerCase());
 console.log('LIVE_P2P_SESSION_CREATED_UNPAID');

 const consent=await request('/api/proofbridge/authorize',{
  method:'POST',
  headers:{'Content-Type':'application/json','X-CSRF-Token':a.sessionId},
  body:JSON.stringify({orderId:a.orderId,token:a.sessionId,consent:true})
 });
 if(!consent.ok)fail('CONSENT',consent);
 const p=consent.json;
 assert.equal(p?.success,true);
 assert.equal(p.orderId,a.orderId);
 assert.equal(p.upiUri,a.upiLink);
 assert.equal(p.ticket?.protocol,'DISHA-PROOF-TICKET-V2');
 assert.equal(p.ticket?.paymentType,'P2P');
 assert.equal(p.ticket?.payeeVpa,a.vpaAddress.toLowerCase());
 assert.equal(p.ticket?.merchantCategory,'');
 assert.equal(p.ticket?.merchantReference,'');
 assert.match(p.ticketSignature||'',/^[0-9a-f]{64}$/i);
 assert.equal(p.paymentState,'PENDING_VERIFICATION');
 console.log('LIVE_SIGNED_P2P_CONSENT_TICKET_OK');

 const status=await request('/api/proofbridge/status/'+encodeURIComponent(a.orderId)+'?token='+encodeURIComponent(a.sessionId));
 if(!status.ok)fail('STATUS',status);
 assert.equal(status.json?.consented,true);
 assert.equal(status.json?.evidenceState,'AWAITING_EVIDENCE');
 assert.equal(status.json?.paymentVerified,false);
 assert.equal(status.json?.utrCandidate,null);
 console.log('LIVE_NO_FALSE_UTR_NO_FALSE_CREDIT_OK');
 console.log('PRODUCTION_PROOFBRIDGE_SMOKE_PASS');
})().catch(e=>{console.error('PRODUCTION_PROOFBRIDGE_SMOKE_FAIL '+e.message);process.exitCode=1});
