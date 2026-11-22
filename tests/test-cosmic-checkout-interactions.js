'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const uri='upi://pay?pa=merchant@oksbi&pn=Merchant&am=500.00&cu=INR&tn=Invoice';
function mount(status='PENDING',checkout='merchant',overrides={}){
 const nodes={},events={},created=[],stages=['initial','methods','qr','checking','receipt'].map(stage=>({dataset:{stage},hidden:stage!=='qr'}));
 const node=k=>nodes[k]||(nodes[k]={textContent:'',href:'#',disabled:true,hidden:true,dataset:{},attrs:{},events:{},
  addEventListener(k,v){this.events[k]=v},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
  removeAttribute(k){delete this.attrs[k]},replaceChildren(){this.children=[]},
  append(...children){this.children.push(...children)},insertAdjacentElement(_where,other){(this.inserted??=[]).push(other)},classList:{toggle(){}}});
 node('debitEvidenceDialog').showModal=function(){this.open=true};
 const data={status,utr:null,qr:null,prompt:0,proof:null,
  signal:{success:true,utrCandidate:'123456789012',eventState:'UTR_CANDIDATE_UNVERIFIED'},...overrides};
 const document={body:{dataset:{checkout}},visibilityState:'visible',getElementById:node,createElement:()=>{
   const element={textContent:'',hidden:false,events:{},attrs:{},
    setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},
    addEventListener(k,v){this.events[k]=v},
    insertAdjacentElement(_where,other){(this.inserted??=[]).push(other)}
   };
   created.push(element);return element;
  },
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
   if(url.includes('/api/payer-debit-evidence/'))return {ok:true,json:async()=>({
    success:true,debitVerified:false,paymentVerified:false,paymentStateChanged:false,
    orderId:'ORD_TEST_1234',debitEvidenceReceipt:data.debitEvidenceReceipt,
    receiptError:data.receiptError,
    evidence:data.evidence??(data.signal?.utrCandidate?[{utr:data.signal.utrCandidate,source:'BROWSER_RETURN_OBSERVATION',
      amountPaise:'50000',payeeVpa:'merchant@oksbi',authenticatedDebit:false}]:[]),
    state:data.signal?.utrCandidate?'UTR_CANDIDATE_OBSERVED_UNVERIFIED':'NO_AUTHENTICATED_PAYER_DEBIT_EVIDENCE'})};
   if(url.includes('/api/proofbridge/status/'))return {ok:Boolean(data.proof),
    status:data.proof?200:503,json:async()=>data.proof||{success:false}};
   if(url.includes('/api/quantum-signal/status/'))return {ok:Boolean(data.signal),
    status:data.signal?200:503,json:async()=>data.signal||{success:false}};
   if(url.includes('/api/ledger/'))return {ok:true,json:async()=>({
    status:data.status,utr:data.utr,challengeAmount:500})};
   throw Error('Unexpected fetch '+url);
 };
 window.DigitalCredential=function(){};
 vm.runInNewContext(source,{window,document,location,navigator:{credentials:{get(){data.prompt++;throw Error('Unexpected credential prompt')}},
   userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36'},
   URL,URLSearchParams,Date,Intl,console,fetch,setInterval:()=>1,clearInterval(){},
   sessionStorage:{getItem:()=>null,setItem(){}}});
 return {nodes,events,stages,data,created};
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
 assert.equal(running.nodes.vaultProceed.getAttribute('aria-disabled'),'true',
  'P2P copy must remain disabled before fresh verified payer and device attestation');
 assert.equal(running.nodes.qrTapToPay.getAttribute('aria-disabled'),'true');
 assert.equal(running.data.prompt,0);
 running.events.focus();await flush();
 assert.equal(active(running),'qr','Browser focus or scan alone is not a payment');
 running.data.status='SUCCESS';running.data.utr='123456789012';
 running.events.focus();await flush();
 assert.equal(active(running),'receipt','Ledger credit updates original browser from any paying device');
 const p2p=mount('PENDING','generic');await flush();
 assert.equal(typeof p2p.nodes.payerDebitCheck.events.click,'function',
   'P2P checkout must expose exactly one payer evidence check');
 assert.equal(p2p.nodes.payerDebitCheck.disabled,false,'Evidence check enabled after session loads');
 assert.ok(!p2p.created.some(element=>/observer|broker/i.test(element.textContent||'')),
  'Checkout must not offer any installed Android observer or broker');
 await p2p.nodes.payerDebitCheck.events.click();await flush();
 assert.match(p2p.nodes.payerDebitCheckStatus.textContent,/No authenticated debit evidence/i);
 assert.equal(active(p2p),'qr','Unverified debit cannot unlock receipt');
 assert.equal(p2p.data.prompt,0,'I Paid must not request another credential');
 assert.equal(p2p.nodes.debitEvidenceDialog.open,true,'Evidence status dialog remains available');
  const expired=mount('EXPIRED');await flush();
 assert.equal(active(expired),'qr');
 assert.equal(expired.nodes.qrTapToPay.href,'#');
 assert.equal(expired.nodes.qrTapToPay.getAttribute('aria-disabled'),'true');
 assert.equal(expired.data.qr,null,'Expired payment link must never show scannable QR');
 assert.match(expired.nodes.checkoutStatus.textContent,/expired/i);
 console.log('COSMIC_INTERACTIONS_PASS: QR-first, passive cross-device status, expired QR blocked');
})().catch(err=>{console.error(err);process.exitCode=1});
