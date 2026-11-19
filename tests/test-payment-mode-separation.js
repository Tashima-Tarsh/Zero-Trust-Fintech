'use strict';
// Regression for the 2026-11-19 physical-phone capture: a file named P2M
// actually opened /checkout -> /api/session/new and produced a P2P URI.
// Assert modes are separated in BOTH route and issued payment metadata.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const server=read('server.js'),merchant=read('merchant-api.js');
const worker=read('public/_worker.js'),client=read('public/cosmic-checkout.js');
const home=read('public/index.html'),selector=read('public/payment-modes.html');
const p2mPage=read('public/p2m.html'),personal=read('public/checkout.html');
const routes=JSON.parse(read('public/_routes.json'));
for(const html of [home,selector]){
 assert.match(html,/data-payment-mode="P2P"/);
 assert.match(html,/data-payment-mode="P2M"/);
 assert.match(html,/href="\/p2p\?amount=1"/);
 assert.match(html,/href="\/p2m"/);
}
assert.match(home,/<div class="header-checkout" role="group"/,'Both checkout options belong in the header');
assert.doesNotMatch(home,/class="payment-lanes"|class="lane-options"/,'No full-height homepage payment lane section');
assert.match(selector,/class="choose"/);
assert.doesNotMatch(selector,/min-height:255px|margin-top:70px/,'Checkout mode chooser must stay compact');
assert.match(p2mPage,/\/login\?mode=P2M/);
assert.match(p2mPage,/\/dashboard\?mode=P2M#create/);
assert.match(personal,/data-required-payment-type="P2P"/);
assert.match(server,/P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH/);
assert.match(server,/DISHA_COMPANY_P2M_VPA/);
assert.match(server,/app.get\(\['\/p2p','\/p2p\/'\]/);
assert.match(server,/app.get\(\['\/p2m\/checkout','\/p2m\/checkout\/'\]/);
assert.ok(server.indexOf("app.get(['/p2m/checkout'")<server.indexOf("app.use(express.static("));
for(const route of ['/p2p','/p2m','/p2m/checkout','/choose-payment']){
 assert.ok(worker.includes('"' + route + '"'),'Cloudflare route missing '+route);
}
for(const route of ['/p2p','/p2m','/choose-payment'])
 assert.ok(routes.include.includes(route),'Pages worker must run for '+route);
assert.match(client,/PAYMENT_MODE_MISMATCH/);
assert.match(client,/requiredMode==='P2M'\?'\/p2m\/checkout'/);
assert.match(merchant,/P2M_REQUIRES_EXPLICIT_MERCHANT_VPA/);
assert.match(merchant,/PAYMENT_MODE_ACCOUNT_TYPE_MISMATCH/);
assert.match(merchant,/const destination=String\(accountType\)\.toUpperCase\(\)==='MERCHANT'\?'\/p2m\/checkout':page/);
assert.match(merchant,/payment_type:accountType==='MERCHANT'\?'P2M':'P2P'/);
const dashboard=read('public/premium-dashboard.js');
assert.match(dashboard,/paymentMode:p2mOnly\(\)\?'P2M':undefined/);
assert.match(dashboard,/account_type\)\.toUpperCase\(\)==='MERCHANT'/);
assert.match(read('public/merchant-login.html'),/paymentDestination/);

// Execute the real session generator with fake database state, no bank network,
// ensuring the public P2P endpoint refuses merchant classification BEFORE save.
const {buildUpiUri}=require('../utils/upi-intent');
const start=server.indexOf('async function generateSession(');
const end=server.indexOf('function generateUPILink(session)',start);
const linkEnd=server.indexOf('// REST API ENDPOINTS',end);
assert.ok(start>0&&end>start&&linkEnd>end);
const saved=[],counter=[];
const db={
 checkVpaVelocity:async()=>true,
 getVpaMerchantType:async vpa=>vpa.includes('@ypbiz')
  ?{accountType:'MERCHANT',mcc:'5411',holderName:'Merchant'}
  :{accountType:'PERSONAL',mcc:null,holderName:'Personal'},
 saveSession:async session=>saved.push(session),
 incrementVpaVelocity:async vpa=>counter.push(vpa)
};
const ctx={db,crypto,buildUpiUri,sanitizeTxnRef:x=>x,MERCHANT_UPI_ID:'person@oksbi',
 MERCHANT_NAME:'Personal',process:{env:{DISHA_COMPANY_P2M_VPA:'company@ypbiz'}}};
vm.runInNewContext(server.slice(start,end)+server.slice(end,linkEnd)+'\nthis.issue=generateSession;',ctx);
(async()=>{
 await assert.rejects(ctx.issue(1,'P2M wrong','merchant@ypbiz'),/P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH/);
 // Even if DB is missing the company merchant entry, configured company VPA is blocked.
 ctx.db.getVpaMerchantType=async()=>({accountType:'PERSONAL',mcc:null});
 await assert.rejects(ctx.issue(1,'P2M company','company@ypbiz'),/P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH/);
 assert.equal(saved.length,0,'Rejected merchant cannot persist a P2P order');
 assert.equal(counter.length,0,'Rejected merchant cannot consume VPA quota');
 const direct=await ctx.issue(1,'Personal payment','person@oksbi');
 assert.equal(saved.length,1);
 const params=new URLSearchParams(direct.upiUri.split('?')[1]);
 assert.equal(params.get('pa'),'person@oksbi');
 assert.equal(params.get('mc'),null);
 assert.equal(params.get('tr'),null);
 assert.equal(direct.merchantType,'PERSONAL');
 console.log('PAYMENT_MODE_SEPARATION_PASS: homepage choice, P2P server fail-closed, distinct P2M link + active merchant selection');
})().catch(e=>{console.error(e);process.exitCode=1});
