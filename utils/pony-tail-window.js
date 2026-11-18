'use strict';
/**
 * DISHA Pony-tail temporal gate.
 *
 * Defines a correlation/observation *policy*, not a payment probability.
 * There is no empirically supported 99.7% guarantee for a 15-second minimum
 * and no UTR confirmation guarantee from a 180-second maximum.
 */
const T_MIN_MS=15_000;
const T_MAX_MS=180_000;

function evaluateTemporalGate(session,now=Date.now()){
  const createdAt=Number(session?.createdAt);
  const expiresAt=Number(session?.expiresAt);
  if(!Number.isSafeInteger(createdAt)||!Number.isSafeInteger(expiresAt)||
     !Number.isSafeInteger(now)||createdAt<=0||expiresAt<=createdAt)
    return {state:'INVALID_SESSION_CLOCK',elapsedMs:null};
  const elapsedMs=now-createdAt;
  if(elapsedMs<0)return {state:'CLOCK_SKEW',elapsedMs};
  if(elapsedMs>T_MAX_MS||now>expiresAt)
    return {state:'EXPIRED',elapsedMs};
  if(elapsedMs<T_MIN_MS)
    return {state:'WAITING',elapsedMs,remainingMs:T_MIN_MS-elapsedMs};
  return {state:'OBSERVATION_WINDOW',elapsedMs};
}
module.exports={T_MIN_MS,T_MAX_MS,evaluateTemporalGate};
