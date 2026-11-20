/* DISHA Android checkout handshake probe. Test-only; never payment verification. */
(function(root,doc){
 'use strict';
 const params=new URLSearchParams(root.location.search||'');
 if(params.get('androidHandshake')!=='1')return;
 const node=id=>doc.getElementById(id);
 const panel=node('dishaHandshakeLab');
 if(!panel)return;
 panel.hidden=false;
 const consent=node('dishaHandshakeConsent'),startButton=node('dishaHandshakeStart');
 const stopButton=node('dishaHandshakeStop'),copyButton=node('dishaHandshakeCopy');
 const message=node('dishaHandshakeMessage'),result=node('dishaHandshakeResult');
 const capability=node('dishaHandshakeCapability');
 let session=null,active=false,requestId=0,controller=null,timer=null,expected=null;
 const report=code=>{result.textContent=code+' — BANK_DEBIT_UNVERIFIED';};
 const available=()=>root.isSecureContext===true&&'OTPCredential' in root&&
  typeof root.navigator?.credentials?.get==='function'&&typeof root.AbortController==='function';
 function code(){
  if(!root.crypto?.getRandomValues)throw Error('Secure randomness unavailable');
  const a=new Uint32Array(1),limit=0x100000000-(0x100000000%900000);
  do{root.crypto.getRandomValues(a)}while(a[0]>=limit);
  return String(100000+a[0]%900000);
 }
 function reset(reason){
  requestId++;
  const wasActive=active;
  active=false;
  if(timer!==null){root.clearTimeout(timer);timer=null;}
  const prior=controller;controller=null;
  expected=null;
  startButton.disabled=!session;
  stopButton.disabled=true;
  copyButton.disabled=true;
  message.value='';
  if(prior)prior.abort();
  if(reason&&(wasActive||reason==='CONSENT_REVOKED'))report(reason);
 }
 async function start(){
  if(active||!session)return;
  if(!consent.checked){report('EXPLICIT_CONSENT_REQUIRED');return;}
  if(!available()){report('WEBOTP_UNAVAILABLE');return;}
  if(!root.DISHAOneTouchVault?.authorize){report('WEBAUTHN_UNAVAILABLE');return;}
  if(Date.now()>=session.expiresAt){report('CHECKOUT_EXPIRED');return;}
  const attempt=++requestId;
  active=true;
  startButton.disabled=true;
  stopButton.disabled=false;
  report('REQUESTING_DEVICE_BIOMETRIC_OR_PIN');
  try{
   // Existing DISHA Vault endpoint validates the credential and order binding.
   const proof=await root.DISHAOneTouchVault.authorize(session.orderId);
   if(attempt!==requestId||!active)return;
   if(!proof?.sessionId){reset('WEBAUTHN_REJECTED');return;}
   if(!consent.checked){reset('CONSENT_REVOKED');return;}
   const remaining=Math.min(120000,session.expiresAt-Date.now());
   if(remaining<=0){reset('CHECKOUT_EXPIRED');return;}
   const otp=code();
   expected=otp;
   message.value=`DISHA checkout test code: ${otp}\n@${root.location.hostname} #${otp}`;
   const localController=new root.AbortController();
   controller=localController;
   copyButton.disabled=false;
   report('WEBAUTHN_OK_WEBOTP_LISTENING_'+Math.ceil(remaining/1000)+'S');
   timer=root.setTimeout(()=>reset('EXPIRED_120_SECONDS'),remaining);
   const credential=await root.navigator.credentials.get({otp:{transport:['sms']},signal:localController.signal});
   if(attempt!==requestId||controller!==localController||!active)return;
   reset(credential?.code===expected?'SMS_WEBOTP_CHANNEL_CONFIRMED':'UNEXPECTED_SMS_CODE_REJECTED');
  }catch(error){
   if(attempt!==requestId||!active)return;
   reset(error?.name==='NotAllowedError'?'CONSENT_OR_DEVICE_AUTH_CANCELLED':
    error?.name==='AbortError'?'LISTENER_ABORTED':'HANDSHAKE_FAILED');
  }
 }
 startButton.addEventListener('click',()=>{void start()});
 stopButton.addEventListener('click',()=>reset('STOPPED'));
 consent.addEventListener('change',()=>{if(!consent.checked&&active)reset('CONSENT_REVOKED')});
 copyButton.addEventListener('click',()=>{
  if(!active||!message.value)return;
  if(!root.navigator.clipboard?.writeText){report('CLIPBOARD_UNAVAILABLE');return;}
  void root.navigator.clipboard.writeText(message.value).catch(()=>report('COPY_FAILED'));
 });
 root.addEventListener('pagehide',()=>reset('PAGE_EXITED'));
 root.addEventListener('pageshow',()=>{
  // No automatic listener resurrection after external app/browser navigation.
  if(!active&&session)report('READY_REQUIRES_NEW_CONSENTED_ACTION');
 });
 const attach=order=>{
  if(!order?.orderId||!Number.isFinite(Number(order.expiresAt)))return;
  reset();
  session={orderId:order.orderId,expiresAt:Number(order.expiresAt)};
  startButton.disabled=false;
  const webotp=available()?'AVAILABLE':'UNAVAILABLE';
  capability.textContent='Android browser WebOTP: '+webotp+'. Device PIN/fingerprint: prompted on Start.';
  report('READY_FOR_OPTIONAL_TEST');
 };
 root.DISHAAndroidCheckoutHandshake={attach,stop:reset};
 report('WAITING_FOR_CHECKOUT_SESSION');
})(window,document);
