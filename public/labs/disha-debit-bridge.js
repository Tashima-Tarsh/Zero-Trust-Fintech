/* DISHA debit-evidence bridge, LAB ONLY.
 * A deliberately small protocol facade, not a native Chrome API.
 * The transport must be supplied by a consented Android/Chromium lab integration.
 */
(function (root,factory) {
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DISHADebitBridgeLab=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STATES=Object.freeze({
    OBSERVED:'LAB_EVENT_OBSERVED_UNVERIFIED',
    CANCELLED:'USER_CANCELLED',
    INVALID:'INVALID_DEVICE_RESPONSE'
  });
  const validOrder=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{6,150}$/.test(id);
  const validVpa=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9._-]{2,40}$/i.test(v);
  const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&a===b;
  function validateRequest(p,now){
    if(!p||!validOrder(p.orderId)||!validVpa(p.payeeVpa)||
      typeof p.amountPaise!=='string'||!/^[1-9]\d{0,8}$/.test(p.amountPaise)||
      !Number.isSafeInteger(Number(p.amountPaise))||
      typeof p.nonce!=='string'||!/^[a-f0-9]{32,64}$/i.test(p.nonce)||
      !Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt>now+120000)
      throw Error('INVALID_CHECKOUT_BOUND_REQUEST');
    if(p.consent!==true)throw Error('EXPLICIT_USER_CONSENT_REQUIRED');
    return Object.freeze({
      orderId:p.orderId,payeeVpa:p.payeeVpa.toLowerCase(),
      amountPaise:p.amountPaise,nonce:p.nonce,expiresAt:p.expiresAt
    });
  }
  function normalize(raw,expected,now){
    // Never allow a transport to promote itself to bank authority.
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||
      raw.protocol!=='DISHA-DEBIT-BRIDGE-LAB-V1'||
      !equal(raw.orderId,expected.orderId)||!equal(raw.nonce,expected.nonce)||
      raw.amountPaise!==expected.amountPaise||
      typeof raw.payeeVpa!=='string'||raw.payeeVpa.toLowerCase()!==expected.payeeVpa||
      typeof raw.observedAt!=='number'||!Number.isSafeInteger(raw.observedAt)||
      raw.observedAt>now+3000||raw.observedAt<now-120000||
      now>=expected.expiresAt||raw.kind!=='SYNTHETIC_DEBIT_EVENT')
      return Object.freeze({state:STATES.INVALID,debitVerified:false,paymentVerified:false});
    // Do not expose arbitrary raw fields, account metadata, or private app data.
    return Object.freeze({
      state:STATES.OBSERVED,
      orderId:expected.orderId,
      amountPaise:expected.amountPaise,
      payeeVpa:expected.payeeVpa,
      observedAt:raw.observedAt,
      provenance:'LAB_SYNTHETIC_ANDROID',
      debitVerified:false,paymentVerified:false,settlementVerified:false
    });
  }
  function create({transport,clock=()=>Date.now()}={}){
    if(!transport||typeof transport.request!=='function')throw Error('ANDROID_TRANSPORT_REQUIRED');
    let pending=false;
    async function requestDebitEvidence(params){
      if(pending)throw Error('ONE_REQUEST_AT_A_TIME');
      const expected=validateRequest(params,clock());
      if(typeof params.userGestureConfirmed!=='boolean'||!params.userGestureConfirmed)
        throw Error('USER_GESTURE_REQUIRED');
      pending=true;
      try{
        const raw=await transport.request(expected);
        if(raw===null)return Object.freeze({state:STATES.CANCELLED,debitVerified:false,paymentVerified:false});
        return normalize(raw,expected,clock());
      }finally{pending=false}
    }
    return Object.freeze({requestDebitEvidence});
  }
  // Synthetic device adapter for deterministic tests only. No SMS and no banking.
  function syntheticTransport({clock=()=>Date.now(),cancel=false}={}){
    return Object.freeze({request:async expected=>cancel?null:{
      protocol:'DISHA-DEBIT-BRIDGE-LAB-V1',kind:'SYNTHETIC_DEBIT_EVENT',
      orderId:expected.orderId,nonce:expected.nonce,
      amountPaise:expected.amountPaise,payeeVpa:expected.payeeVpa,
      observedAt:clock()
    }});
  }
  return Object.freeze({create,syntheticTransport,normalize,validateRequest,STATES});
});
