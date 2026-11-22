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
   if(url.includes('/api/session-evidence/pairing/issue'))return {ok:true,json:async()=>({
    success:true,ticket:'p'.repeat(43),expiresAt:Date.now()+60000
   })};
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
 assert.equal(running.nodes.vaultProceed.getAttribute('aria-disabled'),'false');
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
 const pairButton=p2p.created.find(element=>element.textContent==='Connect Android debit observer');
 assert.ok(pairButton,'Android checkout offers explicit observer pairing');
 await pairButton.events.click();await flush();
 const pairLink=p2p.created.find(element=>element.textContent==='Open DISHA observer on this phone');
 assert.match(pairLink?.href||'',/^https:\/\/disha8-2\.thenitishkr\.in\/android\/observer\/[A-Za-z0-9_-]{43}$/,
  'one-time ticket is handed to the canonical verified Android App Link');
 assert.ok(!pairLink.href.includes('a'.repeat(48)),
  'app handoff must not include checkout bearer token');

 await p2p.nodes.payerDebitCheck.events.click();await flush();
 assert.match(p2p.nodes.payerDebitCheckStatus.textContent,/NOT authenticated/i,
   'Browser return UTR must never certify bank debit');
 assert.match(p2p.nodes.payerDebitCheckReference.textContent,/Reported UTR: 123456789012/,
   'Observed reference can be displayed without a fabricated paid status');
 assert.equal(active(p2p),'qr','Unverified debit cannot unlock receipt');
 assert.equal(p2p.data.prompt,0,'I Paid must not request a browser credential');
 const observed=mount('PENDING','generic',{evidence:[{utr:'123456789012',referenceKind:'RRN',
   source:'DEVICE_OBSERVATION',payeeVpa:'merchant@oksbi',deviceSignatureVerified:true}]});
 await flush();await observed.nodes.payerDebitCheck.events.click();
 assert.match(observed.nodes.payerDebitCheckReference.textContent,/Observed RRN: 123456789012/);
 assert.match(observed.nodes.payerDebitCheckStatus.textContent,/device signature verified/i);
 assert.equal(observed.data.prompt,0);
 assert.equal(active(observed),'qr','A signed Android observation cannot unlock a bank receipt');
 assert.equal(observed.nodes.debitEvidenceDialogStatus.textContent,'Debit evidence not available yet');
 const qualified=mount('PENDING','generic',{debitEvidenceReceipt:{orderId:'ORD_TEST_1234',
   state:'DEBIT_EVIDENCE_OBSERVED',source:'com.phonepe.app',amountPaise:'50000',
   reference:'000000000123',referenceKind:'RRN',observedAt:Date.now(),receiptReference:'a'.repeat(64)}});
 await flush();await qualified.nodes.payerDebitCheck.events.click();
 assert.equal(qualified.nodes.debitEvidenceTitle.textContent,'DISHA Debit Evidence Receipt');
 assert.ok(qualified.nodes.debitEvidenceDialogFields.children.some(node=>node.textContent==='000000000123'));
 assert.equal(active(qualified),'qr');
 const untrustedDevice=mount('PENDING','generic',{
   receiptError:'TRUSTED_DEVICE_NOT_CONFIGURED',
   evidence:[{source:'DEVICE_OBSERVATION',deviceSignatureVerified:true,referenceKind:'RRN',
    utr:'000000000999',amountPaise:'50000',payeeVpa:'merchant@oksbi'}]
 });
 await flush();await untrustedDevice.nodes.payerDebitCheck.events.click();
 assert.equal(untrustedDevice.nodes.debitEvidenceTitle.textContent,'Unverified Android debit observation');
 assert.match(untrustedDevice.nodes.debitEvidenceDialogStatus.textContent,/bank debit remains unverified/i);
 assert.ok(untrustedDevice.nodes.debitEvidenceDialogFields.children.some(n=>n.textContent==='000000000999'));
 assert.equal(active(untrustedDevice),'qr','unverified device observation cannot mark checkout paid');
 const smsObserved=mount('PENDING','generic',{
  receiptError:'TRUSTED_DEVICE_NOT_CONFIGURED',
  evidence:[{source:'SMS_NOTIFICATION_UNVERIFIED',deviceSignatureVerified:true,referenceKind:'UTR',
    utr:'000000000998',amountPaise:'50000',payeeVpa:'merchant@oksbi'}]
 });
 await flush();await smsObserved.nodes.payerDebitCheck.events.click();
 assert.equal(smsObserved.nodes.debitEvidenceTitle.textContent,'Unverified Android debit observation');
 assert.ok(smsObserved.nodes.debitEvidenceDialogFields.children.some(n=>n.textContent==='SMS_NOTIFICATION_UNVERIFIED'));
 assert.equal(active(smsObserved),'qr','SMS sender label cannot verify payment');
 const smsReceipt=mount('PENDING','generic',{debitEvidenceReceipt:{
   ...qualified.data.debitEvidenceReceipt,source:'com.google.android.apps.messaging',
   sourceTrust:'SMS_NOTIFICATION_SENDER_UNVERIFIED'
 }});
 await flush();await smsReceipt.nodes.payerDebitCheck.events.click();
 assert.ok(smsReceipt.nodes.debitEvidenceDialogFields.children.some(n=>
   /Unverified SMS sender/.test(n.textContent||'')));
 assert.equal(active(smsReceipt),'qr','even pinned device cannot authenticate SMS sender');
 const crossOrder=mount('PENDING','generic',{debitEvidenceReceipt:{...qualified.data.debitEvidenceReceipt,orderId:'OTHER_ORDER'}});
 await flush();await crossOrder.nodes.payerDebitCheck.events.click();
 assert.match(crossOrder.nodes.debitEvidenceDialogStatus.textContent,/could not be validated/);
 assert.equal(crossOrder.nodes.debitEvidenceDialogFields.children.length,0);
 const unavailable=mount('PENDING','generic',{signal:null});await flush();
 await unavailable.nodes.payerDebitCheck.events.click();await flush();
 assert.match(unavailable.nodes.payerDebitCheckStatus.textContent,/No authenticated debit receipt/i);
 assert.equal(active(unavailable),'qr','Missing payer evidence is not payment confirmation');
 const spoofedIssuer=mount('PENDING','generic',{proof:{success:true,paymentVerified:true,
   payerDebitVerified:true,payerDebitEvidence:{utr:'123456789012',debitVerified:true}}});
 await flush();await spoofedIssuer.nodes.payerDebitCheck.events.click();await flush();
 assert.equal(active(spoofedIssuer),'qr',
   'The payer button must not accept issuer-signed claims as authentic bank debit');
  const expired=mount('EXPIRED');await flush();
 assert.equal(active(expired),'qr');
 assert.equal(expired.nodes.qrTapToPay.href,'#');
 assert.equal(expired.nodes.qrTapToPay.getAttribute('aria-disabled'),'true');
 assert.equal(expired.data.qr,null,'Expired payment link must never show scannable QR');
 assert.match(expired.nodes.checkoutStatus.textContent,/expired/i);
 console.log('COSMIC_INTERACTIONS_PASS: QR-first, passive cross-device status, expired QR blocked');
})().catch(err=>{console.error(err);process.exitCode=1});
