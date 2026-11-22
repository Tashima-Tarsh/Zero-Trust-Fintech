'use strict';
/* Visual contract for the approved second DISHA mockup.
 * Prevent CSS regressions without fabricating financial account data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,'public',n),'utf8');
const html=read('merchant-console.html'),js=read('premium-dashboard.js'),css=read('merchant-reference.css');
assert.match(html,/merchant-reference\.css\?v=reference-/);
assert.ok(html.indexOf('merchant-reference.css')>html.indexOf('merchant-celestial.css'),'Reference styles load LAST');
assert.ok(html.includes('assets/disha-8-2-wordmark-cropped.png'),'Original wordmark retained');
assert.ok(!html.includes('eoimages.gsfc.nasa.gov'),'Broken remote Earth image must not load');
assert.ok(html.includes('class="celestial-earth"'),'Decorative Earth layer retained');
assert.ok(!css.includes('earth-night-horizon.svg'),'Polygon earth must never be rendered by the final stylesheet');
assert.ok(css.includes('disha-nasa-earth-float'),'Actual Earth image requires optional restrained motion');
assert.ok(css.includes('prefers-reduced-motion:reduce'),'Animation must respect reduced motion');
assert.equal((html.match(/class="stat-portrait"/g)||[]).length,4,'All receiving UPI summary cards need premium icons');
assert.ok(html.includes('id="vpaTotal"')&&html.includes('id="vpaActive"')&&html.includes('id="vpaPaused"')&&html.includes('id="vpaDefault"'),'Real KPI data hooks unchanged');
for(const name of ['vpaTable','addVpaForm','vpaAddress','vpaHolder','vpaBank','vpaAccountType','vpaMcc','refreshVpas','downloadVpaTemplate','importVpaCsv','vpaCsvFile']){
 assert.ok(html.includes('id="'+name+'"'),'Merchant action lost: '+name);
}
assert.ok(js.includes('document.body.dataset.currentView=name'),'Navigation must update view styling');
assert.ok(js.includes("e.ctrlKey||e.metaKey"),'Search shortcut missing');
for(const name of ['merchant-console.html','premium-dashboard.js','merchant-reference.css','assets/poornima-moon.svg','assets/earth-night-horizon.svg',...['empty-vpa','upi-field','person-field','bank-field','tag-field','layers-field'].map(x=>'assets/icons/'+x+'.svg')]){
 const src=read(name);
 for(const dir of ['dist','disha-cinematic/public','disha-cinematic/dist']){
  assert.equal(fs.readFileSync(path.join(root,dir,name),'utf8'),src,'Out-of-sync Cloudflare asset '+dir+'/'+name);
 }
}
for(const rule of ['.celestial-earth','.celestial-moon','.stat-portrait','.side-nav button.active','#vpaAddress','#vpaHolder','.table-scroller','prefers-reduced-motion']){
 assert.ok(css.includes(rule),'Approved reference UI treatment absent '+rule);
}
for(const size of [1190,920,760,450])assert.ok(css.includes('max-width:'+size+'px'),'Viewport breakpoint missing: '+size);
assert.ok(!/previewOrders|sampleBalance|fakePayment/i.test(js),'No invented financial records');

for(const selector of ['#vpaAddress','#vpaHolder','#vpaBank','#vpaMcc','#vpaAccountType']){
 assert.ok(css.includes(selector),'Missing receiving-account icon style: '+selector);
}
assert.ok(css.includes('background-repeat:no-repeat,no-repeat!important'),'Field icons must never tile across the input');
assert.ok(css.includes('background-size:43px 21px,100% 100%!important'),'UPI icon requires explicit layer sizing');
assert.ok(css.includes('background-size:22px 22px,100% 100%!important'),'Account field icons require explicit layer sizing');
assert.ok(css.includes('background-position:11px center,center!important'),'Account icons must stay left aligned');

console.log('REFERENCE_GLASS_PASS: approved second design applied to real tenant UI, controls preserved, assets in sync');
