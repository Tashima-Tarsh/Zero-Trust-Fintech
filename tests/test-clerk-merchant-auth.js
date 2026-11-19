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
const realLiveKey='pk_live_'+Buffer.from('clerk.merchant.example$').toString('base64url');
const realTestKey='pk_test_'+Buffer.from('edge.accounts.dev$').toString('base64url');
assert.equal(clerkFrontendApiOrigin(realLiveKey),origin,
  'Real Clerk pk_live keys encode a dollar-terminated FAPI host');
assert.equal(clerkFrontendApiOrigin(realTestKey),'https://edge.accounts.dev',
  'Real Clerk pk_test keys encode a dollar-terminated FAPI host');
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

for(const [name,component] of [['merchant-login.html','SignIn']]){
 const html=read('public/'+name);
 assert.match(html,/<script src="\/auth-config\.js"><\/script>/);
 assert.match(html,/DISHA_CLERK_PUBLISHABLE_KEY/);
 assert.match(html,/DISHA_CLERK_CONFIG_READY/);
 assert.match(html,/window\.Clerk\.load\(/);
 assert.ok(html.includes('window.Clerk.mount'+component+'('));
 assert.match(html,/forceRedirectUrl:paymentDestination/);
 assert.match(html,/paymentDestination=.*!ownerLogin|paymentDestination=!ownerLogin/,
  'Merchant P2M sign-in must retain its selected payment lane');
 assert.match(html,/routing:'hash'/);
 const inline=[...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
 assert.ok(inline.length);
 inline.forEach((js,i)=>new vm.Script(js,{filename:name+' inline #'+i}));
}
// Exercise the actual login and signup inline bootstraps against a Clerk-format
// publishable key, including the terminal dollar-sign delimiter.
async function testBrowserMount(file,method){
 const html=read('public/'+file);
 const inline=[...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m=>m[1]).find(Boolean);
 assert.ok(inline,'Expected auth bootstrap script');
 const scripts=[],mounts=[],errors=[];
 const status={textContent:'Connecting securely',style:{},remove(){}};
 const window={
  DISHA_CLERK_PUBLISHABLE_KEY:realLiveKey,
  DISHA_CLERK_CONFIG_READY:true,
  __internal_ClerkUICtor:function(){},
  Clerk:{isSignedIn:false,load:async()=>{},
   mountSignIn:(el)=>mounts.push('SignIn'),mountSignUp:(el)=>mounts.push('SignUp')}
 };
 const document={
  getElementById:id=>id==='auth-status'?status:{id},
  createElement:()=>({dataset:{}}),
  head:{appendChild(node){scripts.push(node.src);queueMicrotask(()=>node.onload?.())}}
 };
 vm.runInNewContext(inline,{window,document,atob,location:{replace(){}},
  console:{error:(...args)=>errors.push(args.map(String).join(':'))}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(errors,[],'Auth page must not display a bootstrap error');
 assert.deepEqual(scripts,[
  'https://clerk.merchant.example/npm/@clerk/ui@1/dist/ui.browser.js',
  'https://clerk.merchant.example/npm/@clerk/clerk-js@6/dist/clerk.browser.js'
 ],'CDN bundle URLs must have a valid FAPI hostname');
 assert.deepEqual(mounts,[method],'Clerk must mount the merchant auth form');
}
(async()=>{
 // Premium layout is shared while Clerk owns the complete auth lifecycle.
 for(const [page,mode] of [['merchant-login.html','signin']]){
  const html=read('public/'+page);
  assert.match(html,/href="\/merchant-auth\.css\?v=[a-zA-Z0-9._-]+"/,'Use cache-versioned production auth design');
  assert.match(html,/class="auth-shell"/,'Use accessible split-screen layout');
  assert.match(html,/data-mode="/,'Expose the selected auth mode');
  assert.match(html,new RegExp('data-mode="'+mode+'"'),'Page must have correct mode');
  assert.match(html,/aria-label="Merchant authentication"/);
  assert.match(html,/forceRedirectUrl:destination/);
  assert.match(html,/window\.Clerk\.mountSign/,'Clerk must own sign-in and signup');
 }
 // Uploaded metallic wordmark must be used, not rebuilt with generic text.
 const styles=read('public/merchant-auth.css');
 assert.match(styles,/\/assets\/disha-8-2-wordmark-cropped\.png/);
 assert.match(styles,/@keyframes\s+logoReveal/);
 assert.match(styles,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
 assert.match(styles,/@media\s*\(max-width:\s*1100px\)/);
 assert.match(styles,/@media\s*\(max-width:\s*620px\)/);
 for(const page of ['merchant-login.html']){
  const html=read('public/'+page);
  assert.match(html,/class="auth-logo-stage"/);
  assert.match(html,/src="\/assets\/disha-8-2-wordmark-cropped\.png"/);
  assert.match(html,/alt="DISHA 8\.2"/);
  assert.doesNotMatch(html,/class="auth-network-art"/,'No empty artwork placeholder');
 }
 assert.ok(fs.statSync(path.join(root,'public/assets/disha-8-2-wordmark-cropped.png')).size>10000,
   'Real metallic logo must be present in the public asset directory');
 // Merchant sign-in and signup use real Clerk widgets and a separately licensed photo.
 for(const page of ['merchant-login.html']){
  const html=read('public/'+page);
  assert.doesNotMatch(html,/class="auth-network-art"/,'No empty artwork placeholder');
  assert.doesNotMatch(html,/src="\/assets\/merchant-direct-3d\.webp"/);
  assert.match(html,/id="auth-slot"/);
  assert.match(html,/class="auth-content"/);
  assert.doesNotMatch(html,/class="auth-footnote"/,'Clerk owns auth navigation');
  assert.match(html,/window\.Clerk\.mountSign/);
 }
 assert.match(styles,/disha-universe-background\.svg/,'Background must use bundled photographic asset');
 assert.match(styles,/height:100dvh/,'Viewport-height layout required');
 assert.match(styles,/\.auth-content\{[^}]*background:transparent/s,'Do not frame Clerk in an outer white card');
 assert.match(styles,/\.auth-action\{[^}]*background:#fff/s,'Right surface should remain a seamless white column');
 assert.match(styles,/\.auth-story\{[^}]*min-width:0/s,'Prevent hero heading overflow');
 assert.match(styles,/\.auth-slot-wrap\{[^}]*min-width:0/s,'Prevent Clerk form clipping');
 assert.match(styles,/@media\(max-width:800px\)/,'Use tablet layout breakpoint');
 assert.match(styles,/@media\(max-width:480px\)/,'Use mobile layout breakpoint');
  const policy=require('../public/merchant-password-policy.js');
 assert.equal(policy.MIN_PASSWORD_LENGTH,10);
 assert.equal(policy.isAllowedPassword('123456789'),false,'Reject 9 characters');
 assert.equal(policy.isAllowedPassword('1234567890'),true,'Accept exactly 10 characters');
 assert.equal(policy.isAllowedPassword('12345678901234567890'),true,'Accept longer passwords');
 await testBrowserMount('merchant-login.html','SignIn');
 assert.ok(read('public/merchant-signup.html').includes('/request-access'), 'Public signup must redirect to request-access');
 console.log('CLERK_MERCHANT_AUTH_PASS: valid Clerk keys, invite-only routing, CSP and Clerk sign-in.');
})().catch(err=>{console.error(err);process.exitCode=1;});
