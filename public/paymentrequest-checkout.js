/* Optional real-browser PaymentRequest probe for an existing DISHA P2M order.
 * No checkout status mutation, no server upload of raw payment data. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISHAP2MPaymentRequest=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
 const METHOD='https://tez.google.com/pay';
 function asP2MParameters(session,origin,path){
  if(!session||!['P2M','MERCHANT'].includes(String(session.paymentType||'').toUpperCase()))return null;
  if(!/^https:\/\//.test(origin||''))return null;
  if(!session.upiUri||!/^upi:\/\/pay\?/i.test(session.upiUri))return null;
  const uri=new URL(session.upiUri);
  const p=uri.searchParams;
  const pa=p.get('pa')||'',pn=p.get('pn')||'',mc=p.get('mc')||'',tr=p.get('tr')||'';
  const amount=Number(session.amount);
  if(!/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i.test(pa)||!pn.trim()||
   !/^\d{4}$/.test(mc)||!/^[A-Za-z0-9._-]{6,35}$/.test(tr)||
   !Number.isFinite(amount)||amount<=0||amount>100000||
   p.get('cu')!=='INR')return null;
  if(session.payeeVpa&&pa.toLowerCase()!==String(session.payeeVpa).toLowerCase())return null;
  return {payeeVpa:pa,payeeName:pn,mcc:mc,transactionRef:tr,amount:amount.toFixed(2),
   orderUrl:origin+path};
 }
 function attach(session,env){
  const win=env.window,doc=env.document,section=doc.getElementById('paymentRequestLab');
  if(!section||!win||!win.DISHAPaymentResponseLab)return false;
  const enabled=new URLSearchParams(win.location.search).get('paymentrequest')==='1';
  const parameters=enabled?asP2MParameters(session,win.location.origin,win.location.pathname):null;
  if(!parameters)return false;
  section.hidden=false;
  const probe=doc.getElementById('paymentRequestProbe');
  const launch=doc.getElementById('paymentRequestLaunch');
  const status=doc.getElementById('paymentRequestStatus');
  const lib=win.DISHAPaymentResponseLab;
  let request=null,attempted=false;
  const write=(data)=>{status.textContent=JSON.stringify(data);};
  write({state:'READY_TO_PROBE',method:METHOD,realPaymentStarted:false});
  probe.addEventListener('click',async()=>{
   launch.disabled=true;request=null;
   if(Date.now()>=session.expiresAt){write({state:'SESSION_EXPIRED'});return}
   if(!win.isSecureContext||typeof win.PaymentRequest!=='function'){
    write({state:'PAYMENT_REQUEST_UNAVAILABLE'});return;
   }
   try{
    const data=lib.requestData(parameters);
    const candidate=new win.PaymentRequest(data.methods,data.details);
    const available=await candidate.canMakePayment();
    if(Date.now()>=session.expiresAt){write({state:'SESSION_EXPIRED'});return}
    request=available?candidate:null;
    launch.disabled=!available;
    write({state:available?'SUPPORTED_PAYMENT_APP':'NO_SUPPORTED_PAYMENT_APP',method:METHOD,realPaymentStarted:false});
   }catch(e){write({state:'CAPABILITY_CHECK_FAILED',errorName:e?.name||'Error'})}
  });
  launch.addEventListener('click',async()=>{
   if(!request||attempted||Date.now()>=session.expiresAt)return;
   attempted=true;launch.disabled=true;probe.disabled=true;
   let response;
   try{
    response=await request.show();
    const result=lib.inspectResponse(response,parameters);
    // Returned app fields are observations until an independent signature verifier approves.
    write({...result,orderId:session.orderId||null,checkoutVerified:false,source:'ANDROID_PAYMENT_REQUEST_RETURN'});
   }catch(e){write({state:'PAYMENT_REQUEST_CANCELLED_OR_FAILED',errorName:e?.name||'Error',checkoutVerified:false})}
   finally{
    if(response)try{await response.complete('unknown')}catch(_){}
    request=null;
   }
  });
  return true;
 }
 return Object.freeze({METHOD,asP2MParameters,attach});
});
