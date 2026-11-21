/* Standalone, no production imports. Response metadata only; never logs raw payment details. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISHAPaymentResponseLab=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const METHOD='https://tez.google.com/pay';
const vpa=/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/i;
const amount=/^(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/;
function requestData(p){
 if(!p||!vpa.test(p.payeeVpa||'')||!amount.test(p.amount||'')||!/^\d{4}$/.test(p.mcc||'')||
 !/^[A-Za-z0-9._-]{6,35}$/.test(p.transactionRef||'')||!(p.payeeName||'').trim()||
 !/^https:\/\//.test(p.orderUrl||''))throw Error('INVALID_LAB_PAYMENT_PARAMETERS');
 return {methods:[{supportedMethods:METHOD,data:{pa:p.payeeVpa,pn:p.payeeName,tr:p.transactionRef,mc:p.mcc,url:p.orderUrl,tn:'DISHA isolated payment response research'}}],details:{total:{label:'DISHA isolated transaction response experiment',amount:{currency:'INR',value:p.amount}}}};
}
function inspectResponse(response,expected){
 if(!response||response.methodName!==METHOD)return {result:'UNSUPPORTED_OR_UNEXPECTED_PAYMENT_METHOD',bankRrnProven:false};
 const d=response.details&&typeof response.details==='object'?response.details:{};
 let t=null;
 if(typeof d.tezResponse==='string'){try{t=JSON.parse(d.tezResponse)}catch(_){return {result:'MALFORMED_TEZ_RESPONSE',bankRrnProven:false}}}
 else if(d.tezResponse&&typeof d.tezResponse==='object')t=d.tezResponse;
 if(!t||typeof t!=='object'||Array.isArray(t))return {result:'NO_TEZ_RESPONSE',bankRrnProven:false};
 const field=(k)=>typeof t[k]==='string'?t[k]:null;
 const txnId=field('txnId');
 const status=field('Status')||field('status');
 const returnedAmount=field('amount');
 const returnedVpa=field('toVpa');
 const returnedRef=field('txnRef');
 const matchAmount=returnedAmount===expected.amount;
 const matchPayee=typeof returnedVpa==='string'&&returnedVpa.toLowerCase()===expected.payeeVpa.toLowerCase();
 const matchRequestRef=returnedRef===expected.transactionRef;
 return {result:'TEZ_RESPONSE_OBSERVED',status:status||'MISSING',transactionIdPresent:Boolean(txnId),transactionIdFormat:txnId?/^[0-9]{12}$/.test(txnId)?'12_DIGIT':'OTHER':'NONE',
  merchantReferenceEchoed:matchRequestRef,amountMatches:matchAmount,payeeMatches:matchPayee,
  googlePaySignaturePresent:typeof d.signature==='string'&&d.signature.length>0,
  googlePaySignatureVerified:false,bankRrnProven:false,paymentVerified:false,debitVerified:false,
  sessionCorrelated:matchAmount&&matchPayee&&matchRequestRef,
  // The returned UPI transaction ID is not automatically an RRN or bank-authenticated debit.
  evidenceState:txnId&&matchAmount&&matchPayee&&matchRequestRef?'PROVIDER_REPORTED_TRANSACTION_ID_UNVERIFIED':'INCOMPLETE_OR_CONFLICTING_RETURN'};
}
return Object.freeze({METHOD,requestData,inspectResponse});
});
