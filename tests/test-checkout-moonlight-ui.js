'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const css=read('public/checkout-moonlight.css');
for(const p of ['public/checkout.html','public/merchant-checkout.html']){
 const h=read(p);
 assert.ok(h.includes('/checkout-moonlight.css?v=moonlight1'),p+' missing moonlight stylesheet');
 assert.ok(h.includes('class="nasa-moon"'),p+' missing NASA moon');
 assert.match(h,/<button id="btnOneTouch"[\s\S]*?<span>Pay<\/span>[\s\S]*?<\/button>/,'Button must say Pay');
 assert.ok(!h.includes('Touch to Pay'),'Old CTA must be absent');
 for(const key of ['btnOneTouch','payAmount','paymentQr','checkoutStatus','oneTouchFallback','saveReceipt','shareReceipt','showQr']){
   assert.ok(h.includes('id="'+key+'"'),'Checkout payment hook lost '+key);
 }
 assert.ok(h.includes('/one-touch-vault.js')&&h.includes('/cosmic-checkout.js'),'Original payment logic missing');
}
assert.ok(css.includes('svs.gsfc.nasa.gov/vis/a000000/a005000/a005001/moon_mosaic_print.jpg'),'NASA LRO moon required');
assert.ok(css.includes('.checkout-panel')&&css.includes('border:none!important')&&css.includes('background:none!important'),'Outer box must be gone');
assert.ok(css.includes('max-width:178px!important'),'Pay button must be compact');
assert.ok(css.includes('width:clamp(136px,26vw,178px)!important'),'Pay width must be compact');
assert.ok(css.includes('@media(max-width:420px)')&&css.includes('prefers-reduced-motion:reduce'),'Responsive and accessibility controls required');
assert.ok(read('utils/clerk-csp.js').includes('https://svs.gsfc.nasa.gov'),'NASA source must be permitted');
console.log('CHECKOUT_MOONLIGHT_PASS: borderless NASA Moon checkout with compact Pay button');
