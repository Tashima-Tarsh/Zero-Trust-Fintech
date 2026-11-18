/* DISHA 8.2 cosmic checkout — presentation only. Bank outcome remains server-authoritative. */
(function(){
 'use strict';
 const model=window.DISHACosmicCheckoutModel;
 const vault=window.DISHAOneTouchVault;
 const get=id=>document.getElementById(id);
 const mode=document.body.dataset.checkout==='merchant'?'merchant':'generic';
 const query=new URLSearchParams(location.search);
 const prefKey='disha82:preferred-upi-app';
 const resumeKey='disha82:cosmic-authorized-checkout:v1';
 const stages=[...document.querySelectorAll('[data-stage]')];
 let session=null,vaultSessionId=null,authorized=false,handoffStarted=false;
 let loading=false,polling=false,evidenceSending=false,receiptShown=false;
 let qrUri=null,lastStage='initial',expiryTicker=null,ledgerTicker=null;
 let missingBackgroundLogged=false,expiryLogged=false;
 const userAgent=navigator.userAgent||'';
 const orderId=()=>session?.orderId||null;
 const debug=query.get('debug')==='1';
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
  try{
   void fetch('/api/checkout/trace',{method:'POST',cache:'no-store',keepalive:true,
    credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.token},
    body:JSON.stringify({orderId:session.orderId,token:session.token,event,code,
     app:['gpay','phonepe','paytm','cred','generic'].includes(app)?app:'none',device})
   }).catch(()=>{});
  }catch(_){}
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
  get('btnOneTouch').disabled=true;
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
  return {orderId:raw.orderId,token:raw.sessionId,
   upiUri:model.qrPayload(raw.upiLink),amount:Number(raw.challengeAmount),
   expiresAt:Number(raw.expiresAt),initialStatus:'PENDING',
   paymentType:raw.paymentType,payeeVpa:raw.vpaAddress};
 }
 function saveAuthorizedSession(){
  if(mode!=='generic'||!session)return;
  try{
   sessionStorage.setItem(resumeKey,JSON.stringify({
    ...session,requestedAmount:query.get('amount')||'1',savedAt:Date.now()
   }));
  }catch(_){}
 }
 async function recoverAuthorizedSession(requestedAmount){
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
   const id=query.get('orderId'),token=query.get('token');
   if(!id||!token)throw Error('This payment link is incomplete. Request a new link.');
   url='/api/merchant/public/order/'+encodeURIComponent(id)+'?token='+encodeURIComponent(token);
  }else{
   const raw=query.get('amount')||'1';
   const amount=Number(raw);
   if(!Number.isFinite(amount)||amount<=0||amount>100000)
    throw Error('Invalid payment amount. Open a valid payment link.');
   const recovered=await recoverAuthorizedSession(raw);
   if(recovered)return recovered;
   const userId=vault.getDeviceUserId();
   url='/api/session/new?amount='+encodeURIComponent(amount.toFixed(2))+
     '&description='+encodeURIComponent('DISHA checkout')+
     '&userId='+encodeURIComponent(userId)+'&userName='+encodeURIComponent('Device user');
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
 function preferred(){
  try{return model.safeApp(localStorage.getItem(prefKey)||'generic')}catch(_){return 'generic'}
 }
 function savePreferred(app){
  try{localStorage.setItem(prefKey,model.safeApp(app))}catch(_){}
 }
 function createReceipt(record){
  if(!model.isSettled(record)||receiptShown)return;
  receiptShown=true;
  trace('LEDGER_CONFIRMED');
  get('receiptAmount').textContent=format(record.challengeAmount||session.amount);
  get('receiptOrder').textContent=session.orderId;
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
    if(result.status==='FAILED'||result.status==='CANCELLED'){
     if(lastStage==='checking')get('checkingHelp').textContent='This payment did not complete. You can choose another payment method.';
    }
   }
   if(expired()){
    if(lastStage==='qr')get('qrExpiry').textContent='This QR has expired. Request a new payment link.';
    if(lastStage==='initial')locked('This payment request has expired. Request a new link.');
    if(lastStage==='checking')get('checkingHelp').textContent='The request window has ended. We will only show a receipt if confirmation is recorded.';
   }
  }catch(_){
   // No false failure on a transient network interruption. Poll again.
  }finally{polling=false}
 }
 function tickSessionTimer(){
  const node=get('checkoutTimer');
  if(!node||!session)return;
  if(receiptShown){node.textContent='Payment confirmed';return}
  const remaining=Math.max(0,Math.ceil((session.expiresAt-Date.now())/1000));
  const mm=String(Math.floor(remaining/60)).padStart(2,'0');
  const ss=String(remaining%60).padStart(2,'0');
  node.textContent=remaining?'Session expires in '+mm+':'+ss:'Session expired · Request a new payment link';
  node.dataset.expired=String(remaining===0);
  if(remaining===0){
   if(!expiryLogged){expiryLogged=true;trace('SESSION_EXPIRED')}
   get('btnOneTouch').disabled=true;
   document.querySelectorAll('[data-app]').forEach(button=>{button.disabled=true});
   const qrButton=get('showQr');if(qrButton)qrButton.disabled=true;
   if(lastStage==='initial'||lastStage==='methods')
     message('This payment session has expired. Start a new checkout.','error');
   if(lastStage==='checking')
     get('checkingHelp').textContent='The payment window ended. A recorded credit can still be reconciled.';
  }
  if(lastStage==='qr')handleQrExpiry();
 }
 function handleQrExpiry(){
  if(!session||lastStage!=='qr')return;
  const left=Math.max(0,Math.ceil((session.expiresAt-Date.now())/1000));
  get('qrExpiry').textContent=left>0?'QR valid for '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')+
    ' · Linked to this payment request':'Payment link expired — request a new link';
  get('paymentQr').classList.toggle('is-expired',left===0);
 }
 function renderQr(){
  if(!authorized||!session)return;
  const container=get('paymentQr');
  if(qrUri!==session.upiUri){
   container.replaceChildren();
   if(typeof window.QRCode!=='function'){
    message('Error — QR is unavailable. Choose a UPI app.','error');
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
 function bindFallback(href){
  const anchor=get('oneTouchFallback');
  anchor.href=href;
  anchor.hidden=false;
 }
 function openApp(app){
  if(!authorized||!session||expired()){
   message('Error — This payment request is no longer active.','error');return;
  }
  // Desktop browsers cannot run a native mobile UPI intent. Use the QR stage
  // rather than attempting intent:// or upi:// navigation and showing an error.
  if(!model.supportsNativeUPI(userAgent)){
   trace('QR_OPEN');
   showStage('qr');
   message('Scan the QR using a UPI app on your phone.');
   return;
  }
  try {
   const chosen=model.safeApp(app);
   trace('APP_SELECTED','OK',chosen);
   const target=model.buildAppUrl(session.upiUri,chosen,userAgent);
   if(!handoffStarted){
    vault.beginHandoff(orderId(),vaultSessionId,session.token,chosen);
    handoffStarted=true;
   }
   savePreferred(chosen);
   missingBackgroundLogged=false;
   showStage('methods');
   // Do not use the app-specific intent as the only fallback: an app may be
   // uninstalled or block that package. Offer the bank-standard generic UPI
   // URI with a separate, fresh user tap, preserving the same amount/payee.
   bindFallback(session.upiUri);
   trace('APP_DISPATCH',target===session.upiUri?'APP_GENERIC':'APP_TARGETED',chosen);
   if(target===session.upiUri)vault.launchUPI(target);
   else location.assign(target);
  }catch(error){
   trace('APP_ERROR',debugCode(error),app);
   message(model.userFacingError(error,'app'),'error');
  }
 }
 async function authorize(){
  if(loading||!session)return;
  if(expired()){locked('This payment request has expired.');return}
  loading=true;const button=get('btnOneTouch');
  button.disabled=true;
  message('Confirm with your device to continue.');
  trace('VAULT_BEGIN');
  try{
   const verified=await vault.authorize(orderId(),(event,code)=>trace(event,code));
   vaultSessionId=verified.sessionId;
   authorized=true;
   trace('VAULT_AUTHORIZED');
   saveAuthorizedSession();
   // Chrome may deny an Android intent launched after an async passkey
   // ceremony because the original Pay tap's transient gesture has expired.
   // Give mobile users a fresh, explicit app tap. On desktop, show QR.
   showStage(model.supportsNativeUPI(userAgent)?'methods':'qr');
  }catch(err){
   trace('VAULT_ERROR',debugCode(err));
   message(model.userFacingError(err,'device'),'error');
  }finally{button.disabled=false;loading=false}
 }
 async function submitReturnEvidence(preserveAppChoices=false){
  if(!session||evidenceSending||receiptShown)return;
  const packet=vault.requestEvidence(orderId());
  if(!packet)return;
  evidenceSending=true;
  trace('EVIDENCE_SUBMIT','OK',packet.evidence?.selectedApp||'generic');
  // A UPI app can reject before PIN. Keep retry choices visible while
  // securely recording what the browser actually observed.
  if(!preserveAppChoices)showStage('checking');
  try{
   const response=await fetch('/api/vault/evidence',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-CSRF-Token':packet.token},
    body:JSON.stringify(packet)
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.success){
    const error=Error('Evidence delivery was interrupted');error.status=response.status;
    throw error;
   }
   vault.acknowledgeEvidence(orderId(),packet.eventId,result);
   trace('EVIDENCE_ACK',result.state==='CONFLICTING_EVIDENCE'?'EVIDENCE_CONFLICT':'EVIDENCE_UNVERIFIED',
    packet.evidence?.selectedApp||'generic');
   get('checkingHelp').textContent='Your payment update is being checked. This page will refresh automatically.';
  }catch(err){
   trace('EVIDENCE_ERROR',debugCode(err),packet.evidence?.selectedApp||'generic');
   get('checkingHelp').textContent='Still checking. Keep this page open; we will retry automatically.';
  }finally{evidenceSending=false;void pollLedger()}
 }
 function onReturn(){
  if(document.visibilityState==='hidden'||receiptShown)return;
  tickSessionTimer();
  // Returning to a cancelled/expired checkout cannot resurrect its
  // one-touch authorization or expose native app / QR controls.
  if(session&&(session.initialStatus==='EXPIRED'||
      session.initialStatus==='FAILED'||expired())){
   void pollLedger(); // A previously established ledger credit still wins.
   return;
  }
  // A focus/pageshow event alone does not establish that Android actually
  // opened a UPI app. Some apps reject the intent before their PIN screen.
  // Require a browser-observed background/return event (or explicit return
  // parameters, as captured by the Vault) before entering checking.
  const observed=typeof vault.requestEvidence==='function'?vault.requestEvidence(orderId()):null;
  if(session&&vault.getPendingOrderId()===orderId()&&observed){
   authorized=true;handoffStarted=true;
   const retry=model.needsPaymentMethodRetry(observed.evidence);
   trace('BROWSER_RETURN',retry?'RETURN_FAST':'RETURN_NORMAL',observed.evidence?.selectedApp||'generic');
   if(retry&&lastStage!=='receipt'){
    showStage('methods');
    message('The UPI app returned without payment confirmation. If you paid, check your UPI history before trying again. Otherwise choose another app or scan QR.','info');
   }else if(lastStage!=='receipt'&&lastStage!=='checking'){
    showStage('checking');
   }
   void submitReturnEvidence(retry);
  }else if(handoffStarted&&!missingBackgroundLogged){
   missingBackgroundLogged=true;
   trace('NO_BACKGROUND','NO_OBSERVATION');
  }
  void pollLedger();
 }
 function setEventHandlers(){
  get('btnOneTouch').addEventListener('click',authorize);
  document.querySelectorAll('[data-app]').forEach(el=>
   el.addEventListener('click',()=>openApp(el.dataset.app)));
  get('showQr').addEventListener('click',()=>{
   if(authorized && !expired()){trace('QR_OPEN');showStage('qr')}
  });
  get('backToApps').addEventListener('click',()=>showStage('methods'));
  get('checkingApps').addEventListener('click',()=>showStage('methods'));
  get('saveReceipt').addEventListener('click',()=>{if(receiptShown)window.print()});
  get('shareReceipt').addEventListener('click',async()=>{
   if(!receiptShown)return;
   const content='DISHA 8.2 payment receipt\nAmount: '+format(session.amount)+
    '\nOrder: '+session.orderId+'\nUPI reference: '+get('receiptUtr').textContent+'\nStatus: Completed';
   try{
    if(navigator.share)await navigator.share({title:'DISHA payment receipt',text:content});
    else if(navigator.clipboard){await navigator.clipboard.writeText(content);message('Receipt details copied.')}
    else message('Use Save / print receipt to keep a copy.');
   }catch(_){}
  });
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='hidden'){
    if(handoffStarted){vault.markBackgrounded(orderId());trace('BROWSER_HIDDEN')}
   }else onReturn();
  });
  window.addEventListener('pagehide',()=>{if(handoffStarted)vault.markBackgrounded(orderId())});
  window.addEventListener('pageshow',onReturn);
  window.addEventListener('focus',onReturn);
 }
 async function start(){
  setEventHandlers();
  showStage('initial');
  try{
   session=await getSession();
   trace('ORDER_READY');
   setMoney(session.amount);
   setPaymentKind();
   tickSessionTimer();
   // Resolve a verified recorded credit even after the original checkout TTL.
   await pollLedger();
   if(receiptShown)return;
   if(session.initialStatus==='EXPIRED'||session.initialStatus==='FAILED'){
    locked(session.initialStatus==='EXPIRED'?
      'This payment request has expired. Request a new link.':
      'This payment request did not complete. Request a new link.');
    return;
   }
   if(expired()){locked('This payment request has expired.');return}
   get('btnOneTouch').disabled=false;
   // A returning browser can recover its own existing Vault handoff.
   const returnEvidence=typeof vault.requestEvidence==='function'?vault.requestEvidence(orderId()):null;
   if(vault.getPendingOrderId()===orderId()&&returnEvidence){
    authorized=true;handoffStarted=true;
    showStage('checking');
    void submitReturnEvidence();
   }
   ledgerTicker=setInterval(()=>{void pollLedger()},3500);
   expiryTicker=setInterval(tickSessionTimer,1000);
  }catch(err){locked(model.userFacingError(err,'load'))}
 }
 start();
})();
