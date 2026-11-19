/* DISHA Quantum Signal: first-party browser -> server order-twin transport.
 * The server stores only events the browser can actually observe.
 * No notification access, screen capture, UPI private data, or invented UTR. */
(function(root){
 'use strict';
 const KEY='disha82:quantum-signal:v1:';
 const auth=()=>root.DISHAOneTouchVault;
 const secureId=()=>{
  const bytes=new Uint8Array(16);
  if(!root.crypto?.getRandomValues)throw Error('Secure device event IDs are unavailable');
  root.crypto.getRandomValues(bytes);
  return 'qs_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 };
 const read=orderId=>{
  try{return JSON.parse(sessionStorage.getItem(KEY+orderId)||'null')}catch(_){return null}
 };
 const write=(orderId,state)=>{try{sessionStorage.setItem(KEY+orderId,JSON.stringify(state))}catch(_){}};
 const fields=()=>{
  const parsed=new URLSearchParams(root.location.search||'');
  const hash=String(root.location.hash||'').replace(/^#/,'');
  const fragment=hash.includes('=')&&!hash.includes('/')?new URLSearchParams(hash):new URLSearchParams();
  const out={};
  for(const name of ['Status','status','txnId','txnRef','ApprovalRefNo','responseCode','tr','am','pa']){
   const v=parsed.get(name)??fragment.get(name);
   if(typeof v==='string'&&v.length>0&&v.length<=100)out[name]=v;
  }
  return out;
 };
 async function request(route,payload,token,keepalive=false){
  const response=await fetch('/api/quantum-signal/'+route,{
   method:'POST',credentials:'same-origin',cache:'no-store',keepalive,
   headers:{'Content-Type':'application/json','X-CSRF-Token':token},
   body:JSON.stringify(payload)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Quantum Signal unavailable');
  return data;
 }
 function restore(s){
  const old=read(s.orderId);
  return Boolean(old?.nonce&&old?.token===s.token&&
    old.acknowledged===true&&old.expiresAt>Date.now()&&/^[a-f0-9]{40}$/.test(old.nonce));
 }

 async function acceptChallenge(s,response,vaultSessionId=null){
  const nonce=response.nonce;
  const challenge=await request('challenge',{orderId:s.orderId,token:s.token,nonce},s.token);
  if(challenge.protocol!=='DISHA-SIGNAL-V1'||!challenge.challengeId||!challenge.challenge)
   throw Error('Trust challenge missing');
  const ack=await request('ack',{orderId:s.orderId,token:s.token,nonce,
   challengeId:challenge.challengeId,challenge:challenge.challenge},s.token);
  if(!ack.acknowledged||ack.protocol!=='DISHA-SIGNAL-V1')
   throw Error('Trust handshake was not acknowledged');
  const state={token:s.token,vaultSessionId,nonce,acknowledged:true,
   expiresAt:Number(response.expiresAt),pending:false,lastApp:'generic',
   hidden:false,lastEvidenceState:null};
  write(s.orderId,state);
  return response;
 }
 // Browser session continuity is prepared without a customer permission prompt.
 async function prepare(s){
  if(!s?.orderId||!s?.token)throw Error('Missing checkout session');
  if(restore(s))return {success:true,alreadyPrepared:true};
  const response=await request('start',{orderId:s.orderId,token:s.token},s.token);
  return acceptChallenge(s,response);
 }
 // Optional separate passkey-verified path; not required for one-button checkout.
 async function authorizeAndStart(s){
  if(!s?.orderId||!s?.token)throw Error('Missing checkout session');
  const vault=auth();
  if(!vault?.authorize)throw Error('DISHA Vault unavailable on this device');
  const proof=await vault.authorize(s.orderId);
  if(!proof?.sessionId)throw Error('Vault did not authorize this order');
  const response=await request('start',{orderId:s.orderId,token:s.token,
   vaultSessionId:proof.sessionId},s.token);
  return acceptChallenge(s,response,proof.sessionId);
 }
 const inFlight=new Map();
 async function deliver(s,packet){
  if(inFlight.has(packet.eventId))return inFlight.get(packet.eventId);
  const promise=request('event',packet,s.token,true).then(reply=>{
   const fresh=read(s.orderId);
   if(fresh){
    fresh.queue=(fresh.queue||[]).filter(x=>x.eventId!==packet.eventId);
    write(s.orderId,fresh);
   }
   return reply;
  }).finally(()=>inFlight.delete(packet.eventId));
  inFlight.set(packet.eventId,promise);
  return promise;
 }
 async function flush(s){
  if(!restore(s))return null;
  const queue=read(s.orderId)?.queue||[];
  const results=await Promise.allSettled(queue.map(packet=>deliver(s,packet)));
  const ok=results.filter(x=>x.status==='fulfilled');
  return ok.length?ok[ok.length-1].value:null;
 }
 async function signal(s,eventKind,app='generic',returnParams={}){
  const state=read(s.orderId);
  if(!state||!restore(s))return null;
  const packet={orderId:s.orderId,token:s.token,nonce:state.nonce,
   eventId:secureId(),eventKind,app,returnParams};
  const queue=state.queue||[];
  if(queue.length>=12)throw Error('Evidence queue temporarily full');
  queue.push(packet);state.queue=queue;write(s.orderId,state);
  return deliver(s,packet);
 }
 function handoff(s,app='generic'){
  const state=read(s.orderId);
  if(!state||!restore(s))throw Error('Authorize DISHA Vault before payment');
  if(!state.pending&&state.vaultSessionId){
   // Separate high-assurance Vault handoff only when authorized.
   auth()?.beginHandoff?.(s.orderId,state.vaultSessionId,s.token,
    ['gpay','phonepe','paytm','cred','generic'].includes(app)?app:'generic');
  }
  state.pending=true;state.hidden=false;state.lastApp=app;
  write(s.orderId,state);
  void signal(s,'HANDOFF',app).catch(()=>{});
 }
 function background(s){
  if(!s)return;
  const state=read(s.orderId);
  if(!state?.pending||state.hidden)return;
  state.hidden=true;write(s.orderId,state);
  if(state.vaultSessionId)auth()?.markBackgrounded?.(s.orderId);
  void signal(s,'BACKGROUND',state.lastApp).catch(()=>{});
 }
 async function returned(s){
  if(!s||!restore(s))return null;
  const state=read(s.orderId);
  if(!state?.pending){
   // Retry the *original frozen event IDs* after network errors or reloads.
   if(!(state?.queue?.length))return null;
   const retried=await Promise.allSettled([
    flush(s),Promise.resolve(state.vaultSessionId?auth()?.submitReturnEvidence?.(s.orderId):null)
   ]);
   return retried[0].status==='fulfilled'?retried[0].value:null;
  }
  // A return may be observed without a UTR. The first packet is frozen.
  state.pending=false;state.hidden=false;write(s.orderId,state);
  const result=await Promise.allSettled([
   signal(s,'RETURN',state.lastApp,fields()),
   Promise.resolve(state.vaultSessionId?auth()?.submitReturnEvidence?.(s.orderId):null)
  ]);
  await flush(s);
  return result[0].status==='fulfilled'?result[0].value:null;
 }
 async function status(s){
  if(!restore(s))return null;
  await flush(s).catch(()=>{});
  const url='/api/quantum-signal/status/'+encodeURIComponent(s.orderId)+
   '?token='+encodeURIComponent(s.token);
  const res=await fetch(url,{cache:'no-store',credentials:'same-origin'});
  if(!res.ok)return null;
  return res.json();
 }
 root.DISHAQuantumSignalClient=Object.freeze({
  restore,prepare,authorizeAndStart,handoff,background,returned,status
 });
})(window);
