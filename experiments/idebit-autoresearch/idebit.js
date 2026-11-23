'use strict';
const crypto=require('node:crypto');
const fields=['protocol','issuerId','issuerEventId','orderId','nonce','utr','amountPaise','payeeVpa','payerDebit','payeeCredit','finality','paidAt'];
const safe=v=>Number.isSafeInteger(v)&&v>0;
function canonical(e){
 if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).length!==fields.length||fields.some(k=>!Object.hasOwn(e,k)))throw Error('SCHEMA_INVALID');
 if(e.protocol!=='DISHA-IDEBIT-RESEARCH-V1'||!/^[a-z0-9._-]{3,64}$/.test(e.issuerId)||!/^[A-Za-z0-9_-]{8,128}$/.test(e.issuerEventId)||!/^[A-Za-z0-9_-]{6,150}$/.test(e.orderId)||!/^[a-f0-9]{64}$/.test(e.nonce)||!/^[0-9]{12}$/.test(e.utr)||!/^[1-9][0-9]{0,15}$/.test(e.amountPaise)||!/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(e.payeeVpa)||typeof e.payerDebit!=='boolean'||typeof e.payeeCredit!=='boolean'||!['PENDING','FINAL','REVERSED'].includes(e.finality)||!safe(e.paidAt))throw Error('SCHEMA_INVALID');
 return JSON.stringify(Object.fromEntries(fields.map(k=>[k,e[k]])));
}
function evaluate({evidence,signature,order,registry,seen,now=Date.now()}){
 let data;try{data=canonical(evidence)}catch{return {state:'REJECTED',reason:'SCHEMA_INVALID'}}
 if(!order||order.orderId!==evidence.orderId||order.nonce!==evidence.nonce||String(order.amountPaise)!==evidence.amountPaise||order.payeeVpa!==evidence.payeeVpa)return {state:'REJECTED',reason:'ORDER_BINDING_MISMATCH'};
 if(!safe(order.createdAt)||!safe(order.expiresAt)||order.createdAt>=order.expiresAt||evidence.paidAt<order.createdAt-30000||evidence.paidAt>order.expiresAt+120000||evidence.paidAt>now+30000)return {state:'UNVERIFIED',reason:'TIME_WINDOW_INVALID'};
 const issuer=registry?.[evidence.issuerId];
 if(!issuer||!issuer.enabled||!issuer.authorityVerified||issuer.authority!=='PAYER_AND_PAYEE_FINALITY')return {state:'UNVERIFIED',reason:'ISSUER_AUTHORITY_NOT_ESTABLISHED'};
 if(!issuer.publicKey||typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))return {state:'REJECTED',reason:'SIGNATURE_INVALID'};
 try{const key=issuer.publicKey?.type==='public'?issuer.publicKey:crypto.createPublicKey(issuer.publicKey);if(key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,Buffer.from(data),key,Buffer.from(signature,'base64url')))return {state:'REJECTED',reason:'SIGNATURE_INVALID'}}catch{return {state:'REJECTED',reason:'SIGNATURE_INVALID'}}
 if(evidence.finality==='REVERSED')return {state:'REVERSED',reason:'SOURCE_REPORTED_REVERSAL'};
 if(!evidence.payerDebit||!evidence.payeeCredit||evidence.finality!=='FINAL')return {state:'UNVERIFIED',reason:'FINALITY_NOT_PROVEN'};
 // Synthetic only: production requires atomic transactional uniqueness in durable storage.
 const key=evidence.issuerId+':'+evidence.utr,eventKey=evidence.issuerId+':'+evidence.issuerEventId;
 if(seen.has(key)||seen.has(eventKey))return {state:'REJECTED',reason:'REPLAY'};
 seen.add(key);seen.add(eventKey);
 return {state:'VERIFIED_IN_TEST',reason:'ALL_TEST_GATES_PASSED',evidenceHash:crypto.createHash('sha256').update(data).digest('hex')};
}
module.exports={canonical,evaluate};
