'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {clerkFrontendApiOrigin,buildContentSecurityPolicy}=require('../utils/clerk-csp');

const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const key='pk_live_'+Buffer.from('clerk.merchant.example\0').toString('base64url');
const origin='https://clerk.merchant.example';
assert.equal(clerkFrontendApiOrigin(key),origin);
const realLiveKey='pk_live_'+Buffer.from('clerk.merchant.example
assert.equal(clerkFrontendApiOrigin('pk_test_'+Buffer.from('edge.accounts.dev\0').toString('base64url')),'https://edge.accounts.dev');
for(const invalid of ['',null,'wrong','pk_test_'+Buffer.from('evil.com;script-src *\0').toString('base64url'),
    'pk_test_'+Buffer.from('localhost\0').toString('base64url')]) {
 assert.equal(clerkFrontendApiOrigin(invalid),null,'Reject non-DNS / injected FAPI hosts');
}
const csp=buildContentSecurityPolicy(key);
assert.match(csp,/script-src[^;]*https:\/\/clerk\.merchant\.example/);
assert.match(csp,/connect-src[^;]*https:\/\/clerk\.merchant\.example/);
assert.match(csp,/script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(csp,/frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(csp,/https:\/\/\*\.protect\.clerk\.com:\*/);
assert.match(csp,/https:\/\/img\.clerk\.com/);
assert.match(csp,/worker-src 'self' blob:/);
assert.doesNotMatch(buildContentSecurityPolicy('pk_test_bad@domain'),/bad@domain/);

const server=read('server.js');
assert.match(server,/buildContentSecurityPolicy\(process\.env\.CLERK_PUBLISHABLE_KEY\)/);
assert.match(server,/app\.get\('\/auth-config\.js'/);
assert.match(server,/Cache-Control', 'no-store, no-cache, must-revalidate'/);
assert.match(server,/DISHA_CLERK_CONFIG_READY/);
const route=server.slice(server.indexOf("app.get('/auth-config.js'"),server.indexOf("app.get('/login'"));
assert.ok(!route.includes('process.env.CLERK_SECRET_KEY'),'Never disclose secret key');
const edge=read('public/_worker.js'),routes=read('public/_routes.json');
assert.ok(edge.includes('"/auth-config.js"') && routes.includes('"/auth-config.js"'));
assert.ok(edge.includes('"/signup"') && edge.includes('"/login"'));

for(const [name,component] of [['merchant-signup.html','SignUp'],['merchant-login.html','SignIn']]){
 const html=read('public/'+name);
 assert.match(html,/<script src="\/auth-config\.js"><\/script>/);
 assert.match(html,/DISHA_CLERK_PUBLISHABLE_KEY/);
 assert.match(html,/DISHA_CLERK_CONFIG_READY/);
 assert.match(html,/window\.Clerk\.load\(/);
 assert.ok(html.includes('window.Clerk.mount'+component+'('));
 assert.match(html,/forceRedirectUrl:'\/dashboard'/);
 assert.match(html,/routing:'hash'/);
 const inline=[...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
 assert.ok(inline.length);
 inline.forEach((js,i)=>new vm.Script(js,{filename:name+' inline #'+i}));
}
console.log('CLERK_MERCHANT_AUTH_PASS: CDN host from key, safe CSP, bot protection, no-store config, signup/login components, redirects and routing.');
).toString('base64url');
const realTestKey='pk_test_'+Buffer.from('edge.accounts.dev
assert.equal(clerkFrontendApiOrigin('pk_test_'+Buffer.from('edge.accounts.dev\0').toString('base64url')),'https://edge.accounts.dev');
for(const invalid of ['',null,'wrong','pk_test_'+Buffer.from('evil.com;script-src *\0').toString('base64url'),
    'pk_test_'+Buffer.from('localhost\0').toString('base64url')]) {
 assert.equal(clerkFrontendApiOrigin(invalid),null,'Reject non-DNS / injected FAPI hosts');
}
const csp=buildContentSecurityPolicy(key);
assert.match(csp,/script-src[^;]*https:\/\/clerk\.merchant\.example/);
assert.match(csp,/connect-src[^;]*https:\/\/clerk\.merchant\.example/);
assert.match(csp,/script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(csp,/frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(csp,/https:\/\/\*\.protect\.clerk\.com:\*/);
assert.match(csp,/https:\/\/img\.clerk\.com/);
assert.match(csp,/worker-src 'self' blob:/);
assert.doesNotMatch(buildContentSecurityPolicy('pk_test_bad@domain'),/bad@domain/);

const server=read('server.js');
assert.match(server,/buildContentSecurityPolicy\(process\.env\.CLERK_PUBLISHABLE_KEY\)/);
assert.match(server,/app\.get\('\/auth-config\.js'/);
assert.match(server,/Cache-Control', 'no-store, no-cache, must-revalidate'/);
assert.match(server,/DISHA_CLERK_CONFIG_READY/);
const route=server.slice(server.indexOf("app.get('/auth-config.js'"),server.indexOf("app.get('/login'"));
assert.ok(!route.includes('process.env.CLERK_SECRET_KEY'),'Never disclose secret key');
const edge=read('public/_worker.js'),routes=read('public/_routes.json');
assert.ok(edge.includes('"/auth-config.js"') && routes.includes('"/auth-config.js"'));
assert.ok(edge.includes('"/signup"') && edge.includes('"/login"'));

for(const [name,component] of [['merchant-signup.html','SignUp'],['merchant-login.html','SignIn']]){
 const html=read('public/'+name);
 assert.match(html,/<script src="\/auth-config\.js"><\/script>/);
 assert.match(html,/DISHA_CLERK_PUBLISHABLE_KEY/);
 assert.match(html,/DISHA_CLERK_CONFIG_READY/);
 assert.match(html,/window\.Clerk\.load\(/);
 assert.ok(html.includes('window.Clerk.mount'+component+'('));
 assert.match(html,/forceRedirectUrl:'\/dashboard'/);
 assert.match(html,/routing:'hash'/);
 const inline=[...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
 assert.ok(inline.length);
 inline.forEach((js,i)=>new vm.Script(js,{filename:name+' inline #'+i}));
}
console.log('CLERK_MERCHANT_AUTH_PASS: CDN host from key, safe CSP, bot protection, no-store config, signup/login components, redirects and routing.');
).toString('base64url');
assert.equal(clerkFrontendApiOrigin(realLiveKey),origin,
  'Real Clerk pk_live keys encode a $-terminated FAPI host');
assert.equal(clerkFrontendApiOrigin(realTestKey),'https://edge.accounts.dev',
  'Real Clerk pk_test keys encode a $-terminated FAPI host');
assert.equal(clerkFrontendApiOrigin('pk_test_'+Buffer.from('edge.accounts.dev\0').toString('base64url')),'https://edge.accounts.dev');
for(const invalid of ['',null,'wrong','pk_test_'+Buffer.from('evil.com;script-src *\0').toString('base64url'),
    'pk_test_'+Buffer.from('localhost\0').toString('base64url')]) {
 assert.equal(clerkFrontendApiOrigin(invalid),null,'Reject non-DNS / injected FAPI hosts');
}
const csp=buildContentSecurityPolicy(key);
assert.match(csp,/script-src[^;]*https:\/\/clerk\.merchant\.example/);
assert.match(csp,/connect-src[^;]*https:\/\/clerk\.merchant\.example/);
assert.match(csp,/script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(csp,/frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(csp,/https:\/\/\*\.protect\.clerk\.com:\*/);
assert.match(csp,/https:\/\/img\.clerk\.com/);
assert.match(csp,/worker-src 'self' blob:/);
assert.doesNotMatch(buildContentSecurityPolicy('pk_test_bad@domain'),/bad@domain/);

const server=read('server.js');
assert.match(server,/buildContentSecurityPolicy\(process\.env\.CLERK_PUBLISHABLE_KEY\)/);
assert.match(server,/app\.get\('\/auth-config\.js'/);
assert.match(server,/Cache-Control', 'no-store, no-cache, must-revalidate'/);
assert.match(server,/DISHA_CLERK_CONFIG_READY/);
const route=server.slice(server.indexOf("app.get('/auth-config.js'"),server.indexOf("app.get('/login'"));
assert.ok(!route.includes('process.env.CLERK_SECRET_KEY'),'Never disclose secret key');
const edge=read('public/_worker.js'),routes=read('public/_routes.json');
assert.ok(edge.includes('"/auth-config.js"') && routes.includes('"/auth-config.js"'));
assert.ok(edge.includes('"/signup"') && edge.includes('"/login"'));

for(const [name,component] of [['merchant-signup.html','SignUp'],['merchant-login.html','SignIn']]){
 const html=read('public/'+name);
 assert.match(html,/<script src="\/auth-config\.js"><\/script>/);
 assert.match(html,/DISHA_CLERK_PUBLISHABLE_KEY/);
 assert.match(html,/DISHA_CLERK_CONFIG_READY/);
 assert.match(html,/window\.Clerk\.load\(/);
 assert.ok(html.includes('window.Clerk.mount'+component+'('));
 assert.match(html,/forceRedirectUrl:'\/dashboard'/);
 assert.match(html,/routing:'hash'/);
 const inline=[...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
 assert.ok(inline.length);
 inline.forEach((js,i)=>new vm.Script(js,{filename:name+' inline #'+i}));
}
console.log('CLERK_MERCHANT_AUTH_PASS: CDN host from key, safe CSP, bot protection, no-store config, signup/login components, redirects and routing.');
