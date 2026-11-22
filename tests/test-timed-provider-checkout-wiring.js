'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const copies=['public/cosmic-checkout.js','dist/cosmic-checkout.js',
 'disha-cinematic/public/cosmic-checkout.js','disha-cinematic/dist/cosmic-checkout.js'];
test('all checkout mirrors use identical authenticated timed provider wiring',()=>{
 const contents=copies.map(p=>fs.readFileSync(path.join(root,p),'utf8'));
 contents.forEach(c=>assert.equal(c,contents[0]));
 for(const code of contents){
  const auth=code.indexOf('p2pTrustedUntil=verdict.expiresAt;');
  const auto=code.indexOf("if(query.get('paymentrequest')!=='1'){",auth);
  const challenge=code.indexOf("if(typeof capabilityButton?.click==='function')capabilityButton.click();",auto);
  assert.ok(auth>=0&&auto>auth&&challenge>auto);
  assert.match(code,/if\(payLaunch\)payLaunch\.disabled=true;/);
  assert.match(code,/prepareTimed:async\(\)=>\{/);
  assert.match(code,/api\/upi-app-evidence\/timed\/prepare/);
  assert.match(code,/api\/upi-app-evidence\/timed\/accept/);
  assert.match(code,/result\.signatureVerified===true&&result\.providerReportedSuccess===true/);
  assert.match(code,/bank debit not independently verified/);
 }
});
test('visible signed provider choice follows mandatory payer authentication',()=>{
 const html=fs.readFileSync(path.join(root,'public/checkout.html'),'utf8');
 const auth=html.indexOf('id="p2pPrepaymentGate"');
 const pay=html.indexOf('id="p2pPaymentRequestProbe"');
 const legacy=html.indexOf('id="vaultProceed"');
 assert.ok(auth>=0&&pay>auth&&legacy>pay,
  'Customer Pay button should follow device authentication, before legacy fallback controls');
 const code=fs.readFileSync(path.join(root,'public/p2p-paymentrequest-probe.js'),'utf8');
 assert.match(code,/Pay securely with Google Pay/);
 assert.match(code,/probe.hidden=false/);
 assert.match(code,/probe.hidden=available/);
});
test('signed response flow is default on P2P and Chrome pay still requires gesture',()=>{
 const code=fs.readFileSync(path.join(root,'public/p2p-paymentrequest-probe.js'),'utf8');
 assert.match(code,/query\.get\('paymentrequest'\)!=='1'/);
 assert.match(code,/launch\.addEventListener\('click',async\(\)=>\{/);
 assert.match(code,/response=await request\.show\(\)/);
 assert.match(code,/if\(env\.isAuthorized\?\.\(\)!==true\)/);
 assert.match(code,/Date\.now\(\)>=timedExpiresAt/);
 assert.match(code,/Recheck Google Pay availability/);
 assert.match(code,/Pay with Google Pay/);
 const server=fs.readFileSync(path.join(root,'financial/timed-payment-bridge.js'),'utf8');
 assert.match(server,/crypto\.randomBytes\(16\)\.toString\('hex'\)/);
 assert.match(server,/Math\.min\(Number\(info\.session\.expiresAt\),clock\(\)\+TTL_MS\)/);
 assert.match(server,/verifyUPIResponse/);
 assert.match(server,/debitVerified:false,paymentVerified:false/);
});
test('signed return UI stays isolated from the merchant checkout',()=>{
 const code=fs.readFileSync(path.join(root,'public/cosmic-checkout.js'),'utf8');
 assert.match(code,/if\(mode==='generic'\)/);
 const merchant=fs.readFileSync(path.join(root,'public/merchant-checkout.html'),'utf8');
 assert.doesNotMatch(merchant,/p2pPaymentRequestLaunch|timedprovider=1/);
});
