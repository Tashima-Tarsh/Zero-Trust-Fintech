'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const css=read('public/checkout-moonlight.css');
for(const p of ['public/checkout.html','public/merchant-checkout.html']){
  const html=read(p);
  assert.match(html,/\/checkout-moonlight\.css\?v=moonlight1/);
  assert.match(html,/id="mars-bg-canvas"/,'Mars 3D background canvas must exist');
  assert.match(html,/class="qr-tap-link/,'QR itself must be the payment launch surface');
  assert.match(html,/Scan or tap to pay/);
  for(const id of ['payAmount','paymentQr','qrTapToPay','checkoutStatus',
   'paymentTrackingStatus','saveReceipt','shareReceipt','shareCheckout'])
    assert.ok(html.includes('id="'+id+'"'),'Checkout payment hook missing '+id);
  assert.ok(html.includes('/cosmic-checkout.js'),'Actual checkout logic must load');
  assert.doesNotMatch(html,/btnOneTouch|oneTouchFallback|showQr|data-stage="methods"/,
    'Old button and app-picker must not return');
}
assert.ok(css.includes('svs.gsfc.nasa.gov/vis/a000000/a005000/a005001/moon_mosaic_print.jpg'));
assert.ok(css.includes('.checkout-panel'));
assert.ok(css.includes('@media(max-width:420px)')&&css.includes('prefers-reduced-motion:reduce'));
assert.ok(read('utils/clerk-csp.js').includes('https://svs.gsfc.nasa.gov'));
console.log('CHECKOUT_MOONLIGHT_PASS: mobile-responsive Mars checkout with one tappable QR');
