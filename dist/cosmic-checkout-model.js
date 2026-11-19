/* DISHA checkout presentation policy: no financial state inferred from browser return. */
(function(root){
 'use strict';
 function qrPayload(uri){
  if(typeof uri!=='string'||!/^upi:\/\/pay\?/i.test(uri))
   throw Error('A valid UPI payment URI is required');
  const query=new URLSearchParams(uri.slice(uri.indexOf('?')+1));
  // Revalidate the server URI before native dispatch without changing QR bytes.
  for(const key of ['pa','am','cu']){
   if(query.getAll(key).length!==1)throw Error('Incomplete UPI payment URI');
  }
  const payee=query.get('pa'),rawAmount=query.get('am');
  if(!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(payee))
   throw Error('Invalid receiving UPI ID');
  if(query.get('cu')!=='INR'||!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(rawAmount)||
     !Number.isFinite(Number(rawAmount))||Number(rawAmount)<0.01||Number(rawAmount)>100000)
   throw Error('Invalid UPI amount or currency');
  const mc=query.get('mc'),tr=query.get('tr');
  if((mc!==null||tr!==null)&&
     (!/^\d{4}$/.test(mc||'')||mc==='0000'||!/^[A-Za-z0-9]{1,35}$/.test(tr||'')))
   throw Error('Incomplete merchant UPI payment URI');
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
   // Use targeted intent for ALL Android browsers (except WebView), same as appTapLaunchUri
   if(!supportsTargetedAppLaunch(ua))return valid;
   const params=valid.slice(valid.indexOf('?')+1);
   const fallback=checkoutFallbackUrl(checkoutFallbackHref);
   // Build intent with fallback chain: GPay → PhonePe → Paytm → BHIM → generic
   const packages={gpay:'com.google.android.apps.nbu.paisa.user',
    phonepe:'com.phonepe.app',paytm:'net.one97.paytm',bhim:'in.org.npci.upiapp'};
   const chain=['gpay','phonepe','paytm','bhim'];
   const fallbackChain=chain.map(a=>packages[a]).join(';');
   return 'intent://pay?'+params+
    '#Intent;scheme=upi;action=android.intent.action.VIEW;'+
    (fallback?'S.browser_fallback_url='+encodeURIComponent(fallback)+';':'')+
    'S.browser_fallback_package='+encodeURIComponent(fallbackChain)+';end';
 }
// Package-targeted intent with fallback chain: GPay → PhonePe → Paytm → BHIM → generic.
// Prevents Android's last-used UPI app (e.g., Slice) from hijacking the payment.
// DEFAULT for ALL Android browsers (except WebView): targeted intent with fallback chain.
 function supportsTargetedAppLaunch(userAgent){
  const ua=String(userAgent||'');
  const isAndroid=/Android/i.test(ua);
  const isWebView=/(?:;|\s)wv(?:\)|;|\s)|\bVersion\/4\.0\b/i.test(ua);
  return isAndroid && !isWebView;
 }
 function appTapLaunchUri(uri,userAgent,checkoutFallbackHref,app){
  const valid=qrPayload(uri);
  const packages={gpay:'com.google.android.apps.nbu.paisa.user',
   phonepe:'com.phonepe.app',paytm:'net.one97.paytm',bhim:'in.org.npci.upiapp'};
  const pkg=packages[app];
  if(!pkg)throw Error('Unsupported UPI app');
  if(!supportsTargetedAppLaunch(userAgent))return valid;
  // Build intent with fallback chain
  const chain=['gpay','phonepe','paytm','bhim'];
  const fallbackChain=chain.map(a=>packages[a]).join(';');
  const params=valid.slice(valid.indexOf('?')+1);
  const fallback=checkoutFallbackUrl(checkoutFallbackHref);
  return 'intent://pay?'+params+
   '#Intent;scheme=upi;action=android.intent.action.VIEW;package='+pkg+';'+
   (fallback?'S.browser_fallback_url='+encodeURIComponent(fallback)+';':'')+
   'S.browser_fallback_package='+encodeURIComponent(fallbackChain)+';end';
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