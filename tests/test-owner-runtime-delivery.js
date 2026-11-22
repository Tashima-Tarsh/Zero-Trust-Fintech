'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const server=read('server.js'),login=read('public/merchant-login.html');
const merchant=read('public/merchant-console.html'),owner=read('public/owner-console.html');
const clerk=read('public/premium-dashboard.js'),consoleJS=read('public/platform-console.js');
assert.match(server,/app\.get\('\/api\/runtime-assets\/:asset'/);
assert.match(server,/RUNTIME_ASSETS\.has\(asset\)/);
// Every checkout's first-party runtime dependency must be available from the
// same Railway build as the canonical HTML: no Cloudflare-only hidden scripts.
const assetSet=/const RUNTIME_ASSETS=new Set\(\[([\s\S]*?)\]\);/.exec(server);
assert.ok(assetSet,'Runtime asset allowlist declared');
for(const page of ['public/checkout.html','public/merchant-checkout.html']){
 const html=read(page);
 for(const [,asset] of html.matchAll(/\/api\/runtime-assets\/([A-Za-z0-9._-]+)/g)){
  assert.ok(assetSet[1].includes("'"+asset+"'"),
   'Railway missing checkout asset '+asset+' required by '+page);
 }
}

assert.match(server,/\['\/api\/runtime\/checkout','\/api\/runtime\/merchant-checkout'\]/);
assert.match(owner,/src="\/api\/runtime-assets\/platform-console\.js/);
assert.match(merchant,/src="\/api\/runtime-assets\/premium-dashboard\.js/);
for(const page of ['public/checkout.html','public/merchant-checkout.html']){
 const html=read(page);
 assert.match(html,/\/api\/runtime-assets\/cosmic-checkout\.js/);
 assert.match(html,/\/api\/runtime-assets\/one-touch-vault\.js/,
  'Quantum Signal opt-in must load the original Vault module');
 assert.match(html,/\/api\/runtime-assets\/quantum-signal-client\.js/);
}
assert.match(login,/Super Admin sign-in/);
assert.match(login,/const destination=ownerLogin\?'\/owner#requests':'\/dashboard'/);
assert.match(clerk,/Switch account/);
assert.doesNotMatch(clerk,/Owner access requires the verified primary Clerk email/,'Merchant 403 should not disclose owner email');
assert.match(owner,/id="owner-pending-count"/);
assert.match(consoleJS,/refreshOwnerInbox\(/);
assert.match(owner,/href="\/api\/runtime\/checkout\?amount=1&amp;debug=1"|href="\/api\/runtime\/checkout\?amount=1&debug=1"/);
const merchantApi=read('merchant-api.js');
assert.match(merchantApi,/const page=internalTest\?'\/api\/runtime\/merchant-checkout':'\/merchant-checkout\.html'/);
console.log('OWNER_RUNTIME_DELIVERY_PASS: protected owner path, pending approval inbox and edge-safe live JS/CSS');
