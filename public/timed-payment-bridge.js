/* DISHA 120-second signed provider-return browser adapter.
 * prepare() happens before Pay click; pay() must run from a direct user gesture.
 * This does not install a DISHA app and does not perform bank debit verification.
 */
(function(root,factory){'use strict';
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.DISHATimedPaymentBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
 const METHOD='https://tez.google.com/pay';
 function create({fetchImpl,PaymentRequestClass,clock=()=>Date.now(),base='/api/upi-app-evidence/timed'}={}){
  if(typeof fetchImpl!=='function'||typeof PaymentRequestClass!=='function')
   throw Error('BROWSER_CAPABILITY_UNAVAILABLE');
  async function send(path,payload,token){
   const r=await fetchImpl(base+path,{
    method:'POST',redirect:'error',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-CSRF-Token':token},
    body:JSON.stringify(payload)
   });
   if(!r.ok)throw Error('TIMED_BRIDGE_SERVER_REJECTED_'+r.status);
   return r.json();
  }
  async function prepare({orderId,token}){
   if(typeof orderId!=='string'||!orderId||typeof token!=='string'||!token)
    throw Error('SESSION_REQUIRED');
   const prepared=await send('/prepare',{orderId,token},token);
   if(!prepared||typeof prepared.transactionRef!=='string'||
     !/^[a-f0-9]{32}$/.test(prepared.transactionRef)||
     !Number.isFinite(prepared.expiresAt)||clock()>=prepared.expiresAt||
     prepared.expiresAt>clock()+120000||!prepared.paymentRequest||
     !Array.isArray(prepared.paymentRequest.methods)||
     prepared.paymentRequest.methods.length!==1||
     prepared.paymentRequest.methods[0].supportedMethods!==METHOD)
     throw Error('INVALID_PREPARED_PAYMENT_REQUEST');
   const request=new PaymentRequestClass(prepared.paymentRequest.methods,prepared.paymentRequest.details);
   let used=false;
   return Object.freeze({
    expiresAt:prepared.expiresAt,
    canMakePayment:()=>request.canMakePayment(),
    async pay(){
     if(used)throw Error('PAYMENT_REQUEST_ALREADY_USED');
     used=true;
     if(clock()>=prepared.expiresAt)throw Error('CHECKOUT_EXPIRED');
     // Caller invokes pay() synchronously inside the Pay button click handler.
     let response;
     try{
      response=await request.show();
      if(!response||response.methodName!==METHOD)throw Error('UNEXPECTED_PROVIDER_METHOD');
      const d=response.details;
      if(!d||typeof d!=='object'||Array.isArray(d))throw Error('MISSING_PROVIDER_DETAILS');
      const details={tezResponse:d.tezResponse,signature:d.signature,signatureKeyId:d.signatureKeyId};
      return await send('/accept',{
       orderId,token,transactionRef:prepared.transactionRef,
       methodName:response.methodName,details
      },token);
     }finally{
      if(response&&typeof response.complete==='function'){
       try{await response.complete('unknown')}catch(_){}
      }
     }
    }
   });
  }
  return Object.freeze({prepare});
 }
 return Object.freeze({METHOD,create});
});
