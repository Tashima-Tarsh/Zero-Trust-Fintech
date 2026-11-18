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

// A merchant onboarding form is part of Overview, never an always-on overlay
// that covers Transactions, Accounts and all other navigable screens.
const startOverview=page.indexOf('<section id="view-overview"');
const startPayments=page.indexOf('<section id="view-payments"');
const setup=page.indexOf('id="merchantSetup"');
assert.ok(startOverview>=0 && setup>startOverview && setup<startPayments,
  'Onboarding must belong to Overview so navigation exposes the selected view');
assert.match(page,/class="side-wordmark"/,'Sidebar must use metallic brand asset');
assert.match(page,/id="vpaHolder"/,'Receiving UPI account must accept holder name');
assert.match(page,/id="vpaCsvFile"/,'CSV bulk UPI import must be available');
assert.match(page,/id="importVpaCsv"/,'CSV import must have explicit action');
assert.match(page,/id="setupHolderName"/,'First merchant VPA should capture account holder');
assert.match(page,/id="view-overview"/);
assert.match(js,/loadVpas/);
assert.match(js,/function view\(name/);
assert.match(js,/bulkImportVpas/);
assert.match(js,/merchant\.setup_completed/);
assert.match(js,/history\.pushState/,'Navigation must support browser Back');
assert.match(css,/premium-merchant-console/,'Apply dedicated premium console theme');
assert.match(page,/src="\/assets\/disha-8-2-wordmark-cropped\.png"/);
assert.match(css,/@media\(max-width:900px\)/);
assert.match(css,/@media\(max-width:620px\)/);
const {parseVpaCsv}=require('../public/merchant-vpa-import.js');
assert.deepEqual(parseVpaCsv('upi_id,account_holder,bank_name,account_type,mcc\nshop@oksbi,Shop Owner,SBI,PERSONAL,').map(x=>x.vpaAddress),['shop@oksbi']);
assert.equal(parseVpaCsv('upi_id,account_holder,bank_name,account_type,mcc\nshop@oksbi,"Shop, Owner",SBI,PERSONAL,')[0].holderName,'Shop, Owner');
assert.throws(()=>parseVpaCsv('upi_id,account_holder,bank_name\ninvalid,Name,Bank'),/UPI|Invalid/i);
assert.throws(()=>parseVpaCsv('upi_id,account_holder,bank_name\nshop@oksbi,N,Bank'),/holder/i);

// Execute the real route controller with a minimal DOM surface and assert that
// clicks, delegated actions and browser history expose only the selected view.
const viewNames=['overview','payments','create','vpas','routing','risk','access','reports','notifications','soundbox','api','settings'];
const makeClassList=()=>({
 active:false,open:false,
 toggle(name,flag){this[name]=flag===undefined?!this[name]:Boolean(flag);return this[name]},
 add(name){this[name]=true},remove(name){this[name]=false},contains(name){return Boolean(this[name])}
});
const rendered=viewNames.map(name=>({id:'view-'+name,classList:makeClassList()}));
const navNodes=viewNames.map(name=>({
 dataset:{view:name},classList:makeClassList(),attributes:{},
 addEventListener(event,fn){this[event]=fn},
 setAttribute(name,val){this.attributes[name]=val},removeAttribute(name){delete this.attributes[name]}
}));
const bound={},callbacks={};
const staticEl=Object.fromEntries(['#viewHeading','#viewSubtitle','#appSide','#sideBackdrop','#sideToggle'].map(key=>[key,{classList:makeClassList(),textContent:'',setAttribute(){},addEventListener(event,fn){this[event]=fn}}]));
const fakeDocument={
 querySelector(sel){return staticEl[sel]||null},
 querySelectorAll(sel){if(sel==='.view')return rendered;if(sel==='#appSide [data-view]')return navNodes;return []},
 addEventListener(event,fn){bound[event]=fn}
};
const fakeLocation={hash:'#overview'};
const historyCalls=[];
const fakeHistory={
 pushState(a,b,hash){historyCalls.push(['push',hash]);fakeLocation.hash=hash},
 replaceState(a,b,hash){historyCalls.push(['replace',hash]);fakeLocation.hash=hash}
};
const fakeWindow={scrollTo(){},addEventListener(event,fn){callbacks[event]=fn}};
const testHarness=js.replace("document.addEventListener('DOMContentLoaded',init);","window.__merchantRouter={view,setupBindings};");
assert.notEqual(testHarness,js,'Route test must expose the actual controller');
vm.runInNewContext(testHarness,{
 document:fakeDocument,window:fakeWindow,location:fakeLocation,history:fakeHistory,
 console,Intl,URL,setTimeout,clearTimeout
});
fakeWindow.__merchantRouter.setupBindings();
navNodes.find(n=>n.dataset.view==='settings').click();
assert.equal(fakeLocation.hash,'#settings');
assert.ok(rendered.find(n=>n.id==='view-settings').classList.active);
assert.equal(rendered.filter(n=>n.classList.active).length,1,'Only selected page must remain visible');
assert.ok(historyCalls.some(call=>call[0]==='push'&&call[1]==='#settings'));
bound.click({target:{closest:sel=>sel==='[data-switch]'?{dataset:{switch:'soundbox'}}:null}});
assert.equal(fakeLocation.hash,'#soundbox','Quick-action buttons must activate routed views');
assert.equal(rendered.filter(n=>n.classList.active).length,1);
fakeLocation.hash='#reports';
callbacks.popstate();
assert.equal(rendered.find(n=>n.id==='view-reports').classList.active,true,'Browser back must restore the route');
assert.equal(rendered.filter(n=>n.classList.active).length,1);
console.log('Merchant navigation, controls, white theme, auth, edge protection, checkout and no-demo invariants PASS');
