'use strict';
/**
 * Candidate-only debit SMS parser. It can never authenticate a bank SMS.
 * No raw message is persisted; parsed fields are untrusted until the source
 * and underlying debit are independently authenticated.
 */
const {rupeesToPaise}=require('./money');
const {lookupBankSender}=require('./bank-sms-header-registry');
function extractDebitSmsCandidate(input){
 const {sender,text,receivedAt}=input||{};
 if(typeof text!=='string'||text.length<18||text.length>1600||
    typeof sender!=='string'||sender.length>40||!Number.isSafeInteger(receivedAt)||
    receivedAt<=0)return null;
 // Preserve sender provenance as claim only. A published header isn't a signature.
 const header=lookupBankSender(sender);
 // A generic credit/reversal/failed transaction must not be recognized as debit.
 const msg=text.replace(/\s+/g,' ').trim();
 const neg=/(?:\b(?:credited|credit to|received|refund(?:ed)?|reversal|reversed|declined|failed|unsuccessful|not debited|cancelled|pending|request to pay)\b)/i;
 if(neg.test(msg))return null;
 const debit=/(?:\b(?:debited|debit|spent|withdrawn|paid|sent|transferred)\b)/i;
 if(!debit.test(msg))return null;
 // Only an explicit INR/rupee amount. Never infer amount from reference.
 const money=msg.match(/(?:\bINR\s*|(?:Rs\.?|₹)\s*)([\d,]+(?:\.\d{1,2})?)/i);
 if(!money)return null;
 let amountPaise;
 try{amountPaise=rupeesToPaise(money[1].replace(/,/g,''))}catch(_){return null}
 if(!/^\d+$/.test(String(amountPaise))||BigInt(amountPaise)<=0n)return null;
 const ref=msg.match(/\b(?:UPI\s*(?:Ref(?:erence)?(?:\s*No\.?)?|Txn|Transaction)\s*(?:No\.?)?|UTR|RRN|Ref(?:erence)?\s*(?:No\.?)?)\s*[:#-]?\s*(\d{12})\b/i);
 const vpa=msg.match(/\b([a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,40})\b/);
 const acct=msg.match(/(?:a\/c|acct?|account)(?:\s*(?:no\.?|number))?\s*[:xX*.-]*\s*(\d{4})\b/i);
 return Object.freeze({source:'SMS_TEXT_CANDIDATE_UNVERIFIED',
   senderHeaderMatched:header.matched===true,amountPaise:String(amountPaise),
   utrCandidate:ref?.[1]||null,payeeVpaCandidate:vpa?.[1]?.toLowerCase()||null,
   accountLast4:acct?.[1]||null,receivedAt,authenticatedDebit:false,paymentVerified:false});
}
function matchDebitSmsToCheckout(candidate,session,{now=Date.now(),windowMs=180000}={}){
 const reasons=[];
 if(!candidate||!session)return Object.freeze({matched:false,reasons:['MISSING_CANDIDATE_OR_SESSION'],debitVerified:false});
 const expiresAt=Number(session.expiresAt);
 if(!Number.isSafeInteger(expiresAt)||now>expiresAt||
    !Number.isSafeInteger(candidate.receivedAt)||candidate.receivedAt>now+30000||
    candidate.receivedAt<expiresAt-windowMs-30000||candidate.receivedAt>expiresAt+30000)reasons.push('TIME_WINDOW_MISMATCH');
 let expectedAmount;
 try{expectedAmount=rupeesToPaise(String(session.challengeAmount))}catch(_){reasons.push('INVALID_CHECKOUT_AMOUNT')}
 if(String(candidate.amountPaise)!==String(expectedAmount))reasons.push('AMOUNT_MISMATCH');
 if(candidate.payeeVpaCandidate&&String(session.vpaAddress||'').toLowerCase()!==candidate.payeeVpaCandidate)
  reasons.push('PAYEE_MISMATCH');
 return Object.freeze({matched:reasons.length===0,reasons,
  debitVerified:false,paymentVerified:false,sourceAuthenticated:false,
  utrCandidate:candidate.utrCandidate||null});
}
module.exports={extractDebitSmsCandidate,matchDebitSmsToCheckout};
