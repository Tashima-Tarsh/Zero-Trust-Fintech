/* DISHA 8.2 cosmic checkout — presentation only. Bank outcome remains server-authoritative. */
(function(){
 'use strict';
 const model=window.DISHACosmicCheckoutModel;
 const vault=window.DISHAOneTouchVault;
 const get=id=>document.getElementById(id);
 const mode=document.body.dataset.checkout==='merchant'?'merchant':'generic';
 const query=new URLSearchParams(location.search);
 const prefKey='disha82:preferred-upi-app';
 const stages=[...document.querySelectorAll('[data-stage]')];
 let session=null,vaultSessionId=null,authorized=false,handoffStarted=false;
 let loading=false,polling=false,evidenceSending=false,receiptShown=false;
 let qrUri=null,lastStage='initial',expiryTicker=null,ledgerTicker=null;
 const userAgent=navigator.userAgent||'';
 const orderId=()=>session?.orderId||null;

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
     amount:Number(o.amount),expiresAt:Number(o.expires_at),initialStatus:o.status};
  }
  return {orderId:raw.orderId,token:raw.sessionId,
   upiUri:model.qrPayload(raw.upiLink),amount:Number(raw.challengeAmount),
   expiresAt:Number(raw.expiresAt),initialStatus:'PENDING'};
 }
 async function getSession(){
  let url;
  if(mode==='merchant'){
   const id=query.get('orderId'),token=query.get('token');
   if(!id||!token)throw Error('This payment link is incomplete. Request a new link.');
   url='/api/merchant/public/order/'+encodeURIComponent(id)+'?token='+encodeURIComponent(token);
  }else{
   const raw=query.get('amount')||'500';
   const amount=Number(raw);
   if(!Number.isFinite(amount)||amount<=0||amount>100000)
    throw Error('Invalid payment amount. Open a valid payment link.');
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
 function preferred(){
  try{return model.safeApp(localStorage.getItem(prefKey)||'generic')}catch(_){return 'generic'}
 }
 function savePreferred(app){
  try{localStorage.setItem(prefKey,model.safeApp(app))}catch(_){}
 }
 function createReceipt(record){
  if(!model.isSettled(record)||receiptShown)return;
  receiptShown=true;
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
    message('QR is unavailable in this browser. Choose a UPI app.','error');
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
   message('This payment request is no longer active.','error');return;
  }
  const chosen=model.safeApp(app);
  const target=model.buildAppUrl(session.upiUri,chosen,userAgent);
  savePreferred(chosen);
  // A clickable fallback must exist before a post-WebAuthn async app launch.
  bindFallback(target);
  if(!handoffStarted){
   vault.beginHandoff(orderId(),vaultSessionId,session.token);
   handoffStarted=true;
  }
  showStage('methods');
  bindFallback(target);
  try{
   if(target===session.upiUri)vault.launchUPI(target);
   else location.assign(target);
  }catch(_){
   message('Tap Open UPI app to continue.');
  }
 }
 async function authorize(){
  if(loading||!session)return;
  if(expired()){locked('This payment request has expired.');return}
  loading=true;const button=get('btnOneTouch');
  button.disabled=true;
  message('Confirm with your device to continue.');
  try{
   const verified=await vault.authorize(orderId());
   vaultSessionId=verified.sessionId;
   authorized=true;
   showStage(model.stageAfterAuthorization(preferred()));
   const app=preferred();
   // Returning users can go directly to the preferred app; the choice remains visible
   // if an operating system blocks post-passkey auto-launch.
   if(app!=='generic')openApp(app);
  }catch(err){
   message(err?.message||'Device confirmation was not completed. Please retry.','error');
  }finally{button.disabled=false;loading=false}
 }
 async function submitReturnEvidence(){
  if(!session||evidenceSending||receiptShown)return;
  const packet=vault.requestEvidence(orderId());
  if(!packet)return;
  evidenceSending=true;
  showStage('checking');
  try{
   const response=await fetch('/api/vault/evidence',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-CSRF-Token':packet.token},
    body:JSON.stringify(packet)
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.success)throw Error(result.error||'Evidence delivery was interrupted');
   vault.acknowledgeEvidence(orderId(),packet.eventId,result);
   get('checkingHelp').textContent='Your payment update is being checked. This page will refresh automatically.';
  }catch(_){
   get('checkingHelp').textContent='Still checking. Keep this page open; we will retry automatically.';
  }finally{evidenceSending=false;void pollLedger()}
 }
 function onReturn(){
  if(document.visibilityState==='hidden')return;
  if(session&&vault.getPendingOrderId()===orderId()){
   authorized=true;handoffStarted=true;
   // Even when an app returns no callback fields, show a neutral checking
   // state and keep polling the authoritative ledger; do not claim success.
   if(lastStage!=='receipt'&&lastStage!=='checking')showStage('checking');
   void submitReturnEvidence();
  }
  void pollLedger();
 }
 function setEventHandlers(){
  get('btnOneTouch').addEventListener('click',authorize);
  document.querySelectorAll('[data-app]').forEach(el=>
   el.addEventListener('click',()=>openApp(el.dataset.app)));
  get('showQr').addEventListener('click',()=>{
   if(authorized && !expired())showStage('qr');
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
    if(handoffStarted)vault.markBackgrounded(orderId());
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
   setMoney(session.amount);
   if(session.initialStatus==='EXPIRED'||session.initialStatus==='FAILED'){
    locked('This payment request is no longer active.');return;
   }
   if(expired()){locked('This payment request has expired.');return}
   get('btnOneTouch').disabled=false;
   // A returning browser can recover its own existing Vault handoff.
   if(vault.getPendingOrderId()===orderId()){
    authorized=true;handoffStarted=true;
    showStage('checking');
    void submitReturnEvidence();
   }
   await pollLedger();
   ledgerTicker=setInterval(()=>{void pollLedger()},3500);
   expiryTicker=setInterval(handleQrExpiry,1000);
  }catch(err){locked(err?.message||'Could not load the payment link.')}
 }
 start();
})();
