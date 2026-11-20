'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const uri='upi://pay?pa=merchant@oksbi&pn=Merchant&am=500.00&cu=INR&tn=Invoice';
function mount(status='PENDING',checkout='merchant'){
 const nodes={},events={},stages=['initial','methods','qr','checking','receipt'].map(stage=>({dataset:{stage},hidden:stage!=='qr'}));
 const node=k=>nodes[k]||(nodes[k]={textContent:'',href:'#',disabled:true,hidden:true,dataset:{},attrs:{},events:{},
  addEventListener(k,v){this.events[k]=v},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
  removeAttribute(k){delete this.attrs[k]},replaceChildren(){},classList:{toggle(){}}});
 const data={status,utr:null,qr:null,prompt:0};
 const document={body:{dataset:{checkout}},visibilityState:'visible',getElementById:node,
  querySelectorAll:q=>q==='[data-stage]'?stages:[],addEventListener:(k,v)=>events[k]=v};
 const location={href:'https://checkout.example/merchant-checkout.html?orderId=ORD_TEST_1234&token='+('a'.repeat(48)),
  search:'?orderId=ORD_TEST_1234&token='+('a'.repeat(48))};
 const window={DISHACosmicCheckoutModel:model,DISHAOneTouchVault:{getPendingOrderId:()=>null,requestEvidence:()=>null,
  authorize(){data.prompt++;throw Error('Unexpected credential prompt')}},
  QRCode:function(_,options){data.qr=options.text},addEventListener:(k,v)=>events[k]=v};
 window.QRCode.CorrectLevel={M:1};
 const fetch=async url=>{
   if(url.includes('/api/merchant/public/order/'))return {ok:true,json:async()=>({success:true,order:{
    id:'ORD_TEST_1234',upi_uri:uri,amount:500,expires_at:Date.now()+180000,status}})};
   if(url.includes('/api/session/'))return {ok:true,json:async()=>({success:true,session:{
    orderId:'ORD_TEST_1234',challengeAmount:500,expiresAt:Date.now()+180000,status:'PENDING',
    merchantType:'PERSONAL',vpaAddress:'merchant@oksbi',txnRef:'SERVICE_TEST'
   },upiLink:uri})};
   if(url.includes('/api/proofbridge/status/'))return {ok:false,status:503,json:async()=>({success:false})};
   if(url.includes('/api/quantum-signal/status/'))return {ok:true,json:async()=>({
    success:true,utrCandidate:'123456789012',eventState:'UTR_CANDIDATE_UNVERIFIED'
   })};
   if(url.includes('/api/ledger/'))return {ok:true,json:async()=>({
    status:data.status,utr:data.utr,challengeAmount:500})};
   throw Error('Unexpected fetch '+url);
 };
 vm.runInNewContext(source,{window,document,location,navigator:{userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36'},
   URL,URLSearchParams,Date,Intl,console,fetch,setInterval:()=>1,clearInterval(){},
   sessionStorage:{getItem:()=>null,setItem(){}}});
 return {nodes,events,stages,data};
}
async function flush(){for(let i=0;i<35;i++)await Promise.resolve()}
const active=app=>app.stages.find(s=>!s.hidden)?.dataset.stage;
(async()=>{
 const running=mount();await flush();
 assert.equal(active(running),'qr');
 assert.equal(running.data.qr,null);
 // Personal P2P is QR-free; the Android native host is exposed through app choices.
 const qrHref=running.nodes.qrTapToPay.href;
 assert.equal(qrHref,'#');
 assert.equal(running.nodes.qrTapToPay.hidden,true);
 assert.equal(running.nodes.upiAppOptions.hidden,true,'P2P must not present app-launch buttons');
 assert.equal(running.nodes.vaultProceed.hidden,false,'Android Chrome P2P must show Copy UPI ID');
 assert.equal(running.nodes.vaultProceed.href,'#','P2P must not dispatch an Android intent');
 assert.equal(running.nodes.vaultProceed.textContent,'Copy UPI ID');
 assert.equal(running.nodes.vaultProceed.getAttribute('aria-disabled'),'false');
 assert.equal(running.nodes.qrTapToPay.getAttribute('aria-disabled'),'true');
 assert.equal(running.data.prompt,0);
 running.events.focus();await flush();
 assert.equal(active(running),'qr','Browser focus or scan alone is not a payment');
 running.data.status='SUCCESS';running.data.utr='123456789012';
 running.events.focus();await flush();
 assert.equal(active(running),'receipt','Ledger credit updates original browser from any paying device');
 const p2p=mount('PENDING','generic');await flush();
 assert.equal(p2p.nodes.debitProofCheck.hidden,false,'P2P proof check should be visible');
 assert.equal(active(p2p),'qr','P2P starts in original checkout');
 assert.equal(typeof p2p.nodes.debitProofCheckButton.events.click,'function');
 await p2p.nodes.debitProofCheckButton.events.click();await flush();
 assert.match(p2p.nodes.debitProofCheckStatus.textContent,/unverified/i,
   'I Paid must not certify a debit without issuer evidence');
 assert.match(p2p.nodes.debitProofCheckUtr.textContent,/Reported UTR \(not verified\)/,
   'Returned UTR candidates must remain explicitly unverified');
 assert.equal(active(p2p),'qr','Unverified debit must not unlock receipt');
  const expired=mount('EXPIRED');await flush();
 assert.equal(active(expired),'qr');
 assert.equal(expired.nodes.qrTapToPay.href,'#');
 assert.equal(expired.nodes.qrTapToPay.getAttribute('aria-disabled'),'true');
 assert.equal(expired.data.qr,null,'Expired payment link must never show scannable QR');
 assert.match(expired.nodes.checkoutStatus.textContent,/expired/i);
 console.log('COSMIC_INTERACTIONS_PASS: QR-first, passive cross-device status, expired QR blocked');
})().catch(err=>{console.error(err);process.exitCode=1});
