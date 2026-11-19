'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const js=read('public/cosmic-checkout.js');
assert.equal((js.match(/query\.get\('amount'\)\|\|'1'/g)||[]).length,2,'Both fresh and saved public checkout sessions default to one rupee');
assert.ok(!js.includes("query.get('amount')||'500'"),'₹500 default must never come back');
const index=read('public/index.html');
assert.ok((index.match(/href="\/choose-payment"/g)||[]).length>=3,
 'Public entry links must ask for P2P or P2M before payment');
assert.match(index,/href="\/p2p\?amount=1"/,'P2P selector must retain the one-rupee test checkout');
assert.match(index,/href="\/p2m"/,'P2M selector must lead to authenticated merchant workflow');
const server=read('server.js');
assert.ok(server.includes("if(!requestedVpa){")&&server.includes("process.env.MERCHANT_UPI_ID"),'All public checkout requests must use the configured owner receiving VPA');
assert.ok(server.includes("RECEIVING_UPI_NOT_CONFIGURED"),'Missing owner payee must fail closed');
console.log('ONE_RUPEE_CHECKOUT_PASS: public default, saved session, entry links and recipient contract');
