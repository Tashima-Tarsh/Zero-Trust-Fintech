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
    if(!root.crypto || typeof root.crypto.randomUUID!=='function')
      throw Error('Secure device identity is unavailable. Use a supported HTTPS browser.');
    const generated='vault_'+root.crypto.randomUUID();
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

  async function authorize(orderId){
    if(!orderId || !/^[a-z0-9_-]{6,150}$/i.test(orderId))
      throw Error('The payment request is invalid.');
    const sdk=root.SimpleWebAuthnBrowser;
    if(!sdk?.startRegistration || !sdk?.startAuthentication)
      throw Error('Device vault could not load. Retry or use another supported browser.');
    const userId=getDeviceUserId();
    let begin;
    try {begin=await post('/api/webauthn/authenticate/start',{userId,orderId});}
    catch(error){
      if(!error.needsRegistration)throw error;
      const init=await post('/api/webauthn/register/start',{userId,userName:'DISHA Device Vault',orderId});
      const credential=await sdk.startRegistration({optionsJSON:init.publicKey});
      const finish=await post('/api/webauthn/register/finish',{sessionId:init.sessionId,credential});
      if(!finish.success || !finish.sessionId || finish.orderId!==orderId)
        throw Error('Device vault registration did not authorize this order.');
      return {sessionId:finish.sessionId,registered:true};
    }
    if(!begin.success||!begin.sessionId)throw Error('Vault challenge missing.');
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

  root.DISHAOneTouchVault=Object.freeze({getDeviceUserId,authorize,launchUPI});
})(window);
