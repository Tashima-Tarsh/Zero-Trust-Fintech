/* First-party frontend signals: privacy-minimized event categories only.
 * Deliberately excludes messages, stack traces, URLs with query strings, payment
 * data, tokens, PINs, browser IDs and customer identifiers.
 */
(()=>{'use strict';
 if(!window.fetch||location.protocol!=='https:')return;
 const pages=new Set(['/','/owner','/dashboard','/login','/checkout','/p2p','/p2m','/p2m/checkout',
  '/merchant-checkout.html','/choose-payment','/request-access']);
 const path=location.pathname.replace(/\/$/,'')||'/';
 if(!pages.has(path))return;
 const component=path==='/owner'?'OWNER':path==='/dashboard'?'MERCHANT':
   ['/p2p','/p2m','/p2m/checkout','/checkout','/choose-payment','/merchant-checkout.html'].includes(path)?'CHECKOUT':
   path==='/login'?'LOGIN':'LANDING';
 const once=new Set();let requests=0;
 function report(category){
  if(requests>=5||once.has(category))return;
  once.add(category);requests++;
  try{
   void fetch('/api/platform/public/frontend-error',{
    method:'POST',credentials:'same-origin',mode:'same-origin',cache:'no-store',keepalive:true,
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({page:path,component,category})
   }).catch(()=>{});
  }catch(_){}
 }
 window.addEventListener('error',event=>{
   if(event.target&&event.target!==window){report('RESOURCE_ERROR');return}
   report('JS_ERROR');
 },true);
 window.addEventListener('unhandledrejection',()=>report('UNHANDLED_REJECTION'));
})();