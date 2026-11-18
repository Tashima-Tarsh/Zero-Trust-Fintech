'use strict';
/* Browser-level fake DOM regression for intent handoff.
 * Asserts mobile app opens only from an explicit app tap and desktop shows QR.
 * No real payment, network, passkey or external-app launch is performed. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const uri='upi://pay?pa=example%40oksbi&pn=Test&am=1.00&cu=INR';
function harness(userAgent,initialPreferred){
 const nodes={};const cb={};const apps=['gpay','phonepe','paytm','cred','generic'].map(app=>({dataset:{app},events:{},addEventListener(type,fn){this.events[type]=fn}}));
 function node(id){return nodes[id]||(nodes[id]={id,textContent:'',hidden:true,href:'#',disabled:false,dataset:{},events:{},addEventListener(type,fn){this.events[type]=fn},removeAttribute(){},replaceChildren(){},classList:{toggle(){}}});}
 const order='ORD_INTENT_TEST_11',token='a'.repeat(48),sessionId='f'.repeat(32);
 const stages=['initial','methods','qr','checking','receipt'].map(x=>({dataset:{stage:x},hidden:x!=='initial'}));
 const state={qr:null,opened:null,beginCount:0,verified:false};
 const document={body:{dataset:{checkout:'merchant'}},visibilityState:'visible',getElementById:node,
  querySelectorAll:s=>s==='[data-stage]'?stages:apps,addEventListener(k,fn){cb[k]=fn}};
 const location={href:'https://checkout.example/merchant-checkout.html?orderId='+order+'&token='+token,search:'?orderId='+order+'&token='+token,assign(url){state.opened=url}};
 const vault={getPendingOrderId:()=>state.beginCount?order:null,requestEvidence:()=>null,authorize:async()=>{state.verified=true;return {sessionId}},
  beginHandoff:()=>{state.beginCount++},launchUPI:url=>{state.opened=url}};
 const window={DISHACosmicCheckoutModel:model,DISHAOneTouchVault:vault,
  QRCode:function(_,params){state.qr=params.text;},addEventListener(k,fn){cb[k]=fn}};
 window.QRCode.CorrectLevel={M:1};
 const fetch=async url=>{
  if(url.includes('/api/merchant/public/order/'))return {ok:true,json:async()=>({success:true,order:{id:order,upi_uri:uri,amount:1,expires_at:Date.now()+180000,status:'PENDING'}})};
  if(url.includes('/api/ledger/'))return {ok:true,json:async()=>({success:true,status:'PENDING',utr:null})};
  throw Error('Unexpected fetch '+url);
 };
 const localStorage={getItem:()=>initialPreferred,setItem(){}};
 vm.runInNewContext(code,{window,document,location,navigator:{userAgent},localStorage,fetch,
  URLSearchParams,Date,Intl,console,setInterval:()=>1,clearInterval(){}});
 return {nodes,apps,state,stages,windowFocus:()=>cb.focus?.()};
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve()}
(async()=>{
 assert.equal(model.supportsNativeUPI('Mozilla/5.0 (Windows NT 10.0)'),false);
 assert.equal(model.supportsNativeUPI('Mozilla/5.0 (Linux; Android 15)'),true);
 assert.match(model.buildAppUrl(uri,'phonepe','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'),/^phonepe:\/\/upi\/pay\?/);
 assert.match(model.buildAppUrl(uri,'gpay','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'),/^gpay:\/\/upi\/pay\?/);
 const android=harness('Mozilla/5.0 (Linux; Android 15) Chrome/120','phonepe');
 await flush();
 assert.equal(android.nodes.btnOneTouch.disabled,false);
 await android.nodes.btnOneTouch.events.click();
 assert.ok(android.state.verified);
 assert.equal(android.state.opened,null,'Do not automatically launch preferred UPI app after passkey');
 assert.equal(android.stages.find(x=>!x.hidden).dataset.stage,'methods');
 assert.equal(android.state.beginCount,0,'Handoff must start only when app actually selected');
 assert.match(android.nodes.checkoutTimer.textContent,/Session expires in 0[0-3]:[0-5][0-9]/,'Live TTL must be visible across payment stages');
 android.apps.find(x=>x.dataset.app==='phonepe').events.click();
 assert.match(android.state.opened,/^intent:\/\/pay\?/);
 assert.equal(android.state.beginCount,1);
 assert.equal(android.stages.find(x=>!x.hidden).dataset.stage,'methods');
 const fb=android.state.opened.match(/;S\.browser_fallback_url=([^;]+);end$/)?.[1];
 assert.ok(fb,'Chrome requires a fallback for an unresolvable app intent');
 const fallback=new URL(decodeURIComponent(fb));
 assert.equal(fallback.searchParams.get('orderId'),'ORD_INTENT_TEST_11');
 assert.equal(fallback.searchParams.get('token'),'a'.repeat(48));
 assert.equal(fallback.searchParams.get('upi_intent_fallback'),'1');
 android.state.opened=null;
 // A foreground-only intent rejection must NOT falsely imply payment failed
 // or imply the bank accepted payment. It must preserve app selection.
 android.windowFocus();
 assert.equal(android.stages.find(x=>!x.hidden).dataset.stage,'methods','Focus alone must not move into checking');
 android.apps.find(x=>x.dataset.app==='gpay').events.click();
 assert.equal(android.state.beginCount,2,'A fresh GPay retry must get a new Vault handoff event');
 assert.match(android.state.opened,/package=com\.google\.android\.apps\.nbu\.paisa\.user/);
 let prevented=false;
 android.nodes.oneTouchFallback.events.click({preventDefault(){prevented=true}});
 assert.equal(prevented,true,'Generic fallback must use the tested click handler');
 assert.equal(android.state.beginCount,3,'A generic fallback tap must create its own Vault event');
 assert.equal(android.state.opened,uri,'Generic retry must preserve the exact UPI payee and amount');

 assert.equal(android.nodes.oneTouchFallback.href,uri,'Unresolved targeted intent must offer generic UPI fallback');
 const desktop=harness('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157','gpay');
 await flush();
 await desktop.nodes.btnOneTouch.events.click();
 assert.equal(desktop.stages.find(x=>!x.hidden).dataset.stage,'qr','Desktop must present QR after Vault');
 assert.equal(desktop.state.qr,uri);
 assert.equal(desktop.state.opened,null,'Never attempt native UPI intent from desktop');
 assert.equal(desktop.state.beginCount,0);
 desktop.apps.find(x=>x.dataset.app==='gpay').events.click();
 assert.equal(desktop.state.opened,null);
 console.log('INTENT_HANDOFF_PASS: Android fresh user gesture, generic fallback, desktop QR, no implicit launch');
})().catch(e=>{console.error(e);process.exitCode=1});
