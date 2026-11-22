/* DISHA Android SMS transport differential lab.
 * Only an explicit, time-limited WebOTP request; no payment API, no SMS inbox
 * access, no automatic bank SMS capture, no sending data to server.
 */
(function(root,doc){
 'use strict';
 const node=id=>doc.getElementById(id);
 const consent=node('smsLabConsent'),begin=node('smsLabBegin'),end=node('smsLabEnd');
 const status=node('smsLabStatus'),otp=node('smsLabOtp'),domain=node('smsLabDomain');
 const observations=node('smsLabObservations');
 let sequence=0,controller=null,expiryTimer=null,startedAt=0;
 function record(state,detail=''){
  const item=doc.createElement('li');
  item.textContent=new Date().toISOString()+' '+state+(detail?' · '+detail:'');
  observations.appendChild(item);
  status.textContent=state+' — DEBIT_UNVERIFIED';
  return item;
 }
 const capability=()=>root.isSecureContext===true &&
  !!root.OTPCredential && typeof root.navigator?.credentials?.get==='function' &&
  typeof root.AbortController==='function';
 function clear(reason){
  ++sequence;
  if(expiryTimer!==null){root.clearTimeout(expiryTimer);expiryTimer=null}
  if(controller){const old=controller;controller=null;old.abort()}
  begin.disabled=!consent.checked||!capability();
  end.disabled=true;
  if(reason)record(reason);
 }
 function createCode(){
  if(!root.crypto?.getRandomValues)throw Error('SECURE_RANDOM_UNAVAILABLE');
  const bytes=new Uint32Array(1);let value;
  do{root.crypto.getRandomValues(bytes);value=bytes[0]}while(value>=4294800000);
  return String(100000+(value%900000));
 }
 function classifyResult(received,expected){
  if(typeof received!=='string'||!/^[0-9]{6}$/.test(received))return 'UNEXPECTED_WEBOTP_FORMAT';
  return received===expected?'WEBOTP_MATCHED_ONLY_NOT_BANK_EVIDENCE':'WEBOTP_CODE_MISMATCH';
 }
 async function start(){
  if(!consent.checked){record('EXPLICIT_CONSENT_REQUIRED');return}
  if(!capability()){record('WEBOTP_NOT_AVAILABLE');return}
  clear();
  const request=++sequence;
  startedAt=Date.now();
  const expected=createCode();
  otp.textContent=expected;
  domain.textContent=root.location.hostname;
  const localController=new root.AbortController();
  controller=localController;begin.disabled=true;end.disabled=false;
  record('WEBOTP_LISTENING_90_SECONDS','Send either a bank-like test SMS or the origin-bound OTP from the ADB script');
  expiryTimer=root.setTimeout(()=>{if(sequence===request)clear('WEBOTP_TIMEOUT_NO_BANK_SMS_ACCESS')},90000);
  try{
   const result=await root.navigator.credentials.get({
    otp:{transport:['sms']},signal:localController.signal
   });
   if(sequence!==request||controller!==localController)return;
   // Browser exposes only a code, not arbitrary SMS sender/body.
   const outcome=classifyResult(result?.code,expected);
   clear(outcome);
  }catch(err){
   if(sequence!==request)return;
   clear(err?.name==='NotAllowedError'?'WEBOTP_USER_DENIED_OR_UNAVAILABLE':
    err?.name==='AbortError'?'WEBOTP_ABORTED':'WEBOTP_REQUEST_ERROR');
  }
 }
 function init(){
  const supported=capability();
  record(supported?'WEBOTP_CAPABILITY_DETECTED':'WEBOTP_CAPABILITY_NOT_DETECTED');
  domain.textContent=root.location.hostname;
  consent.addEventListener('change',()=>{
   if(!consent.checked){clear('CONSENT_REVOKED');return}
   begin.disabled=!supported;
  });
  begin.addEventListener('click',()=>{void start()});
  end.addEventListener('click',()=>clear('USER_STOPPED'));
  root.addEventListener('pagehide',()=>clear('PAGE_LEFT_LISTENER_ABORTED'));
  root.addEventListener('beforeunload',()=>clear());
  begin.disabled=true;end.disabled=true;
 }
 root.DISHASmsTransportLab=Object.freeze({classifyResult});
 init();
})(window,document);
