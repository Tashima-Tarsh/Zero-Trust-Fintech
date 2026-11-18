/* DISHA 8.2 One-Touch Vault: a local passkey authorization before UPI app handoff.
   No bank API, no payment settlement, no fabricated payment SUCCESS. */
(function(root){
  'use strict';
  const STORAGE_KEY='disha82:device-vault-user:v1';
  const ID_PATTERN=/^vault_[0-9a-f-]{30,50}$/i;

  function getDeviceUserId(){
    let cached='';
    try {cached=localStorage.getItem(STORAGE_KEY)||'';} catch(_){}
    if(ID_PATTERN.test(cached))return cached;
    if(!root.crypto || typeof root.crypto.getRandomValues!=='function')
      throw Error('Secure device identity is unavailable. Use a supported browser.');
    const id = typeof root.crypto.randomUUID === 'function'
      ? root.crypto.randomUUID()
      : Array.from(root.crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const generated='vault_'+id;
    try {localStorage.setItem(STORAGE_KEY,generated);} catch(_){
      throw Error('Device storage is unavailable. Allow site storage to register your vault.');
    }
    return generated;
  }

  async function post(url,body){
    const result=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;
    try {data=await result.json();}catch(_){data={};}
    if(!result.ok){
      const error=Error(data.message||data.error||'Vault authentication is unavailable.');
      error.needsRegistration=Boolean(data.needsRegistration);
      error.status=result.status;
      throw error;
    }
    return data;
  }

  async function authorize(orderId,reporter){
    const emit=(event,code='OK')=>{try{if(typeof reporter==='function')reporter(event,code)}catch(_){}};
    if(!orderId || !/^[a-z0-9_-]{6,150}$/i.test(orderId))
      throw Error('The payment request is invalid.');
    const sdk=root.SimpleWebAuthnBrowser;
    emit('VAULT_ENV',root.isSecureContext===false?'INSECURE_CONTEXT':
      !sdk?.startAuthentication?'SDK_MISSING':
      root.PublicKeyCredential===undefined?'NO_WEB_AUTHN':'OK');
    if(!sdk?.startRegistration || !sdk?.startAuthentication)
      throw Error('Device vault could not load. Retry or use another supported browser.');
    const userId=getDeviceUserId();
    let begin;
    emit('VAULT_AUTH_API');
    try {begin=await post('/api/webauthn/authenticate/start',{userId,orderId});}
    catch(error){
      if(!error.needsRegistration)throw error;
      emit('VAULT_REGISTER_NEEDED');
      const init=await post('/api/webauthn/register/start',{userId,userName:'DISHA Device Vault',orderId});
      emit('VAULT_REGISTER_PROMPT');
      const credential=await sdk.startRegistration({optionsJSON:init.publicKey});
      const finish=await post('/api/webauthn/register/finish',{sessionId:init.sessionId,credential});
      if(!finish.success || !finish.sessionId || finish.orderId!==orderId)
        throw Error('Device vault registration did not authorize this order.');
      return {sessionId:finish.sessionId,registered:true};
    }
    if(!begin.success||!begin.sessionId)throw Error('Vault challenge missing.');
    emit('VAULT_AUTH_PROMPT');
    const credential=await sdk.startAuthentication({optionsJSON:begin.publicKey});
    const finish=await post('/api/webauthn/authenticate/finish',{sessionId:begin.sessionId,credential});
    if(!finish.success||finish.orderId!==orderId)
      throw Error('Vault authorization did not match the order.');
    return {sessionId:finish.sessionId,registered:false};
  }

  function launchUPI(uri){
    if(typeof uri!=='string'||!/^upi:\/\/pay\?/i.test(uri))
      throw Error('This payment request has no valid UPI destination.');
    // Navigation might be blocked by browsers after an async passkey ceremony.
    // The caller must display a real, user-tappable fallback anchor FIRST.
    root.location.assign(uri);
  }

  // This runs inside the checkout browser. It observes only browser-visible
  // lifecycle events and explicit URL parameters; it cannot read the UPI app.
  const PREFIX='disha82:vault-evidence:';
  const LAST=PREFIX+'last-order';
  const RETURN_FIELDS=['Status','status','txnId','txnRef','ApprovalRefNo','responseCode','tr','am','pa'];
  let sending=null;

  function readAttempt(orderId){
    if(!orderId)return null;
    try{
      const value=JSON.parse(sessionStorage.getItem(PREFIX+orderId)||'null');
      if(!value||value.orderId!==orderId||Date.now()-value.handoffAt>900000){
        sessionStorage.removeItem(PREFIX+orderId);
        return null;
      }
      return value;
    }catch(_){return null}
  }
  function saveAttempt(data){
    sessionStorage.setItem(PREFIX+data.orderId,JSON.stringify(data));
  }
  function getPendingOrderId(){
    try{return sessionStorage.getItem(LAST)}catch(_){return null}
  }
  function beginHandoff(orderId,vaultSessionId,checkoutToken,app='generic'){
    const selectedApp=String(app||'generic').toLowerCase();
    if(!['gpay','phonepe','paytm','cred','generic'].includes(selectedApp))
      throw Error('Unsupported UPI application selected.');
    if(!/^[A-Za-z0-9_-]{6,150}$/.test(orderId||'')||
       !/^[a-f0-9]{32}$/i.test(vaultSessionId||'')||
       !/^[a-f0-9]{24,64}$/i.test(checkoutToken||''))
      throw Error('A verified Vault session and checkout token are required.');
    if(!root.crypto?.getRandomValues)throw Error('Secure evidence ID unavailable');
    const random=new Uint8Array(16);
    root.crypto.getRandomValues(random);
    const eventId=Array.from(random,b=>b.toString(16).padStart(2,'0')).join('');
    saveAttempt({orderId,vaultSessionId,token:checkoutToken,selectedApp,
      eventId,handoffAt:Date.now(),hiddenAt:null,evidence:null,receipt:null});
    sessionStorage.setItem(LAST,orderId);
    return eventId;
  }
  function markBackgrounded(orderId=getPendingOrderId()){
    const data=readAttempt(orderId);
    if(!data||data.evidence||data.receipt||data.hiddenAt!==null)return;
    data.hiddenAt=Date.now();
    saveAttempt(data);
  }
  function returnFields(){
    const observed={};
    const query=new URLSearchParams(root.location.search||'');
    const fragment=String(root.location.hash||'').replace(/^#/,'');
    const hash=(fragment.includes('=')&&!fragment.includes('/'))?
      new URLSearchParams(fragment):new URLSearchParams();
    for(const key of RETURN_FIELDS){
      const value=query.get(key)??hash.get(key);
      if(typeof value==='string'&&value.length>0&&value.length<=100)
        observed[key]=value;
    }
    return observed;
  }
  // Only a browser navigation observation, not a payment result.
  function markIntentFallback(orderId=getPendingOrderId()){
    const data=readAttempt(orderId);
    if(!data||data.receipt)return null;
    if(!data.evidence){
      data.evidence={browserEvent:'INTENT_FALLBACK',
        handoffAt:data.handoffAt,hiddenAt:data.hiddenAt,returnedAt:Date.now(),
        selectedApp:data.selectedApp||'generic',returnParams:{}};
      saveAttempt(data);
    }
    return requestEvidence(orderId);
  }
  // The checkout browser asks the Vault for the evidence packet. The Vault
  // returns the observations for this particular authorized handoff without
  // sending or inventing any financial outcome itself.
  function requestEvidence(orderId=getPendingOrderId()){
    const data=readAttempt(orderId);
    if(!data||data.receipt||
       (typeof document!=='undefined'&&document.visibilityState==='hidden'))
      return null;
    const params=returnFields();
    if(!data.evidence){
      if(data.hiddenAt===null&&Object.keys(params).length===0)return null;
      data.evidence={
        browserEvent:Object.keys(params).length?'RETURN_QUERY_OBSERVED':'APP_RESUME',
        handoffAt:data.handoffAt,hiddenAt:data.hiddenAt,
        returnedAt:Date.now(),selectedApp:data.selectedApp||'generic',returnParams:params
      };
      saveAttempt(data); // Persist the same evidence for network retries.
    }
    // Returned only to this checkout's first-party JS. Backend authenticates
    // both the Vault authorization and the original order token before storing.
    return {
      orderId:data.orderId,
      vaultSessionId:data.vaultSessionId,
      token:data.token,
      eventId:data.eventId,
      evidence:JSON.parse(JSON.stringify(data.evidence))
    };
  }

  // Browser acknowledges only after /api/vault/evidence successfully stores
  // the packet. No local success flag can turn an observation into settlement.
  function acknowledgeEvidence(orderId,eventId,serverReply){
    const data=readAttempt(orderId);
    if(!data||data.eventId!==eventId||!data.evidence)
      throw Error('Vault evidence acknowledgment does not match this handoff.');
    if(data.receipt)return data.receipt;
    const safeStates=new Set([
      'UTR_CANDIDATE_UNVERIFIED',
      'RETURN_OBSERVED_NO_UTR',
      'INTENT_LAUNCH_UNRESOLVED',
      'FAILURE_CLAIM_UNVERIFIED',
      'CONFLICTING_EVIDENCE',
      'LATE_RETURN_OBSERVATION'
    ]);
    if(!serverReply||serverReply.success!==true||!safeStates.has(serverReply.state))
      throw Error('Vault evidence storage acknowledgment is invalid.');
    data.receipt={
      success:true,
      state:serverReply.state,
      utrCandidate:typeof serverReply.utrCandidate==='string'?
        serverReply.utrCandidate:null,
      verified:false,
      settled:false
    };
    delete data.token; // Remove the order bearer token once acknowledged.
    saveAttempt(data);
    return data.receipt;
  }

  // Backward-compatible helper for older checkout clients. The canonical
  // checkout pages now explicitly request -> submit -> acknowledge.
  async function submitReturnEvidence(orderId=getPendingOrderId()){
    if(sending)return sending;
    const packet=requestEvidence(orderId);
    if(!packet)return readAttempt(orderId)?.receipt||null;
    sending=(async()=>{
      const response=await fetch('/api/vault/evidence',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':packet.token},
        body:JSON.stringify(packet)
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.success)
        throw Error(result.error||'Vault evidence could not be delivered');
      return acknowledgeEvidence(orderId,packet.eventId,result);
    })();
    try{return await sending}finally{sending=null}
  }

  root.DISHAOneTouchVault=Object.freeze({getDeviceUserId,authorize,launchUPI,
    beginHandoff,markBackgrounded,markIntentFallback,requestEvidence,acknowledgeEvidence,
    submitReturnEvidence,getPendingOrderId});
})(window);
