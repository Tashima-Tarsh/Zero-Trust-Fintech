'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const dirs=['public','dist','disha-cinematic/public','disha-cinematic/dist'];
const assets=['disha-login-mars.webp','disha-checkout-space.webp','disha-earth-night.webp'];
for(const image of assets){
 const expected=fs.readFileSync(path.join(root,'public/assets',image));
 assert.ok(expected.length>1000,'Empty or missing local image '+image);
 for(const dir of dirs.slice(1)){
  const mirrored=fs.readFileSync(path.join(root,dir,'assets',image));
  assert.ok(expected.equals(mirrored),'Mismatch in frontend build copy '+dir+'/'+image);
 }
}
const login=read('public/merchant-auth.css'),checkout=read('public/checkout-moonlight.css'),merchant=read('public/merchant-reference.css'),home=read('public/index.html'),dashboard=read('public/merchant-console.html');
assert.ok(login.includes("url('/assets/disha-login-mars.webp')"));
assert.ok(checkout.includes("url('/assets/disha-checkout-space.webp')"));
assert.ok(merchant.includes("url('/assets/disha-earth-night.webp')"));
assert.ok(home.includes("url('/assets/disha-earth-night.webp')"));
assert.ok(!dashboard.includes('eoimages.gsfc.nasa.gov'),'Do not reintroduce broken external image');
assert.ok(!dashboard.includes('nitish@thenitishkr.in'),'Never disclose hardcoded owner email in merchant shell');
assert.equal((dashboard.match(/<button[^>]*class="btn primary small"[^>]*data-switch="create"/g)||[]).length,1,'Exactly one primary desktop Create payment button');
const app=read('public/premium-dashboard.js');
assert.ok(!app.includes('Owner access requires the verified primary Clerk email'),'No user-facing owner email leak');
const p2p=read('public/try-checkout.js');
assert.ok(p2p.includes('UNAUTHORIZED_PAYEE_VPA'),'Unregistered public receiving accounts must be rejected');
console.log('LOCAL_IMAGES_AND_UI_PASS: exact local assets mirrored, single CTA and protected UX');
