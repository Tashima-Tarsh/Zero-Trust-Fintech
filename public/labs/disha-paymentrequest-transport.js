/* Adapter: real Android PAY activity can be used only once Chrome recognizes
 * the DISHA-owned HTTPS payment method. Never invokes an actual UPI payment.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISHADebitPaymentRequestTransport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const METHOD='https://disha8-2.thenitishkr.in/labs/disha-debit-bridge-method';
function make({PaymentRequestClass,requireGesture=()=>false}={}){
  if(typeof PaymentRequestClass!=='function')throw Error('PAYMENT_REQUEST_UNAVAILABLE');
  return Object.freeze({
    async request(expected){
      if(!requireGesture())throw Error('LIVE_USER_GESTURE_REQUIRED');
      const amount=(Number(expected.amountPaise)/100).toFixed(2);
      const request=new PaymentRequestClass(
        [{supportedMethods:METHOD,data:{
          protocol:'DISHA-DEBIT-BRIDGE-LAB-V1',
          orderId:expected.orderId,nonce:expected.nonce,
          amountPaise:expected.amountPaise,payeeVpa:expected.payeeVpa
        }}],
        {total:{label:'DISHA synthetic transport test — NOT A PAYMENT',amount:{currency:'INR',value:amount}}}
      );
      let response;
      try{
        response=await request.show();
        if(!response||response.methodName!==METHOD)return {protocol:'WRONG_METHOD'};
        const result=response.details;
        if(!result||typeof result!=='object'||Array.isArray(result))return {protocol:'INVALID_DETAILS'};
        return result;
      }catch(error){
        if(error?.name==='AbortError'||error?.name==='NotAllowedError')return null;
        throw error;
      }finally{
        if(response&&typeof response.complete==='function'){
          try{await response.complete('unknown')}catch(_){}
        }
      }
    }
  });
}
return Object.freeze({METHOD,make});
});
