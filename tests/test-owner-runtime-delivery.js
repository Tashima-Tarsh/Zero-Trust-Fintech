'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const server=read('server.js'),login=read('public/merchant-login.html');
const merchant=read('public/merchant-console.html'),owner=read('public/owner-console.html');
const clerk=read('public/premium-dashboard.js'),consoleJS=read('public/platform-console.js');
assert.match(server,/app\.get\('\/api\/runtime-assets\/:asset'/);
assert.match(server,/RUNTIME_ASSETS\.has\(asset\)/);
assert.match(server,/\['\/api\/runtime\/checkout','\/api\/runtime\/merchant-checkout'\]/);
assert.match(owner,/src="\/api\/runtime-assets\/platform-console\.js/);
assert.match(merchant,/src="\/api\/runtime-assets\/premium-dashboard\.js/);
for(const page of ['public/checkout.html','public/merchant-checkout.html']){
 const html=read(page);
 assert.match(html,/\/api\/runtime-assets\/cosmic-checkout\.js/);
 assert.match(html,/\/api\/runtime-assets\/one-touch-vault\.js/);
}
assert.match(login,/Super Admin sign-in/);
assert.match(login,/const destination=ownerLogin\?'\/owner#requests':'\/dashboard'/);
assert.match(clerk,/Switch to Super Admin sign-in/);
assert.match(clerk,/primaryEmailAddress\?\.emailAddress/);
assert.match(owner,/id="owner-pending-count"/);
assert.match(consoleJS,/refreshOwnerInbox\(/);
assert.match(owner,/href="\/api\/runtime\/checkout\?amount=1&amp;debug=1"|href="\/api\/runtime\/checkout\?amount=1&debug=1"/);
const merchantApi=read('merchant-api.js');
assert.match(merchantApi,/const page=internalTest\?'\/api\/runtime\/merchant-checkout':'\/merchant-checkout\.html'/);
console.log('OWNER_RUNTIME_DELIVERY_PASS: protected owner path, pending approval inbox and edge-safe live JS/CSS');
