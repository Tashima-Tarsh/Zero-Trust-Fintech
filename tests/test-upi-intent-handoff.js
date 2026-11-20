'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const uri='upi://pay?pa=merchant@ypbiz&pn=Merchant&am=1.00&cu=INR&mc=5411&tr=SRVINTENTTEST';
const order='ORD_INTENT_TEST_11',token='a'.repeat(48);
function start(userAgent){
 const nodes={},events={},stages=['initial','methods','qr','checking','receipt'].map(stage=>({dataset:{stage},hidden:stage!=='qr'}));
 const node=x=>nodes[x]||(nodes[x]={textContent:'',href:'#',disabled:true,hidden:true,dataset:{},attrs:{},events:{},
  addEventListener(k,fn){this.events[k]=fn},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
  removeAttribute(k){delete this.attrs[k]},replaceChildren(){},classList:{toggle(){}}});
 const state={qr:null,shared:null,ledger:'PENDING',utr:null,prompt:0};
 const appNodes=['gpay','phonepe','paytm','bhim'].map(app=>Object.assign(node('app-'+app),{dataset:{upiApp:app}}));
 const document={body:{dataset:{checkout:'merchant'}},visibilityState:'visible',getElementById:node,
  querySelectorAll:q=>q==='[data-stage]'?stages:q==='[data-upi-app]'?appNodes:[],addEventListener:(k,fn)=>events[k]=fn};
 const location={origin:'https://checkout.example',href:'https://checkout.example/merchant-checkout.html?orderId='+order+'&token='+token,
  search:'?orderId='+order+'&token='+token};
 const navigator={userAgent,clipboard:{writeText:async x=>{state.shared=x}}};
 const window={DISHACosmicCheckoutModel:model,DISHAOneTouchVault:{
  getPendingOrderId:()=>null,requestEvidence:()=>null,authorize:()=>{state.prompt++;throw Error('Passkey prompt not requested')}},
  QRCode:function(_,p){state.qr=p.text},addEventListener:(k,fn)=>events[k]=fn};
 window.QRCode.CorrectLevel={M:1};
 const fetch=async url=>{
  if(url.startsWith('/api/merchant/public/order/'))return {ok:true,json:async()=>({success:true,order:{
   id:order,upi_uri:uri,amount:1,expires_at:Date.now()+180000,status:'PENDING',payment_type:'P2M',vpa_address:'merchant@ypbiz'}})};
  if(url.startsWith('/api/ledger/'))return {ok:true,json:async()=>({status:state.ledger,utr:state.utr,challengeAmount:1})};
  throw Error('Unexpected fetch '+url);
 };
 vm.runInNewContext(source,{window,document,location,navigator,URL,URLSearchParams,Date,Intl,fetch,console,
  sessionStorage:{getItem:()=>null,setItem(){}},setInterval:()=>1,clearInterval(){}});
 return {nodes,state,events,stages,document,appNodes};
}
async function flush(){for(let i=0;i<35;i++)await Promise.resolve()}
(async()=>{
 const mobile=start('Mozilla/5.0 (Linux; Android 15) Chrome/157');
 await flush();
 assert.equal(mobile.stages.find(x=>!x.hidden).dataset.stage,'qr');
 assert.equal(mobile.state.qr,uri);
 assert.equal(mobile.nodes.upiAppOptions.hidden,false,'Chrome Android provides explicit UPI app routing');
 for(const link of mobile.appNodes){
  assert.match(link.href,/package=in\.disha\.upihost;/,
   'Selected app must be routed through the installed DISHA result host');
  const params=new URLSearchParams(link.href.split('?')[1].split('#')[0]);
  assert.equal(params.get('upiPackage'),({
   gpay:'com.google.android.apps.nbu.paisa.user',phonepe:'com.phonepe.app',
   paytm:'net.one97.paytm',bhim:'in.org.npci.upiapp'
  })[link.dataset.upiApp]);
  assert.equal(link.getAttribute('aria-disabled'),'false');
 }
 assert.match(mobile.appNodes[0].href,/package=in\.disha\.upihost;/);
 const mobileTap=mobile.nodes.qrTapToPay.href;
 assert.match(mobileTap,/^intent:\/\/pay\?/,'Chrome uses Android Intent URI');
 assert.equal(mobile.state.qr,uri,'Scannable QR must retain raw UPI intent');
 const mainParams=new URLSearchParams(mobileTap.split('?')[1].split('#')[0]);
 assert.equal(mainParams.get('upiPackage'),'com.google.android.apps.nbu.paisa.user');
 assert.equal(new URL(mainParams.get('upiUri')).searchParams.get('pa'),'merchant@ypbiz');
 assert.match(mobileTap,/#Intent;scheme=disha;package=in\.disha\.upihost;/);
 assert.ok(decodeURIComponent(mobileTap.match(/S\.browser_fallback_url=([^;]+)/)[1]).includes(
  'paymentRef='+order),'Fallback recovers the original payment');
 assert.equal(mobile.nodes.qrTapToPay.getAttribute('aria-disabled'),'false');
 assert.ok(mobile.nodes.payAmount.textContent.includes('1.00'));
 assert.match(mobile.nodes.paymentTrackingStatus.textContent,/Awaiting confirmation/);
 assert.ok(mobile.nodes.paymentKind.textContent.includes('P2M'));
 let prevented=false;
 mobile.nodes.qrTapToPay.events.click({preventDefault(){prevented=true}});
 assert.equal(prevented,false,'Chrome Intent tap must preserve native user gesture');
 assert.equal(mobile.state.prompt,0,'No passkey prompt before native QR tap');
 assert.ok(!uri.includes(token),'Browser bearer token is not embedded in payment QR');
 const embedded=start('Mozilla/5.0 (Linux; Android 15; Pixel 6; wv) AppleWebKit/537.36 Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36');
 await flush();
 assert.equal(embedded.nodes.qrTapToPay.href,uri,'Native WebView needs raw upi://pay');
 assert.equal(embedded.state.qr,uri);
 assert.equal(embedded.nodes.upiAppOptions.hidden,true,'WebView is generic, never tries Chrome package-targeted URI');
 for(const link of embedded.appNodes)assert.equal(link.href,'#');
 mobile.document.visibilityState='hidden';
 mobile.events.visibilitychange();
 mobile.document.visibilityState='visible';
 mobile.events.visibilitychange();
 await flush();
 assert.equal(mobile.stages.find(x=>!x.hidden).dataset.stage,'qr',
  'Early app return must retain QR instead of claiming payment');
 assert.match(mobile.nodes.checkoutStatus.textContent,/UPI app returned quickly/,
  'A pre-PIN-like early return should be visible and accurately classified');
 assert.notEqual(mobile.nodes.receiptUtr?.textContent,'123456789012',
  'App return is not a credit');
 await mobile.nodes.shareCheckout.events.click();
 const shared=new URL(mobile.state.shared);
 assert.equal(shared.searchParams.get('paymentRef'),order);
 assert.equal(shared.searchParams.get('token'),token);
 assert.equal(shared.pathname,'/merchant-checkout.html');
 const desktop=start('Mozilla/5.0 (Windows NT 10.0)');
 await flush();
 assert.equal(desktop.state.qr,uri);
 assert.equal(desktop.nodes.upiAppOptions.hidden,true,'Desktop retains scan-only QR');
 for(const link of desktop.appNodes)assert.equal(link.href,'#');
 let blocked=false;
 desktop.nodes.qrTapToPay.events.click({preventDefault(){blocked=true}});
 assert.equal(blocked,true,'Desktop uses the same scan QR, not native payment intent');
 assert.equal(desktop.stages.find(x=>!x.hidden).dataset.stage,'qr');
 desktop.state.ledger='SUCCESS';desktop.state.utr='123456789012';
 desktop.events.focus();await flush();
 assert.equal(desktop.stages.find(x=>!x.hidden).dataset.stage,'receipt');
 assert.equal(desktop.nodes.receiptUtr.textContent,'123456789012');
 console.log('QR_HANDOFF_PASS: tap locally, scan on another phone, shared checkout, ledger receipt');
})().catch(error=>{console.error(error);process.exitCode=1});
