'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('public/payment-modes.html'),js=read('public/try-checkout.js');
const home=read('public/index.html');
for(const mode of ['P2P','P2M'])assert.match(html,new RegExp('data-payment-mode="'+mode+'"'));
assert.doesNotMatch(html,/<form\b|<input\b|id="tryAmount"|id="tryVpa"/i,
 'The customer must not type a receiving account or amount into the chooser');
assert.match(html,/Quantum Fusion/);
assert.match(html,/id="tryError"/);
assert.match(html,/id="tryStatus"/);
assert.match(html,/try-checkout\.js\?v=quantum-fusion-20261120/,'Selector must use cache-busted script');
assert.match(home,/href="\/choose-payment\?mode=P2P"/);
assert.match(home,/href="\/choose-payment\?mode=P2M"/);
assert.match(read('server.js'),/UNAUTHORIZED_PAYEE_VPA/,'Receiving account remains server-authorized');

function mount(search='?mode=P2P',reply={success:true,orderId:'ORDER_123456',sessionId:'b'.repeat(48),paymentType:'P2P'}){
 const listeners={},calls=[],nav=[],nodes={};
 const button=mode=>{
  const b={dataset:{paymentMode:mode},disabled:false,addEventListener(name,cb){listeners[mode+':'+name]=cb}};
  return b;
 };
 const buttons=[button('P2P'),button('P2M')];
 nodes.tryError={hidden:true,textContent:''};nodes.tryStatus={textContent:''};
 const document={querySelectorAll:q=>q==='[data-payment-mode]'?buttons:[],
  getElementById:id=>nodes[id]};
 const location={origin:'https://checkout.test',search,assign(url){nav.push(url)}};
 const fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>reply}};
 vm.runInNewContext(js,{document,location,URL,URLSearchParams,fetch,console});
 return {buttons,listeners,calls,nav,nodes};
}
async function flush(){for(let i=0;i<60;i++)await Promise.resolve()}
(async()=>{
 const p2p=mount();
 assert.equal(p2p.nav.length,0,'No transaction is created merely by opening selection');
 p2p.listeners['P2P:click']();await flush();
 assert.equal(p2p.calls.length,1,'One touch issues one authorized personal checkout');
 const url=new URL('https://checkout.test'+p2p.calls[0].url);
 assert.equal(url.pathname,'/api/session/new');
 assert.equal(url.searchParams.get('amount'),'1.00');
 assert.equal(url.searchParams.has('vpa'),false,'Never copy customer-substituted receiving UPI ID');
 const selected=new URL(p2p.nav[0],'https://checkout.test');
 assert.equal(selected.pathname,'/p2p');
 assert.equal(selected.searchParams.get('proofbridge'),'1');
 assert.equal(selected.searchParams.get('token'),'b'.repeat(48));

 const explicit=mount('?mode=P2P&amount=2.50&vpa=attacker@upi');
 explicit.listeners['P2P:click']();await flush();
 const input=new URL('https://checkout.test'+explicit.calls[0].url);
 assert.equal(input.searchParams.get('amount'),'2.50','Amount may be pre-issued in the payment link');
 assert.equal(input.searchParams.has('vpa'),false,'Ignore destination VPA supplied by payer URL');

 const invalid=mount('?mode=P2P&amount=abc');
 invalid.listeners['P2P:click']();await flush();
 assert.equal(invalid.calls.length,0);
 assert.equal(invalid.nav.length,0);
 assert.equal(invalid.nodes.tryError.hidden,false);

 const merchant=mount('?mode=P2M');
 merchant.listeners['P2M:click']();await flush();
 assert.equal(merchant.calls.length,0,'P2M must never create P2P session');
 assert.equal(merchant.nav[0],'/login?mode=P2M','Merchant order creation remains authenticated');

 const wrongClassification=mount('?mode=P2P',{success:true,orderId:'ORDER_123456',sessionId:'b'.repeat(48),paymentType:'P2M'});
 wrongClassification.listeners['P2P:click']();await flush();
 assert.equal(wrongClassification.nav.length,0,'Cannot open merchant account in personal checkout');

 console.log('TRY_CHECKOUT_FORM_PASS: one-touch selection, no payer inputs, secure P2P/P2M separation');
})().catch(err=>{console.error(err);process.exitCode=1});
