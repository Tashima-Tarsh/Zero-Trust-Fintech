'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const model=require('../public/cosmic-checkout-model.js');
const script=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const token='b'.repeat(48),id='ORD_PROOFBRIDGE_TEST_1234',upi='upi://pay?pa=receiver@oksbi&pn=Receiver&am=500.00&cu=INR';
const ticket={protocol:'DISHA-PROOF-TICKET-V1',orderId:id,nonce:'a'.repeat(40),
 amountPaise:'50000',payeeVpa:'receiver@oksbi',paymentUriHash:'c'.repeat(64),
 expiresAt:Date.now()+90000};
function launch(tampered=false){
 const elems={},events={},stages=['qr','receipt'].map(k=>({dataset:{stage:k},hidden:k!=='qr'}));
 const node=k=>elems[k]||(elems[k]={id:k,hidden:true,disabled:false,checked:false,href:'#',
  dataset:{},attrs:{},textContent:'',events:{},classList:{toggle(){}},
  addEventListener(name,cb){this.events[name]=cb},
  setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
  removeAttribute(k){delete this.attrs[k]},replaceChildren(){}});
 const body={dataset:{checkout:'merchant'}},doc={body,visibilityState:'visible',
  getElementById:node,querySelectorAll:q=>q==='[data-stage]'?stages:[],
  addEventListener(name,cb){events[name]=cb}};
 const location={href:'https://example.test/merchant-checkout.html?orderId='+id+'&token='+token+'&proofbridge=1',
  search:'?orderId='+id+'&token='+token+'&proofbridge=1',pathname:'/merchant-checkout.html'};
 const data={ledger:'PENDING',utr:null,claim:null,qr:null,copied:[],auth:0,polls:0};
 const fetch=async(url,options)=>{
  if(url.includes('/api/merchant/public/order/'))return {ok:true,json:async()=>({success:true,order:{
   id,upi_uri:upi,amount:500,payment_type:'P2P',vpa_address:'receiver@oksbi',
   expires_at:Date.now()+140000,status:'PENDING'}})};
  if(url.includes('/api/proofbridge/authorize')){
   data.auth++;
   assert.equal(options.headers['X-CSRF-Token'],token);
   assert.equal(JSON.parse(options.body).consent,true);
   return {ok:true,json:async()=>({success:true,orderId:id,
    upiUri:tampered?upi.replace('receiver@oksbi','attacker@oksbi'):upi,
    ticket,ticketSignature:'1'.repeat(64),ticketHash:'2'.repeat(64),
    expiresAt:ticket.expiresAt})};
  }
  if(url.includes('/api/proofbridge/status/')){
   data.polls++;
   return {ok:true,json:async()=>({success:true,evidenceState:data.claim?'UTR_OBSERVED_UNVERIFIED':'AWAITING_EVIDENCE',
    paymentVerified:false,utrCandidate:data.claim})};
  }
  if(url.includes('/api/ledger/'))return {ok:true,json:async()=>({
   success:true,status:data.ledger,utr:data.utr,challengeAmount:500})};
  throw Error('Unexpected '+url);
 };
 const window={isSecureContext:true,DISHACosmicCheckoutModel:model,
  DISHAOneTouchVault:{getPendingOrderId:()=>null,requestEvidence:()=>null},
  QRCode:function(_,opts){data.qr=opts.text},addEventListener(k,v){events[k]=v}};
 window.QRCode.CorrectLevel={M:1};
 const navigator={userAgent:'Mozilla/5.0 (Linux; Android 16)',clipboard:{
  async writeText(v){data.copied.push(v)}}};
 vm.runInNewContext(script,{window,document:doc,location,navigator,URL,URLSearchParams,
  Date,Intl,console,fetch,setInterval:()=>7,clearInterval(){},sessionStorage:{getItem:()=>null,setItem(){}},
  setTimeout:()=>1});
 return {elems,events,stages,data};
}
async function flush(){for(let i=0;i<55;i++)await Promise.resolve()}
(async()=>{
 const app=launch();await flush();
 assert.equal(app.elems.proofbridgeGate.hidden,false);
 assert.equal(app.elems.proofbridgeProceed.disabled,true);
 assert.equal(app.data.qr,null,'No QR without explicit consent');
 app.elems.proofbridgeConsent.checked=true;
 app.elems.proofbridgeConsent.events.change();await flush();
 assert.equal(app.data.auth,1,'Consent invokes server-bound authorization');
 assert.equal(app.elems.proofbridgeProceed.disabled,false);
 assert.equal(app.data.qr,null,'Authorization alone does not reveal QR');
 app.elems.proofbridgeProceed.events.click();await flush();
 assert.deepEqual(app.data.copied,['receiver@oksbi'],'One Proceed tap copies exactly authorized payee');
 assert.equal(app.data.qr,upi);
 assert.equal(app.elems.proofbridgeGate.hidden,true);
 assert.equal(app.stages.find(x=>!x.hidden)?.dataset.stage,'qr');
 app.data.claim='123456789012';
 app.events.focus();await flush();
 assert.match(app.elems.proofbridgeEvidence.textContent,/123456789012/);
 assert.match(app.elems.proofbridgeEvidence.textContent,/NOT bank-verified/);
 assert.equal(app.stages.find(x=>!x.hidden)?.dataset.stage,'qr','Claim never triggers financial receipt');
 app.data.ledger='SUCCESS';app.data.utr='123456789012';
 app.events.focus();await flush();
 assert.equal(app.stages.find(x=>!x.hidden)?.dataset.stage,'receipt','Real ledger-confirmed state governs final receipt');

 const attack=launch(true);await flush();
 attack.elems.proofbridgeConsent.checked=true;attack.elems.proofbridgeConsent.events.change();await flush();
 assert.equal(attack.elems.proofbridgeProceed.disabled,true,'Mismatched server UPI URI blocks checkout');
 assert.equal(attack.data.copied.length,0);
 assert.equal(attack.data.qr,null);
 console.log('PROOFBRIDGE_WEB_PASS: consent preflight, gesture-bound copy, return UTR claim, no false credit, payload mismatch blocked');
})().catch(e=>{console.error(e);process.exitCode=1});
