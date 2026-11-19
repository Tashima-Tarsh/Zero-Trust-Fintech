/* DISHA checkout presentation policy: no financial state inferred from browser return. */
(function(root){
 'use strict';
 function qrPayload(uri){
  if(typeof uri!=='string'||!/^upi:\/\/pay\?[a-z]+=/i.test(uri))throw Error('A valid UPI payment URI is required');
  const query=new URLSearchParams(uri.slice(uri.indexOf('?')+1));
  if(!query.get('pa')||!query.get('am')||query.get('cu')!=='INR')throw Error('Incomplete UPI payment URI');
  return uri;
 }
 function supportsNativeUPI(userAgent){
  return /Android|iPhone|iPad|iPod/i.test(String(userAgent||''));
 }
 function checkoutFallbackUrl(href){
  try{
   const page=new URL(href);
   if(page.protocol!=='https:'&&page.protocol!=='http:')return '';
   page.hash='';
   page.searchParams.set('upi_intent_fallback','1');
   return page.href;
  }catch(_){return ''}
 }
 // Android Chrome supports intent:// with a direct user gesture. The
 // bank-scannable UPI QR remains unchanged and Android WebViews still get upi://pay.
 function qrTapLaunchUri(uri,userAgent,checkoutFallbackHref){
  const valid=qrPayload(uri),ua=String(userAgent||'');
  const chromeAndroid=/Android/i.test(ua)&&/Chrome\/\d+/i.test(ua);
  const webView=/(?:;|\s)wv(?:\)|;|\s)|\bVersion\/4\.0\b/i.test(ua);
  if(!chromeAndroid||webView)return valid;
  const params=valid.slice(valid.indexOf('?')+1);
  const fallback=checkoutFallbackUrl(checkoutFallbackHref);
  return 'intent://pay?'+params+
   '#Intent;scheme=upi;action=android.intent.action.VIEW;'+
   (fallback?'S.browser_fallback_url='+encodeURIComponent(fallback)+';':'')+'end';
 }
 // A package-targeted Chrome Intent prevents Android's last-used UPI app
 // (for example Slice) from silently replacing a customer's explicit choice.
 function supportsTargetedAppLaunch(userAgent){
  const ua=String(userAgent||'');
  return /Android/i.test(ua)&&/Chrome\/\d+/i.test(ua)&&
   !/(?:;|\s)wv(?:\)|;|\s)|\bVersion\/4\.0\b|SamsungBrowser\/|EdgA\/|OPR\//i.test(ua);
 }
 function appTapLaunchUri(uri,userAgent,checkoutFallbackHref,app){
  const valid=qrPayload(uri);
  const packages={gpay:'com.google.android.apps.nbu.paisa.user',
   phonepe:'com.phonepe.app',paytm:'net.one97.paytm',bhim:'in.org.npci.upiapp'};
  const pkg=packages[app];
  if(!pkg)throw Error('Unsupported UPI app');
  if(!supportsTargetedAppLaunch(userAgent))return valid;
  return qrTapLaunchUri(valid,userAgent,checkoutFallbackHref)
   .replace('#Intent;scheme=upi;','#Intent;scheme=upi;package='+pkg+';');
 }
 function isSettled(record){
  return Boolean(record&&record.status==='SUCCESS'&&typeof record.utr==='string'&&/^[0-9]{12}$/.test(record.utr));
 }
 function userFacingError(error,context){
  // Do not disclose browser, device or backend exception details in checkout.
  if(context==='load')
   return 'Error — Checkout could not load. Refresh or request a new payment link.';
  if(error && (error.name==='TypeError'||error.name==='NetworkError'))
   return 'Error — Connection unavailable. Please check your internet and try again.';
  if(context==='app')
   return 'Error — Could not open the UPI app. Scan the QR from another phone.';
  return 'Error — This payment could not load. Please retry.';
 }
 function formatINR(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)throw Error('Invalid payment amount');
  return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
 }
 const api=Object.freeze({qrPayload,qrTapLaunchUri,appTapLaunchUri,supportsTargetedAppLaunch,checkoutFallbackUrl,supportsNativeUPI,isSettled,formatINR,userFacingError});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.DISHACosmicCheckoutModel=api;
})(typeof window!=='undefined'?window:globalThis);
