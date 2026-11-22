'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const model=require('../public/cosmic-checkout-model.js');
const script=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const token='b'.repeat(48),id='ORD_PROOFBRIDGE_TEST_1234',upi='upi://pay?pa=receiver@oksbi&pn=Receiver&am=500.00&cu=INR';
const ticket={protocol:'DISHA-PROOF-TICKET-V2',orderId:id,nonce:'a'.repeat(40),
 amountPaise:'50000',payeeVpa:'receiver@oksbi',paymentType:'P2P',
 merchantCategory:'',merchantReference:'',paymentUriHash:'c'.repeat(64),
 expiresAt:Date.now()+90000};
function launch(tampered=false,kind='P2P',checkoutMode='merchant'){
 const merchantUri='upi://pay?pa=business@ypbiz&pn=Business&am=500.00&cu=INR&mc=5411&tr=INV500';
 const selectedUri=kind==='P2M'?merchantUri:upi;
 const selectedPayee=kind==='P2M'?'business@ypbiz':'receiver@oksbi';
 const selectedTicket={...ticket,payeeVpa:selectedPayee,paymentType:kind,
  merchantCategory:kind==='P2M'?'5411':'',merchantReference:kind==='P2M'?'INV500':''};
 const elems={},events={},stages=['qr','receipt'].map(k=>({dataset:{stage:k},hidden:k!=='qr'}));
 const node=k=>elems[k]||(elems[k]={id:k,hidden:true,disabled:false,checked:false,href:'#',
  dataset:{},attrs:{},textContent:'',events:{},classList:{toggle(){}},
  addEventListener(name,cb){this.events[name]=cb},
  setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
  removeAttribute(k){delete this.attrs[k]},replaceChildren(){}});
 const body={dataset:{checkout:checkoutMode}},doc={body,visibilityState:'visible',
  getElementById:node,querySelectorAll:q=>q==='[data-stage]'?stages:[],
  addEventListener(name,cb){events[name]=cb}};
 const route=checkoutMode==='generic'?'/p2p':'/merchant-checkout.html';
 const location={href:'https://example.test'+route+'?orderId='+id+'&token='+token+'&proofbridge=1',
  search:'?orderId='+id+'&token='+token+'&proofbridge=1',pathname:route};
 const data={ledger:'PENDING',utr:null,claim:null,debitConfirmed:false,
  payerTransactionId:'PAYER-TXN-20261120',qr:null,copied:[],auth:0,polls:0};
 const fetch=async(url,options)=>{
  if(url.includes('/api/session/'))return {ok:true,json:async()=>({success:true,
   session:{orderId:id,txnRef:'SRVTEST123',challengeAmount:500,expiresAt:Date.now()+140000,
    merchantType:'P2P',vpaAddress:selectedPayee,status:'PENDING'},upiLink:selectedUri})};
  if(url.includes('/api/merchant/public/order/'))return {ok:true,json:async()=>({success:true,order:{
   id,upi_uri:selectedUri,amount:500,payment_type:kind,vpa_address:selectedPayee,
   expires_at:Date.now()+140000,status:'PENDING'}})};
  if(url.includes('/api/p2p/prepayment/authorize')){
   assert.equal(options.headers['X-CSRF-Token'],token);
   return {ok:true,json:async()=>({authorized:true,orderId:id,expiresAt:Date.now()+90000})};
  }
  if(url.includes('/api/proofbridge/authorize')){
   data.auth++;
   assert.equal(options.headers['X-CSRF-Token'],token);
   assert.equal(JSON.parse(options.body).consent,true);
   return {ok:true,json:async()=>({success:true,orderId:id,
    upiUri:tampered?selectedUri.replace(selectedPayee,'attacker@oksbi'):selectedUri,
    ticket:selectedTicket,ticketSignature:'1'.repeat(64),ticketHash:'2'.repeat(64),
    expiresAt:selectedTicket.expiresAt})};
  }
  if(url.includes('/api/proofbridge/status/')){
   data.polls++;
   return {ok:true,json:async()=>({success:true,evidenceState:data.claim?'UTR_OBSERVED_UNVERIFIED':'AWAITING_EVIDENCE',
    payerDebitVerified:data.debitConfirmed,paymentVerified:data.debitConfirmed,utrCandidate:data.claim,
    payerDebitEvidence:data.claim?{utr:data.claim,payerTransactionId:data.payerTransactionId,
     issuerId:'payer-app-test',claimedPaidAt:Date.now(),
     evidenceState:data.debitConfirmed?'PAYER_DEBIT_VERIFIED':'PAYER_DEBIT_CLAIM_UNVERIFIED',
     debitVerified:data.debitConfirmed}:null})};
  }
  if(url.includes('/api/ledger/'))return {ok:true,json:async()=>({
   success:true,status:data.ledger,utr:data.utr,challengeAmount:500})};
  throw Error('Unexpected '+url);
 };
 const window={isSecureContext:true,DISHACosmicCheckoutModel:model,
  DISHAOneTouchVault:{getPendingOrderId:()=>null,requestEvidence:()=>null,
   authorize:async()=>({sessionId:'a'.repeat(32)})},
  QRCode:function(_,opts){data.qr=opts.text},addEventListener(k,v){events[k]=v}};
 window.QRCode.CorrectLevel={M:1};
 const navigator={userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',clipboard:{
  async writeText(v){data.copied.push(v)}}};
 vm.runInNewContext(script,{window,document:doc,location,navigator,URL,URLSearchParams,
  Date,Intl,console,fetch,setInterval:()=>7,clearInterval(){},sessionStorage:{getItem:()=>null,setItem(){}},
  setTimeout:()=>1});
 return {elems,events,stages,data,selectedUri,selectedPayee};
}
async function flush(){for(let i=0;i<55;i++)await Promise.resolve()}
(async()=>{
 const app=launch();await flush();
 assert.equal(app.elems.proofbridgeGate.hidden,false);
 assert.equal(app.elems.proofbridgeProceed.disabled,true);
 assert.equal(app.data.qr,null,'No QR without explicit consent');
 assert.equal(app.elems.qrTapToPay.hidden,true,'P2P QR hidden before consent');
 app.elems.proofbridgeConsent.checked=true;
 app.elems.proofbridgeConsent.events.change();await flush();
 assert.equal(app.data.auth,1,'Consent invokes server-bound authorization');
 assert.equal(app.elems.proofbridgeProceed.disabled,false);
 assert.equal(app.data.qr,null,'Authorization alone does not reveal QR');
 app.elems.proofbridgeProceed.events.click();await flush();
 assert.deepEqual(app.data.copied,['receiver@oksbi'],'One Proceed tap copies exactly authorized payee');
 assert.equal(app.data.qr,null,'P2P QR must remain absent after Proceed');
 assert.equal(app.elems.qrTapToPay.hidden,true,'P2P QR container must be hidden');
 assert.equal(app.elems.qrExpiry.hidden,true,'P2P QR expiry text hidden');
 assert.match(app.elems.paymentStageCopy.textContent,/Receiving details copied/);
 assert.equal(app.elems.copyHandoff.hidden,false,'One touch displays copy confirmation without revealing payee');
 assert.equal(app.elems.copiedPayee.textContent,'Receiving UPI ID copied securely');
 assert.equal(app.elems.proofbridgeGate.hidden,true);
 assert.equal(app.stages.find(x=>!x.hidden)?.dataset.stage,'qr');
 app.data.claim='123456789012';
 app.events.focus();await flush();
 assert.match(app.elems.proofbridgeEvidence.textContent,/123456789012/);
 assert.match(app.elems.proofbridgeEvidence.textContent,/NOT independently debit-verified/);
 assert.equal(app.elems.payerDebitEvidence.hidden,false,'Payer reference is separately recorded');
 assert.equal(app.elems.payerUtrCandidate.textContent,'123456789012');
 assert.match(app.elems.payerDebitEvidenceStatus.textContent,/not independently verified/i);
 assert.equal(app.stages.find(x=>!x.hidden)?.dataset.stage,'qr','Claim never triggers financial receipt');
 app.data.ledger='SUCCESS';app.data.utr='123456789012';
 app.events.focus();await flush();
 assert.equal(app.stages.find(x=>!x.hidden)?.dataset.stage,'receipt','Real ledger-confirmed state governs final receipt');

 const payer=launch(false,'P2P','generic');await flush();
 // The generic payer lane requires completed server-side trust authorization.
 await payer.elems.p2pPrepaymentAuthenticate.events.click();await flush();
 assert.match(payer.elems.p2pPrepaymentStatus.textContent,/checks verified/);
 assert.equal(payer.elems.proofbridgeProceed.disabled,true,
  'Prepayment trust alone cannot bypass ProofBridge consent');

 assert.equal(payer.elems.serviceIdentifier.textContent,'Service ID · SRVTEST123');
 payer.elems.proofbridgeConsent.checked=true;
 payer.elems.proofbridgeConsent.events.change();await flush();
 payer.elems.proofbridgeProceed.events.click();await flush();
 payer.data.claim='999888777666';
 payer.events.focus();await flush();
 assert.equal(payer.elems.payerUtrCandidate.textContent,'999888777666');
 assert.equal(payer.elems.payerTransactionIdCandidate.textContent,'PAYER-TXN-20261120');
 assert.equal(payer.stages.find(x=>!x.hidden)?.dataset.stage,'qr',
  'A signed claim alone never becomes a payer receipt');
 payer.data.debitConfirmed=true;
 payer.events.focus();await flush();
 assert.equal(payer.stages.find(x=>!x.hidden)?.dataset.stage,'receipt',
  'Authenticated payer debit produces a receipt without beneficiary credit');
 assert.equal(payer.elems.receiptUtr.textContent,'999888777666');
 assert.equal(payer.elems.receiptPayerTxn.textContent,'PAYER-TXN-20261120');
 assert.equal(payer.elems.receiptPaymentRef.textContent,'SRVTEST123');
 assert.equal(payer.elems.receiptVerifiedStatus.textContent,'Debit confirmed');
 assert.equal(payer.data.ledger,'PENDING','Receipt is not tied to beneficiary credit');

 const attack=launch(true);await flush();
 attack.elems.proofbridgeConsent.checked=true;attack.elems.proofbridgeConsent.events.change();await flush();
 assert.equal(attack.elems.proofbridgeProceed.disabled,true,'Mismatched server UPI URI blocks checkout');
 assert.equal(attack.data.copied.length,0);
 assert.equal(attack.data.qr,null);
 const merchant=launch(false,'P2M');await flush();
 assert.equal(merchant.elems.proofbridgeProceed.disabled,true);
 merchant.elems.proofbridgeConsent.checked=true;
 merchant.elems.proofbridgeConsent.events.change();await flush();
 assert.equal(merchant.elems.proofbridgeProceed.disabled,false,'Merchant classification passes signed preflight');
 merchant.elems.proofbridgeProceed.events.click();await flush();
 assert.deepEqual(merchant.data.copied,['business@ypbiz'],'Merchant payee copied without altering MCC');
 assert.equal(merchant.data.qr,merchant.selectedUri,'Merchant QR preserves MCC and transaction reference');
 assert.equal(merchant.elems.qrTapToPay.hidden,false,'P2M QR must stay visible');
 assert.equal(merchant.stages.find(x=>!x.hidden)?.dataset.stage,'qr');
 const conflict=launch(true,'P2M');await flush();
 conflict.elems.proofbridgeConsent.checked=true;
 conflict.elems.proofbridgeConsent.events.change();await flush();
 assert.equal(conflict.elems.proofbridgeProceed.disabled,true,'P2M mismatched receiving VPA blocked');
 assert.equal(conflict.data.copied.length,0);
 console.log('PROOFBRIDGE_WEB_PASS: consent preflight, gesture-bound copy, return UTR claim, no false credit, payload mismatch blocked');
})().catch(e=>{console.error(e);process.exitCode=1});
