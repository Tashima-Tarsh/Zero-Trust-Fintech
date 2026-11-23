/* Browser-only P2P Chrome PaymentRequest compatibility experiment.
 * Strictly non-settling. Never passes app-return text to DISHA's ledger. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISHAP2PPaymentRequestProbe=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const METHOD='https://tez.google.com/pay';
function build(session,origin){
 if(!session||!['P2P','PERSONAL'].includes(String(session.paymentType||'').toUpperCase()))return null;
 if(typeof origin!=='string'||!/^https:\/\//.test(origin))return null;
 if(!/^upi:\/\/pay\?/i.test(session.upiUri||''))return null;
 let p;try{p=new URL(session.upiUri).searchParams}catch(_){return null}
 if(p.has('mc'))return null; // No invented merchant classification.
 const pa=p.get('pa')||'',pn=p.get('pn')||'';
 const amount=Number(session.amount);
 if(!/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i.test(pa)||!pn.trim()||
    !Number.isFinite(amount)||amount<=0||amount>100000||
    (p.has('cu')&&p.get('cu')!=='INR')||
    (session.payeeVpa&&session.payeeVpa.toLowerCase()!==pa.toLowerCase()))return null;
 // This existing Chromium payment method may require merchant-specific fields.
 // We test its real capability with a personal UPI payload and no fake MCC/TR.
 return {methods:[{supportedMethods:METHOD,data:{pa,pn,tn:'DISHA P2P compatibility probe'}}],
  details:{total:{label:'P2P UPI compatibility experiment',amount:{currency:'INR',value:amount.toFixed(2)}}},
  expected:{pa,amount:amount.toFixed(2),orderId:session.orderId}};
}
function inspect(response,expected){
 if(!response||response.methodName!==METHOD)return {state:'UNEXPECTED_PAYMENT_METHOD',debitVerified:false};
 const details=response.details&&typeof response.details==='object'?response.details:{};
 let raw=details.tezResponse;
 if(typeof raw==='string'){try{raw=JSON.parse(raw)}catch(_){raw=null}}
 const t=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const status=typeof t.Status==='string'?t.Status:typeof t.status==='string'?t.status:'MISSING';
 const pa=typeof t.toVpa==='string'?t.toVpa:'';
 const am=typeof t.amount==='string'?t.amount:'';
 return {state:'ANDROID_PAYMENT_RESPONSE_OBSERVED',providerReportedStatus:status,
  transactionIdPresent:typeof t.txnId==='string'&&t.txnId.length>0,
  payeeMatched:pa.length>0&&pa.toLowerCase()===expected.pa.toLowerCase(),
  amountMatched:am===expected.amount,
  signaturePresent:typeof details.signature==='string'&&details.signature.length>0,
  signatureVerified:false,debitVerified:false,paymentVerified:false,
  source:'PAYMENT_APP_RETURN_UNVERIFIED'};
}
// Automatic, transient Android-browser evidence timeline. No SMS input or uploads.
// Tracks actual navigation/visibility/sensor observations during a single payment attempt.
function createTimeline(session,clock=()=>Date.now()){
 const started=clock(),end=Math.min(Number(session.expiresAt)||started,started+180000);
 const events=[];let motionSamples=0,closed=false;
 const record=(type)=>{
  const now=clock();
  if(closed||now>end||events.length>=48)return false;
  if(!['PAYMENT_LAUNCHED','DOCUMENT_HIDDEN','DOCUMENT_VISIBLE','WINDOW_BLUR','WINDOW_FOCUS','PAGE_RETURN','PAYMENT_RESPONSE','PAYMENT_ERROR'].includes(type))return false;
  events.push({type,elapsedMs:Math.max(0,now-started)});return true;
 };
 const motion=()=>{
  if(closed||clock()>end||motionSamples>=300)return;
  motionSamples++;
 };
 const snapshot=(result)=>Object.freeze({
  state:'ANDROID_TIMEBOUND_SIGNAL_CORRELATION',windowMs:Math.max(0,end-started),
  orderId:session.orderId,events:events.slice(),motionSamples,
  responseObserved:!!result&&result.state==='ANDROID_PAYMENT_RESPONSE_OBSERVED',
  responseFieldsMatched:!!result&&result.payeeMatched===true&&result.amountMatched===true,
  signatureVerified:false,debitVerified:false,paymentVerified:false
 });
 const close=()=>{closed=true};
 return Object.freeze({record,motion,snapshot,close});
}
function attach(session,env){
 const win=env.window,doc=env.document;
 const node=doc.getElementById('p2pPaymentRequestProbe');
 const query=new URLSearchParams(win.location.search);
 const timed=false; // Direct payment initiation; compatibility and device-trust prechecks are optional.
 if(!node||!win||!win.location)return false;
 const config=build(session,win.location.origin);
 if(!config)return false;
 node.hidden=false;
 const probe=doc.getElementById('p2pPaymentRequestCheck');
 const launch=doc.getElementById('p2pPaymentRequestLaunch');
 const status=doc.getElementById('p2pPaymentRequestStatus');
 // A Chrome PaymentRequest handler probe is not Google Pay app discovery.
 // Offer a separate, explicit Android app intent for a valid personal UPI URI.
 const isAndroid=/Android/i.test(win.navigator?.userAgent||'')||
   win.navigator?.userAgentData?.platform==='Android';
 if(isAndroid){
  const gpay=doc.createElement('button');
  gpay.type='button';gpay.id='p2pOpenGooglePay';gpay.textContent='Open Google Pay';
  gpay.style.cssText='display:block;width:100%;max-width:100%;box-sizing:border-box;min-height:48px;margin:12px 0;white-space:normal;overflow-wrap:anywhere';
  const uri=new URL(session.upiUri);
  const intent='intent://pay?'+uri.searchParams.toString()+
   '#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end';
  gpay.disabled=!(Number.isFinite(session.expiresAt)&&Date.now()<session.expiresAt);
  gpay.addEventListener('click',()=>{
   if(!Number.isFinite(session.expiresAt)||Date.now()>=session.expiresAt){
    status.textContent='Session expired. Start a new checkout.';gpay.disabled=true;return;
   }
   // App launch is not payment evidence; never update ledger from this click.
   status.textContent='Opening Google Pay. Return to DISHA after payment; confirmation remains pending.';
   win.location.href=intent;
  });
  node.insertBefore(gpay,probe||node.firstChild);
 }
 if(probe?.style)probe.style.cssText+=';max-width:100%;white-space:normal;overflow-wrap:anywhere';
 if(launch?.style)launch.style.cssText+=';max-width:100%;white-space:normal;overflow-wrap:anywhere';
 if(status?.style)status.style.cssText+=';max-width:100%;white-space:normal;overflow-wrap:anywhere';
 if(timed){
  // Keep legacy diagnostics behind ?paymentrequest=1, but show customer copy
  // for the signed Google Pay method on the actual P2P chooser route.
  const heading=node.querySelector?.('strong');
  const intro=node.querySelector?.('p.inline-note');
  if(heading)heading.textContent='Pay securely with Google Pay';
  if(intro)intro.textContent='Verify your device, then pay in your existing Google Pay app.';
  if(probe){probe.textContent='Check Google Pay compatibility';probe.hidden=false}
  if(launch)launch.textContent='Pay with Google Pay';
 }
 const emit=o=>{status.textContent=timed&&o?.message?o.message:
   timed&&o?.state==='READY_FOR_USER_INITIATED_PAYMENT'?
     'Verify yourself to check Google Pay availability':JSON.stringify(o)};
 const inWindow=()=>Number.isFinite(session.expiresAt)&&Date.now()<session.expiresAt;
 let request=null,used=false,cleanup=()=>{},timedRef=null,timedExpiresAt=null;
 launch.disabled=!(inWindow()&&win.isSecureContext&&typeof win.PaymentRequest==='function');
 emit({state:'READY_FOR_USER_INITIATED_PAYMENT',method:METHOD,realPaymentStarted:false});
 probe.addEventListener('click',async()=>{
  launch.disabled=true;request=null;
  if(!inWindow()){emit({state:'SESSION_EXPIRED'});return}
  if(!win.isSecureContext||typeof win.PaymentRequest!=='function'){emit({state:'PAYMENT_REQUEST_UNAVAILABLE'});return}
  if(timed){
   const platform=win.navigator?.userAgentData?.platform;
   const userAgent=win.navigator?.userAgent;
   if(platform?platform!=='Android':userAgent&&!/Android/i.test(userAgent)){
    emit({state:'ANDROID_REQUIRED',message:'Open this checkout in Chrome on an Android phone with Google Pay installed.'});
    return;
   }
  }
  let preparingPayment=false;
  try{
   if(timed){
    if(env.isAuthorized?.()!==true){
     // Capability-only probe: never creates a signed payment challenge or unlocks Pay.
     const candidate=new win.PaymentRequest(config.methods,config.details);
     const available=await candidate.canMakePayment();
     emit({state:available?'GOOGLE_PAY_HANDLER_FOUND':'GOOGLE_PAY_HANDLER_NOT_FOUND',
      message:available?'Google Pay handler detected. Payment requires verified device trust.':
       'No compatible Google Pay handler detected for this personal UPI checkout.',
      debitVerified:false,paymentVerified:false});
     return;
    }
    if(typeof env.prepareTimed!=='function'){
     emit({state:'TIMED_PROVIDER_UNAVAILABLE',debitVerified:false});return;
    }
    preparingPayment=true;
    const p=await env.prepareTimed();
    if(!p||typeof p.transactionRef!=='string'||!/^[0-9a-f]{32}$/.test(p.transactionRef)||
       !p.paymentRequest||!Number.isFinite(p.expiresAt)||p.expiresAt>Date.now()+120000||
       p.expiresAt<=Date.now()||p.paymentRequest.methods?.[0]?.supportedMethods!==METHOD)
      throw Error('INVALID_TIMED_CHALLENGE');
    timedRef=p.transactionRef;timedExpiresAt=p.expiresAt;
    request=new win.PaymentRequest(p.paymentRequest.methods,p.paymentRequest.details);
    const available=await request.canMakePayment();
    if(!inWindow()||Date.now()>=timedExpiresAt){request=null;emit({state:'SESSION_EXPIRED'});return}
    if(!available)request=null;
    launch.disabled=!available||env.isAuthorized?.()!==true;
    if(probe)probe.hidden=available; // Recheck is available if the method is missing.
    emit({state:available?'TIMED_PROVIDER_METHOD_FOUND':'NO_TIMED_PROVIDER_METHOD',
     message:available?'Google Pay payment method available · ready for Pay click':
      'Supported Google Pay method unavailable for this checkout',
     realPaymentStarted:false,debitVerified:false});
    return;
   }
   const candidate=new win.PaymentRequest(config.methods,config.details);
   const available=await candidate.canMakePayment();
   if(!inWindow()){emit({state:'SESSION_EXPIRED'});return}
   request=available?candidate:null;launch.disabled=false; // A negative preflight must not block a direct user-gesture attempt.
   emit({state:available?'P2P_METHOD_HANDLER_FOUND':'NO_P2P_METHOD_HANDLER',realPaymentStarted:false});
  }catch(e){
   if(timed&&probe)probe.hidden=false;
   // canMakePayment() is optional preflight. Chromium may throw RangeError for
   // unsupported payment-method data; do not treat that as proof of no handler.
   // Restore direct launch after a failed diagnostic, without claiming payment success.
   request=null;
   if(!timed)launch.disabled=used||!inWindow()||!win.isSecureContext||
    typeof win.PaymentRequest!=='function';
   emit({state:'CAPABILITY_PROBE_FAILED',errorName:e?.name||'Error',
    directLaunchAvailable:!timed&&!launch.disabled,
    message:timed?(preparingPayment?'Could not prepare the verified Google Pay payment. Retry the compatibility check.':
     'Chrome could not check the Google Pay app. Open the checkout directly in Chrome on Android and retry.'):
     'Compatibility check failed; direct P2P launch remains available while the session is valid.'});
  }
 });
 launch.addEventListener('click',async()=>{
  if(used||!inWindow())return;
  // Payment initiation does not require optional device integrity authorization.
  if(!win.isSecureContext||typeof win.PaymentRequest!=='function'){
   emit({state:'PAYMENT_REQUEST_UNAVAILABLE'});return;
  }
  if(timed&&(!request||!timedRef||Date.now()>=timedExpiresAt)){
   emit({state:'TIMED_CHALLENGE_PREPARATION_REQUIRED',debitVerified:false});return;
  }
  // Construct on the direct user gesture. A pre-check is diagnostic, not mandatory.
  if(!request){
   try{request=new win.PaymentRequest(config.methods,config.details)}
   catch(e){emit({state:'PAYMENT_REQUEST_CREATION_FAILED',errorName:e?.name||'Error'});return}
  }
  used=true;probe.disabled=true;launch.disabled=true;
  let response;
  const timeline=createTimeline(session);
  const onVisibility=()=>timeline.record(doc.visibilityState==='hidden'?'DOCUMENT_HIDDEN':'DOCUMENT_VISIBLE');
  const onBlur=()=>timeline.record('WINDOW_BLUR');
  const onFocus=()=>timeline.record('WINDOW_FOCUS');
  const onPageShow=()=>timeline.record('PAGE_RETURN');
  const onMotion=e=>{if(e?.accelerationIncludingGravity)timeline.motion()};
  doc.addEventListener?.('visibilitychange',onVisibility);
  win.addEventListener?.('blur',onBlur);
  win.addEventListener?.('focus',onFocus);
  win.addEventListener?.('pageshow',onPageShow);
  win.addEventListener?.('devicemotion',onMotion);
  cleanup=()=>{
   doc.removeEventListener?.('visibilitychange',onVisibility);
   win.removeEventListener?.('blur',onBlur);
   win.removeEventListener?.('focus',onFocus);
   win.removeEventListener?.('pageshow',onPageShow);
   win.removeEventListener?.('devicemotion',onMotion);
   timeline.close();
  };
  timeline.record('PAYMENT_LAUNCHED');
  try{
   response=await request.show();
   timeline.record('PAYMENT_RESPONSE');
   const observation=inspect(response,config.expected);
   emit({...observation,automaticSignals:timeline.snapshot(observation)});
   // The checkout controller sends the raw response to DISHA's session-authenticated
   // verification endpoint; the probe itself neither stores nor promotes payment claims.
   if(typeof env.onPaymentResponse==='function'){
    try{await env.onPaymentResponse({methodName:response.methodName,details:response.details},timed?timedRef:null);}
    catch(_){emit({state:'APP_RESPONSE_VERIFICATION_UNAVAILABLE',debitVerified:false,paymentVerified:false})}
   }
  }catch(e){
   timeline.record('PAYMENT_ERROR');
   emit({state:'P2P_PAYMENT_REQUEST_CANCELLED_OR_FAILED',errorName:e?.name||'Error',
    automaticSignals:timeline.snapshot(null),debitVerified:false});
  }finally{
   cleanup();
   if(response)try{await response.complete('unknown')}catch(_){}
   request=null;
  }
 });
 return true;
}
return Object.freeze({METHOD,build,inspect,createTimeline,attach});
});
