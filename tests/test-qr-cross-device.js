'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const model=require('../public/cosmic-checkout-model.js');
const src=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const order='Order_GENERIC_123',token='b'.repeat(48);
const upi='upi://pay?pa=owner@oksbi&pn=Owner&am=1.00&cu=INR';
function open(sharedToken){
 const nodes={},events={},stages=['initial','methods','qr','checking','receipt'].map(stage=>({dataset:{stage},hidden:stage!=='qr'}));
 const node=k=>nodes[k]||(nodes[k]={textContent:'',href:'#',disabled:true,hidden:true,dataset:{},attrs:{},events:{},
  addEventListener(k,v){this.events[k]=v},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
  removeAttribute(k){delete this.attrs[k]},replaceChildren(){},classList:{toggle(){}}});
 const state={qr:null,links:[],ledger:'PENDING',shared:null};
 const document={body:{dataset:{checkout:'generic'}},visibilityState:'visible',getElementById:node,
  querySelectorAll:q=>q==='[data-stage]'?stages:[],addEventListener:(k,fn)=>events[k]=fn};
 const location={href:'https://disha.example/checkout?paymentRef='+order+'&token='+sharedToken,
  search:'?paymentRef='+order+'&token='+sharedToken};
 const navigator={userAgent:'Mozilla/5.0 (Linux; Android 15)',clipboard:{
  writeText:async text=>{state.shared=text}}};
 const window={DISHACosmicCheckoutModel:model,DISHAOneTouchVault:{
  getDeviceUserId(){throw Error('Shared checkout should not create a new customer')},
  getPendingOrderId:()=>null,requestEvidence:()=>null},
  QRCode:function(_,options){state.qr=options.text},addEventListener:(k,v)=>events[k]=v};
 window.QRCode.CorrectLevel={M:1};
 const fetch=async url=>{
   state.links.push(url);
   if(url.startsWith('/api/session/')){
    if(!url.includes('token='+token))return {ok:false,status:401,json:async()=>({success:false,error:'SESSION_TOKEN_REQUIRED'})};
    return {ok:true,json:async()=>({success:true,session:{
     orderId:order,sessionId:token,challengeAmount:1,expiresAt:Date.now()+180000,
     status:'PENDING',merchantType:'PERSONAL',vpaAddress:'owner@oksbi'},upiLink:upi})};
   }
   if(url.startsWith('/api/ledger/'))return {ok:true,json:async()=>({
    status:state.ledger,utr:state.ledger==='SUCCESS'?'123456789012':null})};
   throw Error('Unexpected fetch '+url);
 };
 vm.runInNewContext(src,{window,document,location,navigator,URL,URLSearchParams,Date,Intl,fetch,console,
  setInterval:()=>1,clearInterval(){},sessionStorage:{getItem:()=>null,setItem(){}}});
 return {nodes,events,stages,state};
}
async function flush(){for(let i=0;i<35;i++)await Promise.resolve()}
(async()=>{
 const phone=open(token);await flush();
 assert.equal(phone.stages.find(x=>!x.hidden).dataset.stage,'qr');
 assert.equal(phone.state.qr,null,'Personal Quantum Fusion must never render a QR');
 assert.equal(phone.nodes.proofbridgeGate.hidden,true,'Native Android host removes the old copy-to-pay consent gate');
 // P2P is copy-to-pay. No native intent or QR is dispatched.
 const qrHref=phone.nodes.qrTapToPay.href;
 assert.equal(qrHref,'#');
 assert.equal(phone.nodes.qrTapToPay.getAttribute('aria-disabled'),'true');
 assert.equal(phone.nodes.qrTapToPay.hidden,true,'P2P stays QR-free on Android');
 assert.equal(phone.nodes.upiAppOptions.hidden,false,'P2P exposes one-tap native UPI app choices');
 assert.equal(phone.nodes.qrTapToPay.hidden,true,'QR is hidden throughout personal checkout');
 assert.match(phone.nodes.paymentTrackingStatus.textContent,/Awaiting confirmation/,
   'Original browser shows that confirmation is pending when another phone scans');
 assert.ok(phone.state.links.includes('/api/session/'+order+'?token='+token));
 assert.ok(!phone.state.links.some(link=>link.includes('/api/session/new')));
 await phone.nodes.shareCheckout.events.click();
 assert.equal(new URL(phone.state.shared).searchParams.get('paymentRef'),order);
 phone.state.ledger='SUCCESS';phone.events.focus();await flush();
 assert.equal(phone.stages.find(x=>!x.hidden).dataset.stage,'qr',
  'Receiving ledger status is not the payer-side receipt trigger');
 const blocked=open('c'.repeat(48));await flush();
 assert.equal(blocked.nodes.qrTapToPay.href,'#');
 assert.equal(blocked.state.qr,null);
 assert.match(blocked.nodes.checkoutStatus.textContent,/Error/);
 console.log('QUANTUM_FUSION_CROSS_DEVICE_PASS: personal QR absent, session bearer preserved, no receipt on payee credit alone');
})().catch(err=>{console.error(err);process.exitCode=1});
