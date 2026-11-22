'use strict';
/* Pony-tail principle: preserve financial logic, check visual-only UI invariants,
 * control surfaces, responsive coverage, and never hide business content. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const file=n=>fs.readFileSync(path.join(root,'public',n),'utf8');
const html=file('merchant-console.html'),css=file('merchant-celestial.css'),js=file('premium-dashboard.js');
const brand='/assets/disha-8-2-wordmark-cropped.png';
assert.ok(html.includes('src="'+brand+'"'),'Actual DISHA metallic wordmark must remain in sidebar');
assert.ok(html.includes('/merchant-celestial.css?v='),'Celestial design must load after original styles');
assert.ok(html.includes('class="celestial-moon"')&&html.includes('class="celestial-earth"'),'Real dashboard must show Poornima moon and Earth');
assert.ok(css.includes('@keyframes disha-earth-revolve')&&css.includes('.celestial-earth'),'Earth must move');
assert.ok(css.includes('prefers-reduced-motion:reduce'),'Respect system reduced-motion preference');
assert.ok(css.includes('backdrop-filter:blur('),'Glass panels must use blur');
assert.ok(css.includes('body.app-page .field :is(input,select,textarea)'),'Inputs must remain legible');
assert.ok(css.includes('body.app-page .side-nav button svg'),'Navigation needs crisp vector icon artwork');
assert.ok(css.includes('body.app-page .btn.primary'),'Key financial actions must have distinct appearance');
assert.ok(css.includes('body.app-page .stat-grid'),'Actual metric cards must remain');
for(const bp of ['max-width:1180px','max-width:900px','max-width:760px','max-width:480px'])assert.ok(css.includes(bp),'Missing responsive breakpoint '+bp);
for(const id of ['vpaTable','addVpaForm','vpaAddress','vpaHolder','vpaBank','vpaAccountType','vpaMcc','refreshVpas','downloadVpaTemplate','importVpaCsv','vpaCsvFile','createPaymentForm'])assert.ok(html.includes('id="'+id+'"'),'Real merchant control lost: '+id);
assert.equal((html.match(/data-view="(overview|intelligence|create|payments|vpas|vault|risk|ledger|reports|notifications|integrations|settings)"/g)||[]).length,12,'Approved sidebar must contain exactly 12 destinations');
assert.ok(js.includes("vpas:['UPI Accounts & Routing'"),'Selected view title must match sidebar');
assert.ok(!/previewOrders|isPreview|mockBalance|syntheticTransaction/.test(js),'No mock financial figures');
console.log('CELESTIAL_MERCHANT_PASS: live logo, 12 destinations, working control DOM, glass UI, full moon, revolving Earth, mobile and accessibility');
