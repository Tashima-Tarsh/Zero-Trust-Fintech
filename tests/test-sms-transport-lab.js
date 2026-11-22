'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(base,'public/labs/sms-transport.js'),'utf8');
const html=fs.readFileSync(path.join(base,'public/labs/sms-transport.html'),'utf8');
const powershell=fs.readFileSync(path.join(base,'experiments/sms-transport/run.ps1'),'utf8');
function launch({supported=true}={}){
 const elements={},events={};let resolveOtp,rejectOtp,requested=0,aborts=0;
 const element=id=>elements[id]||(elements[id]={id,checked:false,disabled:true,textContent:'',children:[],events:{},
  addEventListener(k,v){this.events[k]=v},appendChild(item){this.children.push(item)}});
 const document={getElementById:element,createElement:()=>({textContent:''})};
 class Controller{constructor(){this.signal={}}abort(){aborts++}}
 const window={isSecureContext:true,OTPCredential:supported?function(){}:undefined,
  location:{hostname:'localhost'},AbortController:Controller,
  crypto:{getRandomValues(a){a[0]=222222;return a}},
  navigator:{credentials:{get(_req){requested++;return new Promise((resolve,reject)=>{
   resolveOtp=resolve;rejectOtp=reject})}}},
  setTimeout(){return 123},clearTimeout(){},events,
  addEventListener(k,v){events[k]=v}};
 vm.runInNewContext(source,{window,document,Date,Uint32Array,Promise,console});
 return {elements,window,events,resolve:()=>resolveOtp,requested:()=>requested,aborts:()=>aborts};
}
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
test('standalone Android Chrome lab is read-only, explicit consent and no payment mutation',()=>{
 assert.match(html,/smsLabConsent/);
 assert.match(html,/smsLabObservations/);
 assert.match(powershell,/emu','sms','send/);
 assert.match(powershell,/ValidateSet\('Open','Debit','Otp','Status'\)/);
 assert.match(powershell,/reverse/);
 assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|localStorage|sessionStorage/);
 assert.match(source,/otp:\{transport:\['sms'\]\}/);
});
test('WebOTP cannot be started without user permission and distinguishes bank SMS',async()=>{
 const lab=launch();
 assert.equal(lab.elements.smsLabBegin.disabled,true);
 assert.equal(lab.elements.smsLabStatus.textContent.includes('DEBIT_UNVERIFIED'),true);
 lab.elements.smsLabBegin.events.click();await settle();
 assert.equal(lab.requested(),0,'without consent no SMS request');
 lab.elements.smsLabConsent.checked=true;
 lab.elements.smsLabConsent.events.change();
 assert.equal(lab.elements.smsLabBegin.disabled,false);
 lab.elements.smsLabBegin.events.click();await settle();
 assert.equal(lab.requested(),1);
 assert.equal(lab.elements.smsLabOtp.textContent,'322222');
 assert.match(lab.elements.smsLabStatus.textContent,/WEBOTP_LISTENING/);
 // Synthetic bank SMS injection has no WebOTP API callback: Chrome remains listening.
 assert.equal(lab.elements.smsLabStatus.textContent.includes('LISTENING'),true);
 lab.resolve()({code:'322222'});await settle();
 assert.match(lab.elements.smsLabStatus.textContent,/WEBOTP_MATCHED_ONLY_NOT_BANK_EVIDENCE/);
 assert.equal(lab.elements.smsLabBegin.disabled,false);
});
test('consent revocation aborts in-flight request and ignores stale responses',async()=>{
 const lab=launch();lab.elements.smsLabConsent.checked=true;
 lab.elements.smsLabConsent.events.change();
 lab.elements.smsLabBegin.events.click();await settle();
 const resolve=lab.resolve();
 lab.elements.smsLabConsent.checked=false;
 lab.elements.smsLabConsent.events.change();
 assert.equal(lab.aborts(),1);
 resolve({code:'322222'});await settle();
 assert.match(lab.elements.smsLabStatus.textContent,/CONSENT_REVOKED/);
 assert.doesNotMatch(lab.elements.smsLabStatus.textContent,/MATCHED_ONLY/);
});
test('unsupported browser must never request SMS',async()=>{
 const lab=launch({supported:false});
 lab.elements.smsLabConsent.checked=true;lab.elements.smsLabConsent.events.change();
 assert.equal(lab.elements.smsLabBegin.disabled,true);
 lab.elements.smsLabBegin.events.click();await settle();
 assert.equal(lab.requested(),0);
 assert.match(lab.elements.smsLabStatus.textContent,/WEBOTP_NOT_AVAILABLE/);
});
