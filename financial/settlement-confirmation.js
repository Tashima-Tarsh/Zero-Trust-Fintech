'use strict';

const crypto = require('node:crypto');
const {rupeesToPaise} = require('./money');

// The key must belong exclusively to a bank/PSP/statement-ingestion service
// that independently established recipient credit. Never give it to a merchant.
function verifyCreditNotification(rawBody, headers, secret, nowMs = Date.now()) {
  if (!secret || secret.length < 32) throw Object.assign(new Error('SETTLEMENT_SOURCE_NOT_CONFIGURED'), {status:503});
  const stamp = String(headers['x-disha-timestamp'] || '');
  const signature = String(headers['x-disha-signature'] || '');
  if (!/^\d{10}$/.test(stamp) || Math.abs(nowMs - Number(stamp)*1000) > 300000)
    throw Object.assign(new Error('INVALID_SETTLEMENT_TIMESTAMP'), {status:401});
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature) || !Buffer.isBuffer(rawBody))
    throw Object.assign(new Error('MISSING_SETTLEMENT_SIGNATURE'), {status:401});
  const expected=crypto.createHmac('sha256', secret).update(stamp+'.').update(rawBody).digest();
  const received=Buffer.from(signature.slice(7),'hex');
  if (!crypto.timingSafeEqual(expected,received))
    throw Object.assign(new Error('INVALID_SETTLEMENT_SIGNATURE'), {status:401});
  let data;
  try {data=JSON.parse(rawBody.toString('utf8'))}catch(_){
    throw Object.assign(new Error('INVALID_SETTLEMENT_JSON'), {status:400});
  }
  if (data?.type!=='UPI_CREDIT_CONFIRMED' || typeof data.orderId!=='string' ||
      data.orderId.length<5 || data.orderId.length>128 ||
      !/^\d{12}$/.test(String(data.utr||'')) ||
      !/^[1-9]\d{0,9}$/.test(String(data.amountPaise||'')) ||
      !/^[\w.-]{2,100}@[\w.-]{2,40}$/.test(String(data.vpaAddress||''))) {
    throw Object.assign(new Error('INVALID_SETTLEMENT_EVENT'), {status:422});
  }
  return {
    orderId:data.orderId,
    utr:String(data.utr),
    amountPaise:String(data.amountPaise),
    vpaAddress:data.vpaAddress.toLowerCase()
  };
}

async function confirmCredit({db, event}) {
  const session=await db.findSessionByOrderId(event.orderId);
  if (!session) throw Object.assign(new Error('ORDER_NOT_FOUND'),{status:404});
  if (rupeesToPaise(String(session.challengeAmount))!==event.amountPaise ||
      String(session.vpaAddress||'').toLowerCase()!==event.vpaAddress)
    throw Object.assign(new Error('CREDIT_DETAILS_DO_NOT_MATCH_ORDER'),{status:422});
  if (session.status==='SUCCESS') {
    if (session.utr===event.utr) return {orderId:event.orderId, alreadyProcessed:true};
    throw Object.assign(new Error('ORDER_ALREADY_SETTLED_WITH_DIFFERENT_UTR'),{status:409});
  }
  const {txId,verification}=await db.atomicSettle(
    event.orderId,event.utr,session.challengeAmount,session.vpaAddress,null);
  if (!verification.balanced) throw new Error('LEDGER_NOT_BALANCED');
  return {orderId:event.orderId,txId,verification};
}
module.exports={verifyCreditNotification,confirmCredit};
