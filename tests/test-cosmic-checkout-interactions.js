'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
const model=require('../public/cosmic-checkout-model.js');
const uri='upi://pay?pa=shop%40oksbi&am=500.00&cu=INR';
const id='ORD_TEST_1234',token='a'.repeat(48);
const uiIds=['payAmount','btnOneTouch','checkoutStatus','oneTouchFallback','paymentQr','qrExpiry','receiptAmount','receiptOrder','receiptUtr','checkingHelp','saveReceipt','shareReceipt','showQr','backToApps','checkingApps'];
const nodes={};
function element(name){return nodes[name]||(nodes[name]={id:name,textContent:'',hidden:true,href:'#',disabled:false,dataset:{},
 classList:{toggle(){}},events:{},addEventListener(type,fn){this.events[type]=fn},removeAttribute(){},replaceChildren(){}})}
uiIds.forEach(element);
const stages=['initial','methods','qr','checking','receipt'].map(stage=>({dataset:{stage},hidden:stage!=='initial'}));
const apps=['gpay','phonepe','paytm','cred'].map(app=>({dataset:{app},events:{},addEventListener(type,fn){this.events[type]=fn}}));
const callbacks={};
const document={body:{dataset:{checkout:'merchant'}},visibilityState:'visible',
 querySelectorAll(key){return key==='[data-stage]'?stages:apps},
 getElementById:element,addEventListener(key,fn){callbacks[key]=fn}};
const location={search:'?orderId='+id+'&token='+token,assign(link){location.opened=link}};
const state={ledger:'PENDING',utr:null,authorized:0,handoff:false,hidden:0,posted:0,qr:null};
let preferred=null;
const vault={getPendingOrderId:()=>state.handoff?id:null,
 authorize:async()=>{state.authorized++;return {sessionId:'f'.repeat(32)}},
 beginHandoff:(order,session,checkoutToken)=>{assert.equal(order,id);assert.equal(checkoutToken,token);state.handoff=true},
 requestEvidence:()=>state.handoff&&state.hidden?{eventId:'evt_test',token,orderId:id,evidence:{}}:null,
 markBackgrounded:()=>state.hidden++,
 acknowledgeEvidence:()=>({success:true,verified:false,settled:false}),
 launchUPI:link=>{location.opened=link}};
const window={DISHACosmicCheckoutModel:model,DISHAOneTouchVault:vault,
 QRCode:function(target,params){state.qr=params.text},
 addEventListener:(k,fn)=>{callbacks[k]=fn},print(){}};
window.QRCode.CorrectLevel={M:1};
const fetch=async link=>{
 if(link.includes('/api/merchant/public/order/'))return {ok:true,json:async()=>({success:true,order:{
  id,amount:500,upi_uri:uri,expires_at:Date.now()+180000,status:'PENDING'}})};
 if(link.includes('/api/ledger/'))return {ok:true,json:async()=>({
  success:true,status:state.ledger,utr:state.utr,challengeAmount:500})};
 if(link==='/api/vault/evidence'){state.posted++;return {ok:true,json:async()=>({success:true,state:'RETURN_OBSERVED_NO_UTR'})}}
 throw Error('Unexpected URL: '+link);
};
const navigator={userAgent:'Android',share:null};
const localStorage={getItem:()=>preferred,setItem:(key,value)=>{preferred=value}};
vm.runInNewContext(src,{window,document,location,navigator,localStorage,fetch,
 URLSearchParams,Date,Intl,console,setInterval:()=>1,clearInterval(){}});
const active=()=>stages.find(x=>!x.hidden)?.dataset.stage;
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}
(async()=>{
 await flush();
 assert.equal(active(),'initial');
 assert.equal(nodes.btnOneTouch.disabled,false);
 nodes.showQr.events.click();
 assert.equal(active(),'initial','QR cannot bypass Vault');
 await nodes.btnOneTouch.events.click();
 assert.equal(state.authorized,1);
 assert.equal(active(),'methods');
 nodes.showQr.events.click();
 assert.equal(active(),'qr');
 assert.equal(state.qr,uri);
 nodes.backToApps.events.click();
 apps[1].events.click();
 assert.equal(preferred,'phonepe');
 assert.match(location.opened,/phonepe/);
 assert.equal(state.handoff,true);
 document.visibilityState='hidden';callbacks.visibilitychange();
 document.visibilityState='visible';callbacks.visibilitychange();
 await flush();
 assert.equal(state.posted,1);
 assert.equal(active(),'checking','Browser return cannot create payment receipt');
 state.ledger='SUCCESS';state.utr='123456789012';
 callbacks.focus();await flush();
 assert.equal(active(),'receipt','Server-confirmed ledger permits receipt');
 assert.equal(nodes.receiptUtr.textContent,'123456789012');
 callbacks.focus();await flush();
 assert.equal(active(),'receipt','Browser focus must never erase an authoritative completed receipt');
 console.log('COSMIC_INTERACTIONS_PASS: auth gate, QR, native app, browser evidence and ledger receipt');
})().catch(e=>{console.error(e);process.exitCode=1});
