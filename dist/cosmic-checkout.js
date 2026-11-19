/* DISHA 8.2 cosmic checkout — presentation only. Bank outcome remains server-authoritative. */
(function(){
 'use strict';
 const model=window.DISHACosmicCheckoutModel;
 const get=id=>document.getElementById(id);
 const mode=document.body.dataset.checkout==='merchant'?'merchant':'generic';
 const query=new URLSearchParams(location.search);
 const resumeKey='disha82:upi-payment-resume:v2';
 const stages=[...document.querySelectorAll('[data-stage]')];
 let session=null,polling=false,receiptShown=false;
 let qrUri=null,lastStage='qr',expiryTicker=null,ledgerTicker=null;
 let expiryLogged=false;
 // Browser-only diagnostics for direct QR taps. Not evidence of a bank payment.
 let qrTapStartedAt=0,qrAppBackgrounded=false,lastNativeLaunchAt=0;
 // Prevent rapid repeated taps from dispatching another UPI activity while
 // the first handoff is still opening or returning.
 const nativeLaunchCooldownMs=6000;
 const userAgent=navigator.userAgent||'';
 const orderId=()=>session?.orderId||null;
 const debug=query.get('debug')==='1';
 const debugHistory=[];
 function debugStatus(phase,server=''){
  if(!debug)return;
  const status=get('checkoutDebugStage');
  if(status)status.textContent=phase+(server?' · '+server:'');
 }
 function copyDebugReport(){
  if(!debug)return;
  const report='DISHA checkout diagnostic v2\n'+
   'Payment reference: '+(orderId()||'not-created')+'\n'+
   'Device: '+device+'\n'+
   debugHistory.map(x=>x.time+' '+x.event+' '+x.code+' '+x.app).join('\n');
  if(navigator.clipboard?.writeText){
   navigator.clipboard.writeText(report).then(()=>debugStatus('Trace copied')).catch(()=>debugStatus('Copy not permitted'));
  }else debugStatus('Clipboard unavailable');
 }

 const device=/Android/i.test(userAgent)?'android':/iPhone|iPad|iPod/i.test(userAgent)?'ios':/Windows|Macintosh|Linux/i.test(userAgent)?'desktop':'other';
 function debugCode(error){
  const status=Number(error?.status);
  if([400,401,403,404,409,429,500,503].includes(status))return 'BACKEND_'+status;
  if(Number.isInteger(status)&&status>=400)return 'BACKEND_OTHER';
  const name=String(error?.name||'');
  if(name==='NotAllowedError')return 'NOT_ALLOWED_OR_TIMEOUT';
  if(name==='SecurityError')return 'SECURITY_ERROR';
  if(name==='NotSupportedError')return 'NOT_SUPPORTED';
  if(name==='InvalidStateError')return 'INVALID_STATE';
  if(name==='AbortError')return 'ABORTED';
  if(name==='TypeError')return 'NETWORK_ERROR';
  return 'UNKNOWN';
 }
 // Test-only, fire-and-forget. No raw browser error, UPI URI, PIN, passkey
 // response, device identifier or transaction data are collected.
 function trace(event,code='OK',app='none'){
  if(!debug||!session?.token||!session?.orderId)return;
  const selected=['gpay','phonepe','paytm','cred','generic'].includes(app)?app:'none';
  try{
   debugHistory.push({time:new Date().toISOString(),event,code,app:selected});
   if(debugHistory.length>45)debugHistory.shift();
   sessionStorage.setItem('disha82:diag:'+session.orderId,JSON.stringify(debugHistory));
  }catch(_){}
  debugStatus(event+' / '+code,'sending');
  try{
   void fetch('/api/checkout/trace',{method:'POST',cache:'no-store',keepalive:true,
    credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.token},
    body:JSON.stringify({orderId:session.orderId,token:session.token,event,code,
     app:selected,device})
   }).then(response=>{if(debugHistory.at(-1)?.event===event)
     debugStatus(event+' / '+code,response.ok?'saved':'upload failed')})
     .catch(()=>{if(debugHistory.at(-1)?.event===event)
       debugStatus(event+' / '+code,'offline')});
  }catch(_){debugStatus(event+' / '+code,'unavailable')}
 }

 function showStage(stage){
  const next=stages.find(el=>el.dataset.stage===stage);
  if(!next)return;
  stages.forEach(el=>{el.hidden=el!==next});
  lastStage=stage;
  clearStatus();
  if(stage==='qr')renderQr();
 }
 function clearStatus(){const node=get('checkoutStatus');node.hidden=true;node.textContent='';node.removeAttribute('data-kind')}
 function message(text,kind=''){
  const node=get('checkoutStatus');node.hidden=false;node.textContent=text;
  if(kind)node.dataset.kind=kind;else node.removeAttribute('data-kind');
 }
 function locked(text){
  const qr=get('qrTapToPay');
  if(qr){qr.setAttribute('aria-disabled','true');qr.href='#'}
  if(text)message(text,'error');
 }
 function format(v){return model.formatINR(v)}
 function urlWithToken(route){
  return route+encodeURIComponent(session.orderId)+'?token='+encodeURIComponent(session.token);
 }
 function parseSessionOrder(raw){
  if(!raw||raw.success!==true)throw Error(raw?.error||'Payment request unavailable');
  if(mode==='merchant'){
   const o=raw.order;
   if(!o?.id||!o.upi_uri||!Number(o.amount))throw Error('Payment link is incomplete');
   return {orderId:o.id,token:query.get('token'),upiUri:model.qrPayload(o.upi_uri),
     amount:Number(o.amount),expiresAt:Number(o.expires_at),initialStatus:o.status,
     paymentType:o.payment_type,payeeVpa:o.vpa_address};
  }
  if(raw.session){
   const o=raw.session;
   if(!o.orderId||!raw.upiLink||!Number(o.challengeAmount))throw Error('Payment link is incomplete');
   return {orderId:o.orderId,token:query.get('token'),upiUri:model.qrPayload(raw.upiLink),
    amount:Number(o.challengeAmount),expiresAt:Number(o.expiresAt),initialStatus:o.status,
    paymentType:o.merchantType,payeeVpa:o.vpaAddress};
  }
  return {orderId:raw.orderId,token:raw.sessionId,
   upiUri:model.qrPayload(raw.upiLink),amount:Number(raw.challengeAmount),
   expiresAt:Number(raw.expiresAt),initialStatus:'PENDING',
   paymentType:raw.paymentType,payeeVpa:raw.vpaAddress};
 }
 function saveSessionState(){
  if(mode!=='generic'||!session||query.has('paymentRef')||query.has('orderId'))return;
  try{
   sessionStorage.setItem(resumeKey,JSON.stringify({
    ...session,requestedAmount:query.get('amount')||'1',savedAt:Date.now()
   }));
  }catch(_){}
 }
 async function recoverSessionState(requestedAmount){
  try{
   const old=JSON.parse(sessionStorage.getItem(resumeKey)||'null');
   if(!old||old.requestedAmount!==requestedAmount||
      Date.now()-Number(old.savedAt)>900000||
      !/^[A-Za-z0-9_-]{6,150}$/.test(old.orderId||'')||
      !/^[a-f0-9]{24,64}$/i.test(old.token||'')||
      !Number.isFinite(Number(old.amount))||
      !Number.isFinite(Number(old.expiresAt)))return null;
   model.qrPayload(old.upiUri);
   const response=await fetch('/api/ledger/'+encodeURIComponent(old.orderId)+
     '?token='+encodeURIComponent(old.token),{cache:'no-store',credentials:'same-origin'});
   if(!response.ok)return null;
   // A cached device authorization may survive longer than the three-minute
   // bank payment window. Never resurrect an expired, unpaid payment intent.
   // Preserve an already confirmed receipt even after the original expiry.
   const state=await response.json().catch(()=>({}));
   if(Date.now()>=Number(old.expiresAt)&&!model.isSettled(state))return null;
   return old;
  }catch(_){return null}
 }
 async function getSession(){
  let url;
  if(mode==='merchant'){
   const id=query.get('paymentRef')||query.get('orderId'),token=query.get('token');
   if(!id||!token)throw Error('This payment link is incomplete. Request a new link.');
   url='/api/merchant/public/'+(query.has('paymentRef')?'payment/':'order/')+
    encodeURIComponent(id)+'?token='+encodeURIComponent(token);
  }else if(query.has('paymentRef')||query.has('orderId')||query.has('token')){
   const id=query.get('paymentRef')||query.get('orderId'),token=query.get('token');
   if(!/^[a-z0-9_-]{6,150}$/i.test(id||'')||!/^[a-f0-9]{24,64}$/i.test(token||''))
    throw Error('This payment link is incomplete. Request a new link.');
   url='/api/session/'+encodeURIComponent(id)+'?token='+encodeURIComponent(token);
  }else{
   const raw=query.get('amount')||'1';
   const amount=Number(raw);
   if(!Number.isFinite(amount)||amount<=0||amount>100000)
    throw Error('Invalid payment amount. Open a valid payment link.');
   const recovered=await recoverSessionState(raw);
   if(recovered)return recovered;
   url='/api/session/new?amount='+encodeURIComponent(amount.toFixed(2))+
     '&description='+encodeURIComponent('UPI intent');
  }
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||body.message||'Unable to load your payment request');
  return parseSessionOrder(body);
 }
 function expired(){return Boolean(session?.expiresAt && Date.now()>session.expiresAt)}
 function setMoney(amount){get('payAmount').textContent=format(amount)}
 function setPaymentKind(){
  const label=get('paymentKind');
  if(!label||!session)return;
  const p=new URLSearchParams(session.upiUri.split('?')[1]||'');
  const kind=session.paymentType==='P2M'?'P2M':'P2P';
  const name=kind==='P2M'?'Merchant receiving UPI':'Personal receiving UPI';
  const payee=session.payeeVpa||p.get('pa')||'';
  label.textContent=kind+' · '+name+(payee?' · '+payee:'');
 }
 function createReceipt(record){
  if(!model.isSettled(record)||receiptShown)return;
  receiptShown=true;
  trace('LEDGER_CONFIRMED');
  get('receiptAmount').textContent=format(record.challengeAmount||session.amount);
  get('receiptPaymentRef').textContent='PAY '+String(session.orderId).replace(/^[^_]*_/, '');
  get('receiptUtr').textContent=record.utr;
  showStage('receipt');
  if(ledgerTicker)clearInterval(ledgerTicker);
 }
 async function pollLedger(){
  if(!session||polling||receiptShown||document.visibilityState==='hidden')return;
  polling=true;
  try{
   const r=await fetch(urlWithToken('/api/ledger/'),{cache:'no-store',credentials:'same-origin'});
   if(r.ok){
    const result=await r.json();
    if(model.isSettled(result)){createReceipt(result);return}
    const tracker=get('paymentTrackingStatus');
    if(tracker){
     const state=String(result.status||'PENDING').toUpperCase();
     tracker.textContent=state==='PENDING'
      ?'Payment status · Awaiting confirmation'
      :state==='EXPIRED'?'Payment status · Window expired, checking recorded credit'
      :state==='FAILED'||state==='CANCELLED'?'Payment status · Not completed'
      :'Payment status · Checking recorded credit';
    }
}
   if(expired()){
    if(lastStage==='qr')get('qrExpiry').textContent='This QR has expired. Request a new payment link.';
    
    
   }
  }catch(_){
   // A network failure is not evidence of payment failure.
   const tracker=get('paymentTrackingStatus');
   if(tracker)tracker.textContent='Payment status · Connection unavailable, retrying';
  }finally{polling=false}
 }
 function tickSessionTimer(){
  const node=get('checkoutTimer');
  if(!node||!session)return;
  if(receiptShown){node.textContent='Payment confirmed';return}
  const remaining=['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)
   ?0:Math.max(0,Math.ceil((session.expiresAt-Date.now())/1000));
  const mm=String(Math.floor(remaining/60)).padStart(2,'0');
  const ss=String(remaining%60).padStart(2,'0');
  node.textContent=remaining?'Session expires in '+mm+':'+ss:'Session expired · Request a new payment link';
  node.dataset.expired=String(remaining===0);
  if(remaining===0&&!expiryLogged){expiryLogged=true;trace('SESSION_EXPIRED')}
  if(lastStage==='qr')handleQrExpiry();
 }
 function handleQrExpiry(){
  if(!session||lastStage!=='qr')return;
  const left=['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)
   ?0:Math.max(0,Math.ceil((session.expiresAt-Date.now())/1000));
  get('qrExpiry').textContent=left>0?'QR valid for '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')+
    ' · Linked to this payment request':'Payment link expired — request a new link';
  get('paymentQr').classList.toggle('is-expired',left===0);
  if(left===0){
   get('qrTapToPay').href='#';
   get('qrTapToPay').setAttribute('aria-disabled','true');
   get('paymentQr').replaceChildren();
   qrUri=null;
  }
 }
 // Chrome fallback returns to this exact payment, not a new amount-based session.
 function secureCheckoutUrl(forFallback=false){
  const u=new URL(mode==='merchant'?'/merchant-checkout.html':'/checkout',location.href);
  u.searchParams.set('paymentRef',session.orderId);
  u.searchParams.set('token',session.token);
  if(forFallback)u.searchParams.set('upi_intent_fallback','1');
  return u.href;
 }
 function renderQr(){
  if(!session)return;
  const anchor=get('qrTapToPay'),container=get('paymentQr');
  if(expired()||['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)){
   anchor.href='#';anchor.setAttribute('aria-disabled','true');
   container.replaceChildren();qrUri=null;handleQrExpiry();return;
  }
  anchor.href=model.supportsNativeUPI(userAgent)
   ?model.qrTapLaunchUri(session.upiUri,userAgent,secureCheckoutUrl(true)):'#';
  anchor.setAttribute('aria-disabled','false');
  if(qrUri!==session.upiUri){
   container.replaceChildren();
   if(typeof window.QRCode!=='function'){
    message('Payment QR unavailable. Refresh the checkout.','error');
    return;
   }
   // Dark QR modules and white quiet zone maximize scan reliability.
   new window.QRCode(container,{text:session.upiUri,width:248,height:248,
    correctLevel:window.QRCode.CorrectLevel.M,
    colorDark:'#0a1024',colorLight:'#ffffff'});
   qrUri=session.upiUri;
  }
  handleQrExpiry();
 }
 function onReturn(){
  if(!session||receiptShown||document.visibilityState==='hidden')return;
  tickSessionTimer();
  if(qrTapStartedAt&&qrAppBackgrounded){
   const early=Date.now()-qrTapStartedAt<12000;
   trace('BROWSER_RETURN',early?'RETURN_FAST':'RETURN_NORMAL');
   if(early&&lastStage==='qr')
    message('UPI app returned quickly. Check its payment history before retrying.','info');
   qrTapStartedAt=0;qrAppBackgrounded=false;
  }
  void pollLedger();
 }
 function setEventHandlers(){
  get('qrTapToPay').addEventListener('click',event=>{
   if(!session||receiptShown||expired()||
      ['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)||!model.supportsNativeUPI(userAgent)){
    event.preventDefault();
    message(expired()?'Payment window expired. Request a fresh link.':
     'Scan this QR with a UPI app on another phone.','info');
    return;
   }
   const now=Date.now();
   if(lastNativeLaunchAt&&now-lastNativeLaunchAt<nativeLaunchCooldownMs){
    event.preventDefault();
    trace('APP_DUPLICATE_BLOCKED');
    message('UPI app was already opened. Return here before trying again.','info');
    return;
   }
   lastNativeLaunchAt=now;
   qrTapStartedAt=now;qrAppBackgrounded=false;
   trace('APP_DISPATCH','APP_GENERIC','generic');
  });
  get('shareCheckout').addEventListener('click',async()=>{
   if(!session?.token||!session?.orderId)return;
   const link=secureCheckoutUrl();
   try{
    if(navigator.share)await navigator.share({title:'DISHA payment',url:link});
    else if(navigator.clipboard?.writeText){
     await navigator.clipboard.writeText(link);
     message('Payment link copied. Share only with the payer.','info');
    }else message('Sharing unavailable in this browser.','error');
   }catch(_){message('Could not share the payment link.','error')}
  });
  const diag=get('checkoutDebugPanel');
  if(debug&&diag){diag.hidden=false;get('checkoutDebugCopy').addEventListener('click',copyDebugReport)}
  get('saveReceipt').addEventListener('click',()=>{if(receiptShown)window.print()});
  get('shareReceipt').addEventListener('click',async()=>{
   if(!receiptShown)return;
   const content='DISHA payment receipt\nAmount: '+format(session.amount)+
    '\nPayment reference: '+session.orderId+'\nUPI reference: '+get('receiptUtr').textContent;
   try{
    if(navigator.share)await navigator.share({title:'DISHA payment receipt',text:content});
    else if(navigator.clipboard?.writeText){
     await navigator.clipboard.writeText(content);message('Receipt copied')}
   }catch(_){}
  });
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='hidden'){
    if(qrTapStartedAt&&!qrAppBackgrounded){
     qrAppBackgrounded=true;
     trace('BROWSER_HIDDEN');
    }
   }else onReturn();
  });
  window.addEventListener('pageshow',onReturn);
  window.addEventListener('focus',onReturn);
 }
 async function start(){
  setEventHandlers();showStage('qr');
  try{
   session=await getSession();
   trace('QR_OPEN');
   saveSessionState();
   setMoney(session.amount);
   setPaymentKind();
   const params=new URLSearchParams(session.upiUri.split('?')[1]||'');
   get('checkoutPaymentIdentity').textContent='UPI intent · '+(session.payeeVpa||params.get('pa')||'');
   get('paymentTrackingStatus').textContent='Payment status · Awaiting confirmation';
   get('checkoutNote').textContent=params.get('tn')||'Service';
   get('qrTapToPayHint').textContent=model.supportsNativeUPI(userAgent)
    ?'Tap the QR for your UPI app, or scan from another phone.'
    :'Scan this QR using your UPI app on another phone.';
   showStage('qr');tickSessionTimer();
   if(query.get('upi_intent_fallback')==='1')
    message('UPI app did not open. Scan this QR from another phone.','info');
   await pollLedger();
   if(receiptShown)return;
   if(['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)||expired())
    locked(session.initialStatus==='EXPIRED'||expired()?'This payment link expired. A recorded credit may still appear here.':'This payment did not complete.');
   ledgerTicker=setInterval(()=>{void pollLedger()},3500);
   expiryTicker=setInterval(tickSessionTimer,1000);
  }catch(err){locked(model.userFacingError(err,'load'))}
 }
 start();
})();
