'use strict';
(function(){
const el=id=>document.getElementById(id),out=el('output'),results=[];
const supported=(name,value)=>({feature:name,available:Boolean(value)});
const emit=(name,data)=>{const row={test:name,time:new Date().toISOString(),result:data};results.push(row);out.textContent=JSON.stringify(row,null,2)};
const isSecure=window.isSecureContext && location.protocol==='https:';
el('cap').onclick=()=>emit('capabilities',{secureContext:isSecure,android:/Android/i.test(navigator.userAgent),
 credentials:!!navigator.credentials,digitalGet:typeof navigator.credentials?.get==='function',
 paymentRequest:typeof window.PaymentRequest==='function',webOtpCredential:typeof window.OTPCredential==='function',
 webAuthn:typeof window.PublicKeyCredential==='function',nativeUdebBridge:typeof navigator.transactionEvidence?.request==='function'});
el('otp').onclick=()=>emit('webotp',{interfaceExposed:typeof window.OTPCredential==='function',smsReadAttempted:false,evidenceObtained:false});
el('pr').onclick=()=>emit('paymentrequest',{interfaceExposed:typeof window.PaymentRequest==='function',
 p2pBlankMccSupported:'UNTESTED',financialActionInitiated:false});
el('verifier').onclick=async()=>{
 try{const r=await fetch('/api/experiments/udeb-capabilities',{cache:'no-store',credentials:'same-origin'});
  emit('server-contract',{http:r.status,body:r.ok?await r.json():'UNAVAILABLE'});}
 catch(e){emit('server-contract',{status:'ERROR',name:String(e?.name||'Error')})}
};
el('platform').onclick=()=>emit('system-bridge',{
 asteosSystemService:'NOT_DEPLOYED_BY_THIS_WEB_APP',
 notificationAcquisition:'NOT_AVAILABLE_TO_STOCK_CHROME',
 smsAcquisition:'NOT_AVAILABLE_TO_STOCK_CHROME',
 hardwareAttestation:'NOT_TESTED',
 chromiumBinderInterface:'NOT_IMPLEMENTED',
 genuineDebitEvidence:'NOT_ACQUIRED',
 explanation:'Cannot mark device acquisition PASS without Android service, consent and execution logs'});
el('dc').onclick=async()=>{
 if(!isSecure||typeof navigator.credentials?.get!=='function'){
  emit('digital-credentials-HC',{status:'UNSUPPORTED',reason:'Secure origin and Credential Management required'});return}
 el('dc').disabled=true;
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const result=await navigator.credentials.get({digital:{requests:[{
   protocol:'disha-udeb-transaction-evidence-v1',
   data:{challenge:nonce,origin:location.origin,purpose:'non-payment-protocol-dispatch-probe'}
  }]},signal:controller.signal});
  emit('digital-credentials-HC',{status:'CREDENTIAL_RETURNED_UNVERIFIED',
   type:typeof result?.type==='string'?result.type:'UNKNOWN',
   source:'unknown; provider provenance not validated',
   paymentVerified:false,debitVerified:false,
   note:'Do not send credential data to server or classify as debit evidence'});
 }catch(e){
  emit('digital-credentials-HC',{status:'NOT_DISPATCH_PROVEN',
   errorName:String(e?.name||'UnknownError').slice(0,80),
   note:'A browser error alone cannot prove whether Android Credential Manager was contacted'});
 }finally{clearTimeout(timeout);el('dc').disabled=false}
};
el('copy').onclick=()=>{const content=JSON.stringify(results,null,2);
 if(!content||content==='[]')return;
 if(navigator.clipboard?.writeText){navigator.clipboard.writeText(content).then(()=>emit('copy',{status:'COPIED'}))
 .catch(()=>emit('copy',{status:'NOT_ALLOWED'}))}
 else emit('copy',{status:'UNAVAILABLE'});
};
})();