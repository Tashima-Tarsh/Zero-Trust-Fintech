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
 if(!node||!win||!win.location||new URLSearchParams(win.location.search).get('paymentrequest')!=='1')return false;
 const config=build(session,win.location.origin);
 if(!config)return false;
 node.hidden=false;
 const probe=doc.getElementById('p2pPaymentRequestCheck');
 const launch=doc.getElementById('p2pPaymentRequestLaunch');
 const status=doc.getElementById('p2pPaymentRequestStatus');
 const emit=o=>{status.textContent=JSON.stringify(o)};
 const inWindow=()=>Number.isFinite(session.expiresAt)&&Date.now()<session.expiresAt;
 let request=null,used=false,cleanup=()=>{};
 emit({state:'READY_FOR_P2P_CAPABILITY_CHECK',method:METHOD,realPaymentStarted:false});
 probe.addEventListener('click',async()=>{
  launch.disabled=true;request=null;
  if(!inWindow()){emit({state:'SESSION_EXPIRED'});return}
  if(!win.isSecureContext||typeof win.PaymentRequest!=='function'){emit({state:'PAYMENT_REQUEST_UNAVAILABLE'});return}
  try{
   const candidate=new win.PaymentRequest(config.methods,config.details);
   const available=await candidate.canMakePayment();
   if(!inWindow()){emit({state:'SESSION_EXPIRED'});return}
   request=available?candidate:null;launch.disabled=!available;
   emit({state:available?'P2P_METHOD_HANDLER_FOUND':'NO_P2P_METHOD_HANDLER',realPaymentStarted:false});
  }catch(e){emit({state:'CAPABILITY_PROBE_FAILED',errorName:e?.name||'Error'})}
 });
 launch.addEventListener('click',async()=>{
  if(!request||used||!inWindow())return;
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
    try{await env.onPaymentResponse({methodName:response.methodName,details:response.details});}
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
