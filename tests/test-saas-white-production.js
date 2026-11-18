'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,'public',file),'utf8');
const page=read('merchant-console.html');
const js=read('premium-dashboard.js');
const css=read('saas-white.css');
const worker=read('_worker.js');
const routes=JSON.parse(read('_routes.json'));
const login=read('merchant-login.html');
const signup=read('merchant-signup.html');
const checkout=read('merchant-checkout.html');
new vm.Script(js);
new vm.Script(worker.replace(/\bexport\s+default\b/,'const edge ='),{filename:'cloudflare-worker.js'});
const nav=[...page.matchAll(/data-view="([a-z]+)"/g)].map(x=>x[1]);
assert.equal(new Set(nav).size,12,'All 12 merchant workspace destinations should exist');
for(const name of nav){
 assert.ok(page.includes('id="view-'+name+'"'),'Missing workspace panel: '+name);
 assert.ok(js.includes(name+':') || js.includes("'"+name+"'"),'Missing navigation view: '+name);
}
for(const input of ['setupMerchantForm','addVpaForm','createPaymentForm','settingsForm',
 'refreshAccess','refreshVpas','exportReport','markRead','signOut','sideToggle']){
 assert.ok(page.includes('id="'+input+'"'),'Missing clickable element '+input);
 assert.ok(js.includes(input),'Missing click binding '+input);
}
for(const pathName of ['/dashboard','/login','/signup','/auth-config.js','/merchant-console.html']){
 assert.ok(routes.include.includes(pathName),'Route missing from Cloudflare edge: '+pathName);
 assert.ok(worker.includes(pathName),'Worker must forward protected route '+pathName);
}
assert.ok(css.includes('color-scheme:light'),'Premium merchant shell must use light mode');
assert.ok(css.includes('body.app-page .btn.primary'),'Primary button style missing');
assert.ok(css.includes('@media(max-width:620px)'),'Small-screen SaaS design missing');
assert.ok(login.includes('mountSignIn') && signup.includes('mountSignUp'),'Clerk sign-up/sign-in missing');
assert.ok(checkout.includes('/api/merchant/public/order/'),'Real merchant checkout endpoint missing');
assert.ok(checkout.includes('upi_uri'),'Payee-specific UPI data binding missing');
assert.ok(!/previewOrders|previewVpas|VISUAL PREVIEW|SAMPLE-240|isPreview/.test(js),
 'Never ship fake financial data or preview-mode branches');
assert.ok(!page.includes('Execute Simulation'),'Live risk screen must not run fake security simulations');
console.log('Merchant navigation, controls, white theme, auth, edge protection, checkout and no-demo invariants PASS');
