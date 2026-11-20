'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('public/payment-modes.html'),js=read('public/try-checkout.js'),home=read('public/index.html');
for(const id of ['tryCheckoutForm','tryAmount','tryVpa','tryError'])assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
for(const m of ['P2P','P2M'])assert.ok(html.includes('data-payment-mode="'+m+'"'));
assert.ok(js.includes("fetch('/api/session/new?"),'P2P creates original session before QR');
assert.ok(js.includes("checkout.searchParams.set('orderId'"),'Carry created order not a new one');
assert.ok(js.includes("checkout.searchParams.set('proofbridge','1')"),'P2P selector must enable copy-only ProofBridge');
assert.ok(js.includes("if(params.get('qs')==='1')"),'Quantum telemetry remains opt-in');
assert.ok(js.includes('disha82:merchant-prefill'),'P2M passes prefill to authorized workspace');
assert.ok(js.includes("location.assign('/login?mode=P2M')"),'P2M auth gate');
assert.ok(js.includes("result.error==='UNAUTHORIZED_PAYEE_VPA'"),'Do not allow unrelated payees');
assert.ok(read('server.js').includes('UNAUTHORIZED_PAYEE_VPA'),'Server enforces allowed receiver');
assert.ok(read('public/premium-dashboard.js').includes('applyTryCheckoutPrefill()'));
assert.ok(home.includes('href="/choose-payment?mode=P2P"'));
assert.ok(home.includes('href="/choose-payment?mode=P2M"'));
assert.match(html,/id="tryVpaLabel"/,'Explicit P2P receiver field must reflect optional server default');
assert.match(html,/Continue to P2P consent/,'Describe the next step, not a failing P2P intent');
assert.match(html,/try-checkout\.js\?v=proofbridge-selector-20261120/,'P2P chooser must load fresh JS, not cached ponytail-1');

const vm=require('node:vm');
function runChooser(search='?mode=P2P',payee=''){
 const events={};
 const el=(id,initial={})=>({id,textContent:'',hidden:false,value:'',disabled:false,required:false,
  dataset:{},classList:{toggle(){}},setAttribute(){},addEventListener(name,cb){events[id+':'+name]=cb},...initial});
 const amount=el('tryAmount',{value:'1.00'});
 const vpa=el('tryVpa',{value:payee});
 const error=el('tryError',{hidden:true});
 const status=el('modeDescription'),label=el('tryVpaLabel');
 const submit=el('submit',{textContent:'Continue to P2P consent'});
 const p2p=el('p2p',{dataset:{paymentMode:'P2P'}}),p2m=el('p2m',{dataset:{paymentMode:'P2M'}});
 const form=el('tryCheckoutForm',{querySelector:()=>submit,querySelectorAll:()=>[p2p,p2m]});
 const elements={tryCheckoutForm:form,tryAmount:amount,tryVpa:vpa,tryError:error,
  modeDescription:status,tryVpaLabel:label};
 const nav=[],requests=[],saved=[];
 const location={origin:'https://checkout.example',search,assign(v){nav.push(v)}};
 const fetch=async(url)=>{requests.push(url);return {ok:true,json:async()=>({
  success:true,orderId:'ORDER_123456',sessionId:'b'.repeat(48)})}};
 vm.runInNewContext(js,{document:{getElementById:id=>elements[id]||null},location,
  URL,URLSearchParams,fetch,sessionStorage:{setItem:(k,v)=>saved.push({k,v})},console});
 return {events,nav,requests,saved,amount,vpa,error,status,label,submit};
}
(async()=>{
 const p=runChooser('?mode=P2P');
 assert.equal(p.vpa.required,false,'Owner P2P receiver is already configured on server');
 assert.match(p.label.textContent,/optional for P2P/);
 await p.events['tryCheckoutForm:submit']({preventDefault(){}});
 assert.equal(p.requests.length,1,'Creates exactly one P2P order');
 const api=new URL('https://checkout.example'+p.requests[0]);
 assert.equal(api.pathname,'/api/session/new');
 assert.equal(api.searchParams.get('amount'),'1.00');
 assert.equal(api.searchParams.has('vpa'),false,'Empty receiving ID uses backend-authorized default');
 assert.equal(p.nav.length,1);
 const destination=new URL(p.nav[0],'https://checkout.example');
 assert.equal(destination.pathname,'/p2p');
 assert.equal(destination.searchParams.get('proofbridge'),'1','Must not regress to QR-only P2P');
 assert.equal(destination.searchParams.get('orderId'),'ORDER_123456');
 assert.equal(destination.searchParams.get('token'),'b'.repeat(48));
 assert.equal(destination.searchParams.has('qs'),false,'No unrequested QS prompts');

 const p2m=runChooser('?mode=P2M','merchant@ypbiz');
 assert.equal(p2m.vpa.required,true,'Merchant payee remains explicit');
 await p2m.events['tryCheckoutForm:submit']({preventDefault(){}});
 assert.deepEqual(p2m.requests,[],'P2M never creates a P2P session');
 assert.equal(p2m.nav[0],'/login?mode=P2M');
 assert.equal(p2m.saved.length,1);

 const required=runChooser('?mode=P2M');
 await required.events['tryCheckoutForm:submit']({preventDefault(){}});
 assert.equal(required.nav.length,0,'Missing merchant UPI ID is not silently defaulted');
 assert.equal(required.error.hidden,false);

 const optionalExplicit=runChooser('?mode=P2P','receiver@oksbi');
 await optionalExplicit.events['tryCheckoutForm:submit']({preventDefault(){}});
 const explicitApi=new URL('https://checkout.example'+optionalExplicit.requests[0]);
 assert.equal(explicitApi.searchParams.get('vpa'),'receiver@oksbi',
  'Explicit P2P receiving ID must still pass backend authorization');
 console.log('TRY_CHECKOUT_FORM_PASS: selector P2P → signed consent page; P2M gated; no accidental QR entry');
})().catch(err=>{console.error(err);process.exitCode=1});