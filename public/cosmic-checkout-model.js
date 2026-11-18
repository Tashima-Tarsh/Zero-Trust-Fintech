/* DISHA checkout presentation policy: no financial state inferred from browser return. */
(function(root){
 'use strict';
 const APPS=Object.freeze({
   gpay:{package:'com.google.android.apps.nbu.paisa.user',ios:'gpay://upi/pay?'},
   phonepe:{package:'com.phonepe.app',ios:'phonepe://pay?'},
   paytm:{package:'net.one97.paytm',ios:'paytmmp://pay?'},
   cred:{package:null,ios:null},
   generic:{package:null,ios:null}
 });
 function safeApp(value){
  const v=String(value||'').toLowerCase().trim().replace(/\s+/g,'');
  if(v==='googlepay'||v==='google-pay')return 'gpay';
  return Object.hasOwn(APPS,v)?v:'generic';
 }
 function qrPayload(uri){
  if(typeof uri!=='string'||!/^upi:\/\/pay\?[a-z]+=/i.test(uri))throw Error('A valid UPI payment URI is required');
  const query=new URLSearchParams(uri.slice(uri.indexOf('?')+1));
  if(!query.get('pa')||!query.get('am')||query.get('cu')!=='INR')throw Error('Incomplete UPI payment URI');
  return uri;
 }
 function buildAppUrl(uri,app,userAgent){
  const valid=qrPayload(uri),selected=APPS[safeApp(app)];
  const params=valid.slice(valid.indexOf('?')+1);
  if(/Android/i.test(userAgent||'') && selected.package)
   return 'intent://pay?'+params+'#Intent;scheme=upi;package='+selected.package+';end';
  if(/iPhone|iPad|iPod/i.test(userAgent||'')&&selected.ios)
   return selected.ios+params;
  return valid;
 }
 function isSettled(record){
  return Boolean(record&&record.status==='SUCCESS'&&typeof record.utr==='string'&&/^[0-9]{12}$/.test(record.utr));
 }
 function stageAfterAuthorization(){return 'methods'}
 function formatINR(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)throw Error('Invalid payment amount');
  return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
 }
 const api=Object.freeze({safeApp,qrPayload,buildAppUrl,isSettled,stageAfterAuthorization,formatINR});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.DISHACosmicCheckoutModel=api;
})(typeof window!=='undefined'?window:globalThis);
