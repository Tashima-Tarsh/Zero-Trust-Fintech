'use strict';
if(process.env.DISHA_ANDROID_FIXTURE_ONLY!=='1')throw Error('Android fixture is test-only');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..','public'),port=8765;
const orderId='PAY_ANDROID_CI_1001',token='b'.repeat(48),expiresAt=Date.now()+12*60*1000;
let status='PENDING',paymentKind='P2P',vaultRegistered=false,vaultPrompts=0;
const CI_REGISTER_SESSION='a1'.repeat(16);
const CI_AUTH_SESSION='b2'.repeat(16);
const evidenceEvents=new Map();
const reply=(res,code,value,type='application/json')=>{
 res.writeHead(code,{'content-type':type,'cache-control':'no-store'});
 res.end(type.includes('json')?JSON.stringify(value):value);
};
const uri=new URL('upi://pay');
for(const [key,val] of Object.entries({pa:'qa-receiver@oksbi',pn:'DISHA QA Payee',am:'499.01',cu:'INR',tn:'UPI intent QA'}))uri.searchParams.set(key,val);
const merchantUri=new URL('upi://pay');
for(const [key,val] of Object.entries({
 pa:'qa-company@ypbiz',pn:'QA Company',am:'499.01',cu:'INR',mc:'5411',
 tr:'PAYAABBCCDDEEFF001122334455',tn:'Service payment'
}))merchantUri.searchParams.set(key,val);
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://10.0.2.2:'+port);
 if(url.pathname==='/health')return reply(res,200,{ok:true,status,vaultRegistered,vaultPrompts,evidenceCount:evidenceEvents.size});
 if(url.pathname==='/merchant-checkout.html')return reply(res,200,fs.readFileSync(path.join(root,'merchant-checkout.html')),'text/html');
 const allowedAssets=new Map([
  ['/cosmic-checkout.css','text/css'],
  ['/checkout-moonlight.css','text/css'],
  ['/cosmic-checkout.js','application/javascript'],
  ['/cosmic-checkout-model.js','application/javascript'],
  ['/one-touch-vault.js','application/javascript'],
  ['/assets/disha-vault-sculpture.svg','image/svg+xml'],
  ['/assets/disha-8-2-wordmark-cropped.png','image/png'],
  ['/assets/upi-googlepay.svg','image/svg+xml'],
  ['/assets/upi-phonepe.svg','image/svg+xml'],
  ['/assets/upi-paytm.svg','image/svg+xml']
 ]);
 // Mirror Railway's production /api/runtime-assets/ URLs. The HTML uses
 // these URLs, so serving only legacy root assets leaves Android WebView blank.
 // Restrict the translation to the explicit allowlist: never expose arbitrary files.
 const assetPath=url.pathname.startsWith('/api/runtime-assets/')
   ? '/'+url.pathname.slice('/api/runtime-assets/'.length)
   : url.pathname;
 if(allowedAssets.has(assetPath))
   return reply(res,200,fs.readFileSync(path.join(root,assetPath.slice(1))),allowedAssets.get(assetPath));
 if(url.pathname==='/vendor/qrcode.min.js')return reply(res,200,fs.readFileSync(path.join(root,'vendor','qrcode.min.js')),'application/javascript');
 if(url.pathname==='/vendor/simplewebauthn.umd.js')return reply(res,200,
  "window.SimpleWebAuthnBrowser={startRegistration:async()=>({id:'CI_PASSED_REGISTRATION'}),"+
  "startAuthentication:async()=>({id:'CI_PASSED_AUTHENTICATION'})};",'application/javascript');
 if(url.pathname.startsWith('/api/webauthn/') && req.method==='POST'){
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   let input={};try{input=JSON.parse(body)}catch(_){}
   if(url.pathname.endsWith('/authenticate/start'))
     return vaultRegistered
       ?reply(res,200,{success:true,sessionId:CI_AUTH_SESSION,publicKey:{}})
       :reply(res,400,{success:false,needsRegistration:true,error:'REGISTER_FIRST'});
   if(url.pathname.endsWith('/register/start'))
     return reply(res,200,{success:true,sessionId:CI_REGISTER_SESSION,publicKey:{}});
   if(url.pathname.endsWith('/register/finish')){
     vaultPrompts++;vaultRegistered=true;
     return reply(res,200,{success:true,sessionId:CI_REGISTER_SESSION,
       orderId:orderId,credentialId:'CI_KEY'});
   }
   if(url.pathname.endsWith('/authenticate/finish')){
     vaultPrompts++;
     return reply(res,200,{success:true,sessionId:CI_AUTH_SESSION,orderId:orderId});
   }
   return reply(res,404,{error:'CI_WEB_AUTH_NOT_FOUND'});
  });
  return;
 }
 // The test fixture emulates a Vault-authorized evidence store, never a bank.
 // Production /api/vault/evidence and signature validation are exercised in
 // the separate PostgreSQL integration suite. Only fixture calls reach here.
 if(url.pathname==='/__test/vault'&&req.method==='GET')
   return reply(res,200,{ok:true,count:evidenceEvents.size,
     events:[...evidenceEvents.values()].map(e=>({
       eventId:e.eventId,orderId:e.orderId,state:e.state,utrCandidate:e.utrCandidate
     }))});
 if(url.pathname==='/api/vault/evidence'&&req.method==='POST'){
   let raw='';
   req.on('data',chunk=>{raw+=chunk;if(raw.length>5000)req.destroy()});
   req.on('end',()=>{
     let packet={};try{packet=JSON.parse(raw)}catch(_){}
     const evidence=packet.evidence||{};
     if(packet.orderId!==orderId||packet.token!==token||
       req.headers['x-csrf-token']!==token||
       ![CI_REGISTER_SESSION,CI_AUTH_SESSION].includes(packet.vaultSessionId)||
       !/^[0-9a-f]{32}$/.test(packet.eventId||'')||
       !['APP_RESUME','RETURN_QUERY_OBSERVED','PAGESHOW_RETURN'].includes(evidence.browserEvent))
       return reply(res,403,{success:false,error:'CI_INVALID_VAULT_PACKET'});
     const params=evidence.returnParams||{};
     const utr=/^\d{12}$/.test(params.txnId||'')?params.txnId:null;
     const recorded=evidenceEvents.get(packet.eventId);
     if(recorded&&JSON.stringify(recorded.packet)!==JSON.stringify(packet))
       return reply(res,409,{success:false,error:'CI_EVIDENCE_REPLAY_CONFLICT'});
     const event=recorded||{eventId:packet.eventId,orderId:packet.orderId,
       state:utr?'UTR_CANDIDATE_UNVERIFIED':'RETURN_OBSERVED_NO_UTR',
       utrCandidate:utr,packet};
     evidenceEvents.set(packet.eventId,event);
     return reply(res,202,{success:true,state:event.state,
       utrCandidate:event.utrCandidate,verified:false,settled:false,
       replayed:Boolean(recorded)});
   });
   return;
 }

 if(url.pathname==='/api/ledger/'+orderId){
  if(url.searchParams.get('token')!==token)return reply(res,401,{success:false,error:'SESSION_TOKEN_REQUIRED'});
  return reply(res,200,{success:true,orderId,challengeAmount:499.01,
   status:status==='COMPLETED'?'SUCCESS':status,
   utr:status==='COMPLETED'?'123456789012':null,createdAt:Date.now()-45000});
 }
 if(url.pathname==='/api/merchant/public/payment/'+orderId||
    url.pathname==='/api/merchant/public/order/'+orderId){
  if(url.searchParams.get('token')!==token)return reply(res,404,{success:false,error:'Payment request not found'});
  const merchant=paymentKind==='P2M';
  return reply(res,200,{success:true,order:{id:orderId,amount:499.01,
   business_name:merchant?'QA Company':'DISHA QA Payee',
   vpa_address:merchant?'qa-company@ypbiz':'qa-receiver@oksbi',
   description:merchant?'Service payment':'UPI intent QA',payment_type:paymentKind,
   expires_at:expiresAt,status,upi_uri:(merchant?merchantUri:uri).toString()}});
 }
 if(url.pathname==='/__test/kind'&&req.method==='POST'&&
    req.headers['x-ci-fixture-key']==='CI_ANDROID_ONLY'){
  const next=url.searchParams.get('value');
  if(!['P2P','P2M'].includes(next))return reply(res,400,{error:'invalid kind'});
  paymentKind=next;return reply(res,200,{ok:true,kind:paymentKind});
 }
 if(url.pathname==='/__test/state'&&req.method==='POST'&&req.headers['x-ci-fixture-key']==='CI_ANDROID_ONLY'){
  const value=url.searchParams.get('value');
  if(!['PENDING','EXPIRED','COMPLETED','FAILED'].includes(value))return reply(res,400,{error:'invalid state'});
  status=value;return reply(res,200,{ok:true,status});
 }
 return reply(res,404,{error:'Not found'});
}).listen(port,'0.0.0.0',()=>console.log('DISHA_ANDROID_FIXTURE_READY'));
