'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {create}=require('../public/copy-return-observer');
test('copy → Android hidden → foreground invokes exactly one automatic session-bound evidence check',()=>{
 let now=1000;const events=[],observations=[];
 const session={orderId:'P2P_TEST_ORDER',token:'a'.repeat(48),expiresAt:91000};
 const observer=create({clock:()=>now,onState:e=>events.push(e),onObservation:s=>observations.push(s)});
 assert.equal(observer.markCopied(session),true);
 assert.equal(observer.foreground(),false,'focus without app background must not trigger evidence lookup');
 now=1600;assert.equal(observer.background(),true);
 now=2600;assert.equal(observer.foreground(),true);
 assert.deepEqual(events,['COPY_READY','BROWSER_HIDDEN','BROWSER_RETURN']);
 assert.equal(observations.length,1);assert.equal(observations[0],session);
 assert.equal(observer.foreground(),false,'duplicate pageshow and focus ignored');
 assert.deepEqual(observer.snapshot(),{state:'RETURN_OBSERVED',debitVerified:false,paymentVerified:false});
});
test('expired or overlong copy-to-UPI return cannot trigger server lookup',()=>{
 let now=1000;const received=[];
 const s={orderId:'P2P_EXP',token:'token',expiresAt:2000};
 const obs=create({clock:()=>now,onObservation:x=>received.push(x)});
 assert.equal(obs.markCopied(s),true);obs.background();now=2000;
 assert.equal(obs.foreground(),false);
 assert.equal(received.length,0);
 let time=1000;const slow=create({clock:()=>time,onObservation:x=>received.push(x)});
 assert.equal(slow.markCopied({...s,expiresAt:900000}),true);
 slow.background();time=200002;
 assert.equal(slow.foreground(),false);
 assert.equal(received.length,0);
});
test('copy and return mechanism is present in all deployed checkout mirrors',()=>{
 const root=path.resolve(__dirname,'..');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const diag=fs.readFileSync(path.join(root,'financial/checkout-diagnostics.js'),'utf8');
 assert.match(server,/'copy-return-observer\.js'/);
 assert.match(diag,/'COPY_READY'/);
 for(const p of ['public','dist','disha-cinematic/public','disha-cinematic/dist']){
  const html=fs.readFileSync(path.join(root,p,'checkout.html'),'utf8');
  const script=fs.readFileSync(path.join(root,p,'cosmic-checkout.js'),'utf8');
  assert.match(html,/runtime-assets\/copy-return-observer\.js/);
  assert.match(script,/copyReturnObserver\?\.markCopied\(session\)/);
  assert.match(script,/copyReturnObserver\?\.background\(\)/);
  assert.match(script,/copyReturnObserver\?\.foreground\(\)/);
  assert.match(script,/\/api\/payer-debit-evidence\//);
  assert.doesNotMatch(script,/navigator\.serviceWorker\.getNotifications|readBankSms\(/);
 }
});
