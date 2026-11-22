/* DISHA 8.2 cosmic checkout — presentation only. Bank outcome remains server-authoritative. */
(function(){
 'use strict';
 const model=window.DISHACosmicCheckoutModel;
 const get=id=>document.getElementById(id);
 const mode=document.body.dataset.checkout==='merchant'?'merchant':'generic';
 const query=new URLSearchParams(location.search);
 const quantumEnabled=query.get('qs')==='1';
 const checkoutUA=navigator.userAgent||'';
 const nativeChromeCheckout=/Android/i.test(checkoutUA)&&/Chrome\/\d+/i.test(checkoutUA)&&!/[;\s]wv[);\s]/i.test(checkoutUA);
 const proofbridgeEnabled=(mode==='generic'||query.get('proofbridge')==='1')&&!nativeChromeCheckout;
 const quantumClient=window.DISHAQuantumSignalClient||null;
 let quantumReady=false;
 const requiredMode=mode==='generic'?'P2P':
  (/^\/p2m\/checkout\/?$/.test(location.pathname||'')?'P2M':null);
 const resumeKey='disha82:upi-payment-resume:v2';
 const stages=[...document.querySelectorAll('[data-stage]')];
 let session=null,polling=false,receiptShown=false;
 let proofbridgeReady=false,proofbridgePolling=false,proofbridgeAuthorized=null;
 let proofbridgeAuthSequence=0,proofbridgePollTimer=null;
 let qrUri=null,lastStage='qr',expiryTicker=null,ledgerTicker=null;
 let expiryLogged=false;
 // Browser-only diagnostics for direct QR taps. Not evidence of a bank payment.
 let qrTapStartedAt=0,qrAppBackgrounded=false,lastNativeLaunchAt=0;
 let copyReturnObserver=null;
 let p2pTrustedUntil=0;
 const p2pTrusted=()=>mode!=='generic'||(p2pTrustedUntil>Date.now()&&!expired());
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
   'Checkout session: '+(orderId()?'active':'not-created')+'\n'+
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
  const selected=['gpay','phonepe','paytm','bhim','cred','generic'].includes(app)?app:'none';
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
     serviceNumber:o.service_number||'',
     amount:Number(o.amount),expiresAt:Number(o.expires_at),initialStatus:o.status,
     paymentType:o.payment_type,payeeVpa:o.vpa_address};
  }
  if(raw.session){
   const o=raw.session;
   if(!o.orderId||!raw.upiLink||!Number(o.challengeAmount))throw Error('Payment link is incomplete');
   return {orderId:o.orderId,token:query.get('token'),upiUri:model.qrPayload(raw.upiLink),
    serviceNumber:o.txnRef||o.txn_ref||'',
    amount:Number(o.challengeAmount),expiresAt:Number(o.expiresAt),initialStatus:o.status,
    paymentType:o.merchantType,payeeVpa:o.vpaAddress};
  }
  return {orderId:raw.orderId,token:raw.sessionId,
   upiUri:model.qrPayload(raw.upiLink),serviceNumber:raw.serviceNumber||raw.txnRef||'',amount:Number(raw.challengeAmount),
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
  label.textContent=kind+' · '+name;
 }
 // Issuer-confirmed payer debit evidence produces its own receipt, without
 // consulting the receiving account's settlement state.
 function createPayerDebitReceipt(proof){
  const debit=proof?.payerDebitEvidence;
  if(receiptShown||!proof?.payerDebitVerified||!debit?.debitVerified||
     debit.evidenceState!=='PAYER_DEBIT_VERIFIED'||
     !/^\d{12}$/.test(debit.utr||'')||
     !/^[A-Za-z0-9][A-Za-z0-9._:\/\-]{5,99}$/.test(debit.payerTransactionId||''))return;
  receiptShown=true;
  get('receiptAmount').textContent=format(session.amount);
  get('receiptPaymentRef').textContent=session.serviceNumber||'—';
  get('receiptUtr').textContent=debit.utr;
  get('receiptPayerTxnRow').hidden=false;
  get('receiptPayerTxn').textContent=debit.payerTransactionId;
  get('receiptHeading').textContent='Payer debit confirmed.';
  get('receiptSubline').textContent='Payer-side transaction evidence';
  get('receiptVerifiedStatus').textContent='Debit confirmed';
  if(Number.isSafeInteger(debit.claimedPaidAt)&&debit.claimedPaidAt>0){
   get('receiptTimeRow').hidden=false;
   get('receiptTime').textContent=new Date(debit.claimedPaidAt).toLocaleString('en-IN');
  }
  showStage('receipt');
  if(ledgerTicker)clearInterval(ledgerTicker);
  if(proofbridgePollTimer)clearInterval(proofbridgePollTimer);
  if(window.DISHAVault3D)window.DISHAVault3D.destroy();
 }
 function createReceipt(record){
  if(!model.isSettled(record)||receiptShown)return;
  receiptShown=true;
  trace('LEDGER_CONFIRMED');
  get('receiptAmount').textContent=format(record.challengeAmount||session.amount);
  // The pre-issued service ID is not the payer's actual transaction reference.
  get('receiptPaymentRef').textContent=session.serviceNumber||'—';
  get('receiptUtr').textContent=record.utr;
  const appId=String(record.payerTransactionId||'');
  const extra=get('receiptPayerTxnRow');
  if(extra){
   extra.hidden=!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,99}$/.test(appId)||appId===record.utr;
   if(!extra.hidden)get('receiptPayerTxn').textContent=appId;
  }
  showStage('receipt');
  if(ledgerTicker)clearInterval(ledgerTicker);
  if(window.DISHAVault3D)window.DISHAVault3D.destroy();
 }
 async function pollLedger(){
  if(!session||polling||receiptShown||document.visibilityState==='hidden')return;
  polling=true;
  try{
   const r=await fetch(urlWithToken('/api/ledger/'),{cache:'no-store',credentials:'same-origin'});
   if(r.ok){
    const result=await r.json();
    if(mode!=='generic'&&model.isSettled(result)){createReceipt(result);return}
    const tracker=get('paymentTrackingStatus');
    if(tracker){
     const state=String(result.status||'PENDING').toUpperCase();
     tracker.textContent=state==='PENDING'
      ?'Payment status · Awaiting confirmation'
      :state==='EXPIRED'?'Payment status · Session expired'
      :state==='FAILED'||state==='CANCELLED'?'Payment status · Not completed'
      :'Payment status · Checking authenticated evidence';
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
  if(remaining===0) {
   const pay=get('vaultProceed');
   if(pay){pay.setAttribute('aria-disabled','true');pay.setAttribute('tabindex','-1')}
   const copy=get('proofbridgeProceed');
   if(copy)copy.disabled=true;
   const debit=get('payerDebitCheck');
   if(debit)debit.disabled=true;
  }
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
   get('upiAppOptions').hidden=true;
   for(const link of document.querySelectorAll('[data-upi-app]')){
    link.href='#';link.setAttribute('aria-disabled','true');
   }
   get('paymentQr').replaceChildren();
   qrUri=null;
  }
 }
 // Chrome fallback returns to this exact payment, not a new amount-based session.
 function secureCheckoutUrl(forFallback=false){
  const merchantPath=requiredMode==='P2M'?'/p2m/checkout':'/merchant-checkout.html';
  const u=new URL(mode==='merchant'?merchantPath:'/checkout',location.href);
  u.searchParams.set('paymentRef',session.orderId);
  u.searchParams.set('token',session.token);
  if(quantumEnabled)u.searchParams.set('qs','1');
  if(forFallback)u.searchParams.set('upi_intent_fallback','1');
  return u.href;
 }
 function renderQr(){
  if(!session)return;
  const anchor=get('qrTapToPay'),container=get('paymentQr');
  // P2P ProofBridge is copy-to-pay, NOT QR-to-pay. Neither consent
  // nor Proceed may render a personal-account QR in this mode.
  const androidChromeEligible=device==='android';
  const disclosure=get('nativeEvidenceDisclosure');
  if(disclosure)disclosure.hidden=!androidChromeEligible;
  const proofbridgeGate=get('proofbridgeGate');
  if(proofbridgeGate&&!proofbridgeEnabled)proofbridgeGate.hidden=true;
  if(expired()||['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)){
   anchor.href='#';anchor.hidden=true;anchor.setAttribute('aria-disabled','true');
   get('upiAppOptions').hidden=true;
   container.replaceChildren();qrUri=null;handleQrExpiry();return;
  }
  const p2pCopyOnly=model.isPersonalPayment(session.upiUri)&&(proofbridgeEnabled||androidChromeEligible);
  anchor.hidden=p2pCopyOnly;
  get('qrExpiry').hidden=p2pCopyOnly;
  get('qrTapToPayHint').hidden=p2pCopyOnly;
  if(p2pCopyOnly){
   anchor.href='#';anchor.setAttribute('aria-disabled','true');
   container.replaceChildren();qrUri=null;
   if(androidChromeEligible){
    // Personal UPI remains copy-to-pay on Android Chrome.
    get('upiAppOptions').hidden=true;
    const proceed=get('vaultProceed');
    if(proceed){
     proceed.hidden=false;proceed.href='#';
     proceed.textContent='Copy UPI ID';
     proceed.setAttribute('aria-disabled',p2pTrusted()?'false':'true');
    }
     const guide=get('paymentStageCopy');
    if(guide)guide.textContent='Automatic Android debit observation is unavailable in this checkout. For manual payment, copy the receiving UPI ID and enter the exact amount in your UPI app.';
   }else{
    // Keep the existing consent-authorized ProofBridge flow for non-native
    // browsers; do not bypass its server authorization.
    get('upiAppOptions').hidden=true;
    const proceed=get('vaultProceed');if(proceed)proceed.hidden=true;
    const guide=get('paymentStageCopy');
    if(guide)guide.textContent=proofbridgeReady?
     'Receiving details copied. Open your payment app, paste the address, confirm the amount and pay. Return here for your receipt.':
     'Authorize this session, then touch Proceed once to copy the receiving address.';
   }
   return;
  }
  if(proofbridgeEnabled&&!proofbridgeReady){
   anchor.href='#';anchor.setAttribute('aria-disabled','true');
   container.replaceChildren();qrUri=null;
   get('upiAppOptions').hidden=true;
   return;
  }
  // Payment dispatch is independent of optional Quantum evidence telemetry.
  // Check the literal launch target BEFORE Android resolves an anchor's "#"
  // to the current absolute URL. Personal P2P remains scan/copy-only.
  const launchUri=model.supportsNativeUPI(userAgent)?model.qrTapLaunchUri(session.upiUri,userAgent,secureCheckoutUrl(true)):'#';
  anchor.href=launchUri;
  anchor.setAttribute('aria-disabled',launchUri==='#'?'true':'false');
  if(quantumEnabled){
   const proceed=get('vaultProceed');
   proceed.href=launchUri;
   proceed.setAttribute('aria-disabled',launchUri==='#'?'true':'false');
  }
  const targeted=model.supportsTargetedAppLaunch(userAgent)&&!model.isPersonalPayment(session.upiUri);
  get('upiAppOptions').hidden=!targeted;
  for(const link of document.querySelectorAll('[data-upi-app]')){
   link.href=targeted?model.appTapLaunchUri(session.upiUri,userAgent,secureCheckoutUrl(true),link.dataset.upiApp):'#';
   link.setAttribute('aria-disabled',targeted?'false':'true');
  }
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
  // A return after a copied UPI ID triggers an automatic session-bound read,
  // not a bank-debit assertion. Observer ignores duplicate focus/pageshow events.
  copyReturnObserver?.foreground();
  if(quantumEnabled&&quantumReady&&quantumClient){
   void quantumClient.returned(session).then(result=>{
    if(!result)return;
    const state=result.eventState||'';
    if(state==='CONFLICTING_EVIDENCE')message('Returned payment details conflict with this service.','error');
    else if(state==='UTR_CANDIDATE_UNVERIFIED')
     message('UPI reference observed in app return. Evidence stored; verification pending.','info');
    else message('Android/browser return recorded. Awaiting transaction evidence.','info');
   }).catch(()=>message('Evidence connection unavailable. Your checkout remains pending.','info'));
  }
  if(qrTapStartedAt&&qrAppBackgrounded){
   const early=Date.now()-qrTapStartedAt<12000;
   trace('BROWSER_RETURN',early?'RETURN_FAST':'RETURN_NORMAL');
   if(early&&lastStage==='qr')
    message('UPI app returned quickly. Check its payment history before retrying.','info');
   qrTapStartedAt=0;qrAppBackgrounded=false;
  }
  void pollLedger();
  if(proofbridgeEnabled&&proofbridgeReady)void pollProofbridgeEvidence();
 }
 async function pollProofbridgeEvidence(){
  if(!proofbridgeReady||proofbridgePolling||receiptShown||!session)return;
  proofbridgePolling=true;
  try{
   const url='/api/proofbridge/status/'+encodeURIComponent(session.orderId)+'?token='+encodeURIComponent(session.token);
   const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});
   if(!r.ok)return;
   const d=await r.json();
   if(mode==='generic'&&d.payerDebitVerified&&d.payerDebitEvidence?.debitVerified){
    createPayerDebitReceipt(d);return;
   }
   if(d.payerDebitEvidence?.utr&&/^\d{12}$/.test(d.payerDebitEvidence.utr)){
    // A signed payer-side claim carries a real-format UTR candidate but
    // cannot prove that the payer's bank actually posted a debit.
    const payer=get('payerDebitEvidence');
    if(payer){
     payer.hidden=false;
     get('payerUtrCandidate').textContent=d.payerDebitEvidence.utr;
     const reportedId=d.payerDebitEvidence.payerTransactionId;
     const extra=get('payerTransactionIdRow');
     if(extra){
      extra.hidden=!/^[A-Za-z0-9][A-Za-z0-9._:\/\-]{5,99}$/.test(reportedId||'');
      if(!extra.hidden)get('payerTransactionIdCandidate').textContent=reportedId;
     }
     get('payerDebitEvidenceStatus').textContent=
      'Payer debit claim recorded from '+d.payerDebitEvidence.issuerId+
      '. Actual debit is not independently verified; no payment receipt issued.';
    }
    const note=get('proofbridgeEvidence');
    if(note){
     note.hidden=mode==='generic';
     note.textContent='Payer-side UTR claim: '+d.payerDebitEvidence.utr+
      ' · NOT independently debit-verified. Awaiting authenticated evidence.';
    }
   }
  }catch(_){/* Evidence transport is optional and never changes financial state. */}
  finally{proofbridgePolling=false}
 }
 function proofbridgeMatchesOrder(data){
  if(!data||data.success!==true||!session||
     model.qrPayload(data.upiUri)!==session.upiUri||
     data.orderId!==session.orderId||
     !Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now()||
     data.expiresAt>Number(session.expiresAt)||
     typeof data.ticketSignature!=='string'||!/^[a-f0-9]{64}$/i.test(data.ticketSignature)||
     typeof data.ticketHash!=='string'||!/^[a-f0-9]{64}$/i.test(data.ticketHash)||
     typeof data.ticket?.nonce!=='string'||!/^[a-f0-9]{40}$/i.test(data.ticket.nonce)||
     data.ticket?.protocol!=='DISHA-PROOF-TICKET-V2'||
     data.ticket?.orderId!==session.orderId||
     !['P2P','P2M'].includes(data.ticket?.paymentType)||
     data.ticket?.paymentType!==
      (['MERCHANT','P2M'].includes(String(session.paymentType||'').toUpperCase())?'P2M':'P2P')||
     data.ticket?.amountPaise!==String(Math.round(session.amount*100))||
     data.ticket?.payeeVpa!==(session.payeeVpa||'').toLowerCase()||
     data.ticket?.expiresAt!==data.expiresAt)return false;
  const q=new URLSearchParams(data.upiUri.split('?')[1]||'');
  if(q.getAll('pa').length!==1||q.getAll('am').length!==1||q.getAll('cu').length!==1||
     q.get('pa')?.toLowerCase()!==data.ticket.payeeVpa||
     String(Math.round(Number(q.get('am'))*100))!==data.ticket.amountPaise||
     q.get('cu')!=='INR')return false;
  if(data.ticket.paymentType==='P2P')
   return !q.has('mc')&&!q.has('tr')&&
    data.ticket.merchantCategory===''&&data.ticket.merchantReference==='';
  return q.getAll('mc').length===1&&q.getAll('tr').length===1&&
   data.ticket.merchantCategory===q.get('mc')&&
   data.ticket.merchantReference===q.get('tr')&&
   /^[0-9]{4}$/.test(data.ticket.merchantCategory)&&
   data.ticket.merchantCategory!=='0000'&&
   /^[A-Za-z0-9]{1,35}$/.test(data.ticket.merchantReference);
 }
 function proofbridgeCopyVpa(value){
  // Invoke directly within the Proceed user gesture; never after an API fetch.
  if(!value||window.isSecureContext===false||!navigator.clipboard?.writeText){
   // Older WebViews may expose only the synchronous, gesture-bound copy API.
   if(!document.execCommand||!document.createElement)return Promise.reject(Error('COPY_UNAVAILABLE'));
   const el=document.createElement('textarea');
   el.value=value;el.setAttribute('readonly','');el.style.position='fixed';
   el.style.opacity='0';document.body.appendChild(el);el.select();
   let ok=false;try{ok=document.execCommand('copy')}finally{document.body.removeChild(el)}
   return ok?Promise.resolve():Promise.reject(Error('COPY_DENIED'));
  }
  return navigator.clipboard.writeText(value);
 }
 function configureProofbridge(){
  if(!proofbridgeEnabled)return;
  const gate=get('proofbridgeGate'),consent=get('proofbridgeConsent');
  const button=get('proofbridgeProceed'),status=get('proofbridgeStatus');
  if(!gate||!consent||!button||!status)throw Error('PROOFBRIDGE_UI_MISSING');
  gate.hidden=false;button.disabled=true;
  status.textContent='Authorize this session to prepare the receiving details.';
  consent.addEventListener('change',async()=>{
   const version=++proofbridgeAuthSequence;
   proofbridgeAuthorized=null;proofbridgeReady=false;button.disabled=true;
   if(!consent.checked){
    status.textContent='Consent unchecked. Proceed is locked.';renderQr();return;
   }
   if(!session||expired()||receiptShown){status.textContent='Payment session expired.';renderQr();return}
   status.textContent='Authenticating one-time payment consent…';
   try{
    const r=await fetch('/api/proofbridge/authorize',{method:'POST',cache:'no-store',
     credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.token},
     body:JSON.stringify({orderId:session.orderId,token:session.token,consent:true})});
    const data=await r.json().catch(()=>({}));
    if(version!==proofbridgeAuthSequence||!consent.checked)return;
    if(!r.ok||!proofbridgeMatchesOrder(data))throw Error('PAYLOAD_MISMATCH');
    proofbridgeAuthorized=data;button.disabled=false;
    status.textContent='Session authorized. Touch Proceed to copy the receiving address.';
   }catch(_){
    if(version!==proofbridgeAuthSequence)return;
    status.textContent='Payment authorization failed. Do not pay using this link.';
    locked('Payment security check failed.');
   }
  });
  button.addEventListener('click',()=>{
   if(!p2pTrusted()){status.textContent='Payer and device security checks required before payment.';return;}
   if(!consent.checked||!proofbridgeAuthorized||proofbridgeReady||
      !session||expired()||receiptShown||Date.now()>=proofbridgeAuthorized.expiresAt){
    status.textContent='Payment not authorized. Request a fresh checkout.';return;
   }
   // Before copying check the exact server-authorized bytes again.
   if(!proofbridgeMatchesOrder(proofbridgeAuthorized)){
    button.disabled=true;status.textContent='Payment payload mismatch. Transaction blocked.';return;
   }
   button.disabled=true;
   const copied=proofbridgeCopyVpa(proofbridgeAuthorized.ticket.payeeVpa);
   Promise.resolve(copied).then(()=>{
    if(!consent.checked||expired()||Date.now()>=proofbridgeAuthorized.expiresAt)return;
    proofbridgeReady=true;gate.hidden=true;renderQr();
    const handoff=get('copyHandoff');
    if(handoff){
     get('copiedPayee').textContent='Receiving UPI ID copied securely';
     handoff.hidden=false;
     get('copyHandoffStatus').textContent='Open your payment app, paste the receiving address and confirm the exact amount. Return here for the receipt check.';
    }
    const note=get('proofbridgeEvidence');
    const merchantMode=proofbridgeAuthorized.ticket.paymentType==='P2M';
    const guidance=merchantMode?
     'Payment address copied. Use the registered merchant payment route to retain its classification. Awaiting authentic evidence.':
     'Receiving address copied. Awaiting verified transaction evidence.';
    if(note){note.hidden=mode==='generic';note.textContent=guidance}
    if(merchantMode)message('Merchant address copied. Use the registered merchant payment route.','info');
    void pollProofbridgeEvidence();
    if(!proofbridgePollTimer)proofbridgePollTimer=setInterval(()=>{void pollProofbridgeEvidence()},5000);
   }).catch(()=>{
    button.disabled=false;
    status.textContent='Browser blocked copying. No payment was launched. Use a supported secure browser.';
   });
  });
 }
 function setEventHandlers(){
  const trustButton=get('p2pPrepaymentAuthenticate');
  if(trustButton)trustButton.addEventListener('click',async()=>{
   const status=get('p2pPrepaymentStatus');
   if(!session||expired()||receiptShown)return;
   trustButton.disabled=true;p2pTrustedUntil=0;
   if(status)status.textContent='Authenticating payer and checking trusted device verdict…';
   try{
    if(!window.DISHAOneTouchVault?.authorize)throw Error('WEBAUTHN_UNAVAILABLE');
    const vault=await window.DISHAOneTouchVault.authorize(session.orderId);
    const response=await fetch('/api/p2p/prepayment/authorize',{
     method:'POST',credentials:'same-origin',cache:'no-store',
     headers:{'Content-Type':'application/json','X-CSRF-Token':session.token},
     body:JSON.stringify({orderId:session.orderId,token:session.token,vaultSessionId:vault.sessionId})
    });
    const verdict=await response.json().catch(()=>({}));
    if(!response.ok||verdict.authorized!==true||!Number.isFinite(verdict.expiresAt)||
       verdict.expiresAt<=Date.now())throw Error('PREPAYMENT_TRUST_DENIED');
    p2pTrustedUntil=verdict.expiresAt;
    if(status)status.textContent='Payer and device checks verified for this checkout.';
    renderQr();
    const payLaunch=get('p2pPaymentRequestLaunch');
    if(payLaunch&&window.isSecureContext!==false&&typeof window.PaymentRequest==='function')payLaunch.disabled=false;
   }catch(_){
    p2pTrustedUntil=0;
    if(status)status.textContent='Payment locked: payer authentication or trusted device checks unavailable.';
    renderQr();
   }finally{trustButton.disabled=expired()}
  });

  // P2P action copies the receiving VPA only. Never dispatch an app intent.
  get('vaultProceed').addEventListener('click',event=>{
   event.preventDefault();
   if(!session||receiptShown||expired()||!p2pTrusted()||
      ['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)||
      get('vaultProceed').getAttribute('aria-disabled')==='true'){
    message('Payment unavailable or expired. Request a fresh link.','info');return;
   }
   if(!model.isPersonalPayment(session.upiUri)){
    message('Use the registered merchant payment route for this payment.','info');return;
   }
   const payee=session.payeeVpa||new URLSearchParams(session.upiUri.split('?')[1]||'').get('pa');
   if(!payee){message('Receiving UPI ID is unavailable. Request a fresh link.','error');return;}
   get('vaultProceed').setAttribute('aria-disabled','true');
   proofbridgeCopyVpa(payee).then(()=>{
    copyReturnObserver?.markCopied(session);
    get('vaultProceed').setAttribute('aria-disabled','false');
    const handoff=get('copyHandoff');
    if(handoff){
     get('copiedPayee').textContent='Receiving UPI ID copied securely';
     handoff.hidden=false;
     get('copyHandoffStatus').textContent='UPI ID copied. Open Google Pay, PhonePe, Paytm or BHIM yourself, paste the ID, enter the exact amount and pay. Return here for the receipt check.';
    }
    const guide=get('paymentStageCopy');
    if(guide)guide.textContent='UPI ID copied. Open your preferred UPI app and paste the receiving address.';
    message('UPI ID copied. Open your UPI app and paste it.','success');
   }).catch(()=>{
    get('vaultProceed').setAttribute('aria-disabled','false');
    message('Could not copy the UPI ID. Allow clipboard access or try Chrome again. No UPI app was launched.','error');
   });
  });
  get('qrTapToPay').addEventListener('click',event=>{
   if(!session||receiptShown||expired()||!p2pTrusted()||
      ['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)||!model.supportsNativeUPI(userAgent)||
      get('qrTapToPay').getAttribute('aria-disabled')==='true') {
    event.preventDefault();
    message(expired()?'Payment window expired. Request a fresh link.':
     'Scan or import the personal-account QR inside your UPI app. P2P Intent is restricted.','info');
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
   if(quantumEnabled&&quantumClient){
    if(quantumReady){try{quantumClient.handoff(session,'generic')}catch(_){trace('SIGNAL_UNAVAILABLE')}}
   }


   trace('APP_DISPATCH','APP_GENERIC','generic');
  });
  for(const link of document.querySelectorAll('[data-upi-app]')){
   link.addEventListener('click',event=>{
    if(!session||receiptShown||expired()||!p2pTrusted()||
       ['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)||
       !model.supportsTargetedAppLaunch(userAgent)){
     event.preventDefault();
     message('This UPI app choice is unavailable. Scan the QR using your preferred app.','info');
     return;
    }
    qrTapStartedAt=Date.now();qrAppBackgrounded=false;
    if(quantumEnabled&&quantumReady&&quantumClient){
     try{quantumClient.handoff(session,link.dataset.upiApp)}catch(_){trace('SIGNAL_UNAVAILABLE')}
    }
    trace('APP_DISPATCH','APP_TARGETED',link.dataset.upiApp);
   });
  }
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
  const debitButton=get('payerDebitCheck');
  const evidenceDialog=get('debitEvidenceDialog');
  const evidenceRetry=get('debitEvidenceRetry');
  const checkDebitEvidence=async()=>{
   if(!session?.orderId||!session?.token||expired())return;
   if(debitButton)debitButton.disabled=true;
   try{
    const bound=session;
    const response=await fetch('/api/payer-debit-evidence/'+encodeURIComponent(bound.orderId)+
     '?token='+encodeURIComponent(bound.token),{credentials:'same-origin',cache:'no-store'});
    if(!response.ok||session!==bound||expired())throw Error('EVIDENCE_UNAVAILABLE');
    const result=await response.json();
    const status=result.paymentVerified===true&&result.debitVerified===true?
     'Authenticated receipt is available.':
     'No authenticated debit evidence is available for this checkout.';
    const node=get('payerDebitCheckStatus');if(node)node.textContent=status;
    if(evidenceDialog?.showModal){
     get('debitEvidenceTitle').textContent='Debit evidence status';
     get('debitEvidenceDialogStatus').textContent=status;
     get('debitEvidenceDialogFields')?.replaceChildren();
     if(!evidenceDialog.open)evidenceDialog.showModal();
    }
   }catch(_){
    const node=get('payerDebitCheckStatus');
    if(node)node.textContent='Evidence check unavailable; payment state unchanged.';
   }finally{if(debitButton)debitButton.disabled=expired();}
  };
  if(debitButton)debitButton.addEventListener('click',checkDebitEvidence);
  if(evidenceRetry)evidenceRetry.addEventListener('click',checkDebitEvidence);
  const diag=get('checkoutDebugPanel');
  if(debug&&diag){diag.hidden=false;get('checkoutDebugCopy').addEventListener('click',copyDebugReport)}
  get('saveReceipt').addEventListener('click',()=>{if(receiptShown)window.print()});
  get('shareReceipt').addEventListener('click',async()=>{
   if(!receiptShown)return;
   const content='DISHA verified payment receipt\nAmount: '+format(session.amount)+
    '\n'+(session.serviceNumber?'Service ID: '+session.serviceNumber+'\n':'')+
    'Bank UTR / reference: '+get('receiptUtr').textContent+
    (get('receiptPayerTxnRow')&&!get('receiptPayerTxnRow').hidden?
     '\nPayer transaction ID: '+get('receiptPayerTxn').textContent:'');
   try{
    if(navigator.share)await navigator.share({title:'DISHA payment receipt',text:content});
    else if(navigator.clipboard?.writeText){
     await navigator.clipboard.writeText(content);message('Receipt copied')}
   }catch(_){}
  });
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='hidden'){
    copyReturnObserver?.background();

    if(qrTapStartedAt&&!qrAppBackgrounded){
     qrAppBackgrounded=true;
     trace('BROWSER_HIDDEN');
    }
    if(quantumEnabled&&quantumReady&&quantumClient)quantumClient.background(session);


   }else onReturn();
  });
  window.addEventListener('pageshow',onReturn);
  window.addEventListener('focus',onReturn);
 }
 async function start(){
  setEventHandlers();showStage('qr');
  try{
   session=await getSession();
   // Read-only automatic check on Chrome return after copying the receiving VPA.
   copyReturnObserver=window.DISHACopyReturnObserver?.create({
    onState:event=>trace(event),
    onObservation:async bound=>{
     if(session!==bound||expired()||receiptShown)return;
     const label=get('payerDebitCheckStatus');
     if(label)label.textContent='Checking payer-side evidence automatically after Android return…';
     try{
      const url='/api/payer-debit-evidence/'+encodeURIComponent(bound.orderId)+
       '?token='+encodeURIComponent(bound.token);
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok||session!==bound||expired())return;
      const result=await response.json();
      if(label)label.textContent=result.debitVerified===true&&result.paymentVerified===true?
       'Authenticated debit evidence reported.':'Android return observed; authenticated debit evidence not yet available.';
     }catch(_){
      if(label)label.textContent='Android return observed; evidence check unavailable.';
     }
    }
   })||null;
   configureProofbridge();


   trace('QR_OPEN');


   const declared=String(session.paymentType||'').toUpperCase();
   const normalized=declared==='PERSONAL'?'P2P':declared==='MERCHANT'?'P2M':declared;
   if(requiredMode&&normalized!==requiredMode)throw Error('PAYMENT_MODE_MISMATCH');
   if(quantumEnabled){
    try {
     if(!quantumClient)throw Error('Quantum Signal client unavailable');
     quantumReady=Boolean(quantumClient.restore(session));
     if(!quantumReady)await quantumClient.prepare(session);
     quantumReady=true;
     get('vaultStatus').textContent='Device trust signal ready. Proceed to UPI.';
    } catch(_) {
     quantumReady=false;
     get('vaultStatus').textContent='Optional trust signal unavailable. UPI payment remains available.';
     trace('SIGNAL_UNAVAILABLE');
    }
   }
   trace('ORDER_READY');
   // Optional checkout-local WebAuthn + WebOTP transport probe; never settlement proof.
   window.DISHAAndroidCheckoutHandshake?.attach?.({orderId:session.orderId,expiresAt:session.expiresAt});


   saveSessionState();
   if(mode==='generic'&&query.get('paymentrequest')==='1')
    window.DISHAP2PPaymentRequestProbe?.attach?.(session,{window,document,
     isAuthorized:()=>p2pTrusted(),
     onPaymentResponse:async paymentResponse=>{
      const output=document.getElementById('p2pPaymentRequestStatus');
      if(!session.token||Date.now()>=session.expiresAt){
       if(output)output.textContent=JSON.stringify({state:'SESSION_AUTH_UNAVAILABLE',debitVerified:false});
       return;
      }
      const requestBody={orderId:session.orderId,token:session.token,
       methodName:paymentResponse.methodName,details:paymentResponse.details};
      const reply=await fetch('/api/upi-app-evidence/verify',{method:'POST',credentials:'same-origin',
       headers:{'Content-Type':'application/json','X-CSRF-Token':session.token},
       body:JSON.stringify(requestBody)});
      const result=await reply.json();
      if(output)output.textContent=JSON.stringify(result);
     }});
   const trustPanel=get('p2pPrepaymentGate');
   if(trustPanel)trustPanel.hidden=mode!=='generic';
   setMoney(session.amount);
   get('serviceIdentifier').textContent='Service ID · '+(session.serviceNumber||'Not assigned');
   setPaymentKind();
   const params=new URLSearchParams(session.upiUri.split('?')[1]||'');
   get('checkoutPaymentIdentity').textContent=(session.serviceNumber?'Service '+session.serviceNumber+' · ':'')+
    'Receiving UPI ID hidden · Use Copy UPI ID';
   get('paymentTrackingStatus').textContent='Payment status · Awaiting confirmation';
   const debitCheck=get('payerDebitCheck');if(debitCheck)debitCheck.disabled=false;
   get('checkoutNote').textContent=params.get('tn')||'Service';
   get('qrTapToPayHint').textContent=model.isPersonalPayment(session.upiUri)
    ?'Personal UPI: scan or import this QR in your UPI app. One-tap P2P intent is restricted.'
    :model.supportsNativeUPI(userAgent)
    ?'Tap to open your chosen UPI app, or scan the QR on another device.'
    :'Scan this QR with a UPI app on another phone.';
   showStage('qr');tickSessionTimer();


   // Initialize 3D vault after session is ready
   if(window.DISHAVault3D&&!window.DISHAVault3D.isReduced()){
    setTimeout(()=>window.DISHAVault3D.init(),300);
   }

   if(query.get('upi_intent_fallback')==='1'){
    // Chrome's fallback indicates a failed external-app handoff, not a payment decision.
    trace('APP_ERROR','APP_NAVIGATION_ERROR');
    message('UPI app could not be opened. Choose another app or scan this QR from another phone.','info');
   }


   await pollLedger();
   if(receiptShown)return;
   if(['EXPIRED','FAILED','CANCELLED'].includes(session.initialStatus)||expired())
    locked(session.initialStatus==='EXPIRED'||expired()?'This payment link expired. A recorded credit may still appear here.':'This payment did not complete.');
   ledgerTicker=setInterval(()=>{void pollLedger()},3500);
   expiryTicker=setInterval(tickSessionTimer,1000);
  }catch(err){locked(err?.message==='PAYMENT_MODE_MISMATCH'
    ?'Payment type and receiving account do not match. Request the correct P2P or P2M payment link.'
    :model.userFacingError(err,'load'))}
 }
 start();
})();
