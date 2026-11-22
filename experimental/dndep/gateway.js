'use strict';
/**
 * D-NDEP v0 server adapter. Research-only; does NOT acquire Android events.
 * All storage and attested trust must be supplied independently by deployer.
 * Never changes payment, bank-debit or settlement states.
 */
const crypto=require('node:crypto');
const {createChallenge,verify,canonicalChallenge,digest}=require('./protocol');
const invalid=code=>Object.freeze({ok:false,code,paymentVerified:false,debitVerified:false});
function timingEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function makeGateway({serverPrivateKey,serverPublicKey,lookupCheckout,challengeStore,
  resolveObserver,sourceReplayStore,receiptStore,now=Date.now}) {
  if(!serverPrivateKey||!serverPublicKey||typeof lookupCheckout!=='function'||
    !challengeStore||typeof challengeStore.put!=='function'||typeof challengeStore.get!=='function'||
    typeof resolveObserver!=='function'||typeof sourceReplayStore?.claim!=='function'||
    typeof receiptStore?.put!=='function'||typeof receiptStore?.get!=='function')
    throw Error('PRODUCTION_TRUST_AND_PERSISTENCE_REQUIRED');
  async function authenticate(orderId,bearer) {
    if(typeof bearer!=='string'||!bearer||typeof orderId!=='string')return null;
    const session=await lookupCheckout(orderId);
    if(!session||!timingEqual(session.bearerHash,
        crypto.createHash('sha256').update(bearer).digest('hex')))return null;
    return session;
  }
  return Object.freeze({
    async authorize({orderId,bearer,consent}) {
      if(consent!==true)return invalid('CONSENT_REQUIRED');
      const s=await authenticate(orderId,bearer);
      if(!s)return invalid('CHECKOUT_UNAUTHORIZED');
      const {challenge,serverSignature}=createChallenge({
        orderId:s.orderId,amountPaise:s.amountPaise,payeeVpa:s.payeeVpa,
        serverPrivateKey,now:now()});
      // Persist the server-issued challenge under exact order and token scope.
      await challengeStore.put(orderId,{challenge,serverSignature});
      return {ok:true,challenge,serverSignature};
    },
    async ingest({orderId,bearer,assertion,observerSignature}) {
      const s=await authenticate(orderId,bearer);
      if(!s)return invalid('CHECKOUT_UNAUTHORIZED');
      const stored=await challengeStore.get(orderId);
      if(!stored||!stored.challenge||stored.challenge.orderId!==orderId)
        return invalid('CHALLENGE_NOT_FOUND');
      let verifiedClaim=null;
      const r=verify({
        challenge:stored.challenge,serverSignature:stored.serverSignature,
        serverPublicKey,assertion,observerSignature,resolveObserver,
        claimUniqueReference:(ref,event,hash)=>{verifiedClaim={ref,event,hash};return true;},
        now:now()});
      if(!r.ok)return r;
      // Await a durable atomic UNIQUE claim before exposing a receipt.
      // Returning a Promise from the synchronous wire verifier is not sufficient.
      let claimed=false;
      try { claimed=(await sourceReplayStore.claim(verifiedClaim.ref,verifiedClaim.event,verifiedClaim.hash))===true; }
      catch (_) { return invalid('REPLAY_STORE_UNAVAILABLE'); }
      if(!claimed)return invalid('REPLAYED');
      // Persist only sanitized receipt fields, never raw SMS or notification body.
      const receipt=Object.freeze({orderId,challengeDigest:digest(canonicalChallenge(stored.challenge)),
        status:'DEBIT_EVIDENCE_OBSERVED',sourceKind:r.sourceKind,receiptHash:r.receiptHash,
        paymentVerified:false,debitVerified:false,ledgerMutated:false});
      await receiptStore.put(orderId,receipt);
      return {ok:true,receipt};
    },
    async readReceipt({orderId,bearer}) {
      const s=await authenticate(orderId,bearer);
      if(!s)return invalid('CHECKOUT_UNAUTHORIZED');
      const r=await receiptStore.get(orderId);
      return r?{ok:true,receipt:r}:invalid('OBSERVATION_NOT_AVAILABLE');
    }
  });
}
module.exports={makeGateway};
