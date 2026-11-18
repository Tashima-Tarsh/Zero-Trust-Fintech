'use strict';
if(process.env.DISHA_ANDROID_FIXTURE_ONLY!=='1')throw Error('Android fixture is test-only');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..','public'),port=8765;
const orderId='ORD_ANDROID_CI_1001',token='b'.repeat(48),expiresAt=Date.now()+12*60*1000;
let status='PENDING',vaultRegistered=false,vaultPrompts=0;
const reply=(res,code,value,type='application/json')=>{
 res.writeHead(code,{'content-type':type,'cache-control':'no-store'});
 res.end(type.includes('json')?JSON.stringify(value):value);
};
const uri=new URL('upi://pay');
for(const [key,val] of Object.entries({pa:'qa-receiver@oksbi',pn:'DISHA QA Merchant',am:'499.01',cu:'INR',tn:'Automated test - no money'}))uri.searchParams.set(key,val);
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://10.0.2.2:'+port);
 if(url.pathname==='/health')return reply(res,200,{ok:true,status,vaultRegistered,vaultPrompts});
 if(url.pathname==='/merchant-checkout.html')return reply(res,200,fs.readFileSync(path.join(root,'merchant-checkout.html')),'text/html');
 if(url.pathname==='/vendor/qrcode.min.js')return reply(res,200,fs.readFileSync(path.join(root,'vendor','qrcode.min.js')),'application/javascript');
 if(url.pathname==='/one-touch-vault.js')return reply(res,200,
  fs.readFileSync(path.join(root,'one-touch-vault.js')),'application/javascript');
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
       ?reply(res,200,{success:true,sessionId:'CI_VAULT_AUTH',publicKey:{}})
       :reply(res,400,{success:false,needsRegistration:true,error:'REGISTER_FIRST'});
   if(url.pathname.endsWith('/register/start'))
     return reply(res,200,{success:true,sessionId:'CI_VAULT_REGISTER',publicKey:{}});
   if(url.pathname.endsWith('/register/finish')){
     vaultPrompts++;vaultRegistered=true;
     return reply(res,200,{success:true,sessionId:'CI_VAULT_REGISTER',
       orderId:orderId,credentialId:'CI_KEY'});
   }
   if(url.pathname.endsWith('/authenticate/finish')){
     vaultPrompts++;
     return reply(res,200,{success:true,sessionId:'CI_VAULT_AUTH',orderId:orderId});
   }
   return reply(res,404,{error:'CI_WEB_AUTH_NOT_FOUND'});
  });
  return;
 }
 if(url.pathname==='/api/merchant/public/order/'+orderId){
  if(url.searchParams.get('token')!==token)return reply(res,404,{success:false,error:'Payment request not found'});
  return reply(res,200,{success:true,order:{id:orderId,amount:499.01,business_name:'DISHA QA Merchant',
   vpa_address:'qa-receiver@oksbi',description:'Automated device test',expires_at:expiresAt,
   status,upi_uri:uri.toString()}});
 }
 if(url.pathname==='/__test/state'&&req.method==='POST'&&req.headers['x-ci-fixture-key']==='CI_ANDROID_ONLY'){
  const value=url.searchParams.get('value');
  if(!['PENDING','EXPIRED','COMPLETED','FAILED'].includes(value))return reply(res,400,{error:'invalid state'});
  status=value;return reply(res,200,{ok:true,status});
 }
 return reply(res,404,{error:'Not found'});
}).listen(port,'0.0.0.0',()=>console.log('DISHA_ANDROID_FIXTURE_READY'));
