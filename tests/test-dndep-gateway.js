'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {makeGateway}=require('../experimental/dndep/gateway');
const {PROTOCOL,canonicalChallenge,canonicalAssertion,digest,sig}=require('../experimental/dndep/protocol');
const kp=()=>crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const server=kp(),observer=kp();const T=1763758800000;
const bearer='authorised-checkout-token';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
let count=0;
const check=(name,condition)=>{assert.ok(condition,name);count++;console.log('PASS '+name)};
(async()=>{
 const challengeMap=new Map(),receipts=new Map(),references=new Set();
 let clock=T;
 const checkout={orderId:'order123456',bearerHash:sha(bearer),amountPaise:'50000',payeeVpa:'recipient@upi',status:'PENDING',expiresAt:T+200000};
 const gateway=makeGateway({serverPrivateKey:server.privateKey,serverPublicKey:server.publicKey,
   lookupCheckout:async id=>id===checkout.orderId?checkout:null,
   challengeStore:{put:async(id,item)=>challengeMap.set(id,item),get:async id=>challengeMap.get(id)},
   receiptStore:{put:async(id,item)=>receipts.set(id,item),get:async id=>receipts.get(id)},
   resolveObserver:id=>id==='attested-observer-001'?{publicKey:observer.publicKey,platformAuthorized:true,
     sourceVerifier:e=>e.sourceId==='com.phonepe.app'&&e.sourceSignerSha256==='a'.repeat(64)}:null,
   sourceReplayStore:{claim:async (ref,event,hash)=>{if(references.has(ref)||references.has(event)||references.has(hash))return false;
     references.add(ref);references.add(event);references.add(hash);return true;}},
   now:()=>clock});
 check('unauthorized checkout cannot get challenge',
   !(await gateway.authorize({orderId:checkout.orderId,bearer:'bad',consent:true})).ok);
 check('consent required before challenge',
   (await gateway.authorize({orderId:checkout.orderId,bearer,consent:false})).code==='CONSENT_REQUIRED');
 const auth=await gateway.authorize({orderId:checkout.orderId,bearer,consent:true});
 check('server challenge issued',auth.ok&&auth.challenge.issuedAt===T&&auth.challenge.expiresAt-auth.challenge.issuedAt===180000);
 clock=T+3000;
 const evidence={protocol:PROTOCOL,challengeDigest:digest(canonicalChallenge(auth.challenge)),
   eventId:'event123456789',sourceKind:'notification',sourceId:'com.phonepe.app',
   sourceSignerSha256:'a'.repeat(64),observedAt:T+2000,consentedAt:T+500,
   amountPaise:'50000',payeeVpa:'recipient@upi',reference:'123456789012',direction:'DEBIT',
   observerKeyId:'attested-observer-001'};
 const sign=()=>sig(canonicalAssertion(evidence),observer.privateKey);
 check('unsigned observer mutation denied',
   (await gateway.ingest({orderId:checkout.orderId,bearer,
    assertion:{...evidence,amountPaise:'50001'},observerSignature:sign()})).ok===false);
 check('no unauthorised receipt read',
   (await gateway.readReceipt({orderId:checkout.orderId,bearer:'thief'})).code==='CHECKOUT_UNAUTHORIZED');
 check('no receipt before authenticated observation',
   (await gateway.readReceipt({orderId:checkout.orderId,bearer})).code==='OBSERVATION_NOT_AVAILABLE');
 const submitted=await gateway.ingest({orderId:checkout.orderId,bearer,
   assertion:evidence,observerSignature:sign()});
 check('signed observation reaches authenticated server gateway',
   submitted.ok&&submitted.receipt.status==='DEBIT_EVIDENCE_OBSERVED');
 check('receipt never verifies payment',submitted.receipt.paymentVerified===false&&
   submitted.receipt.debitVerified===false&&submitted.receipt.ledgerMutated===false);
 const read=await gateway.readReceipt({orderId:checkout.orderId,bearer});
 check('receipt readable only to bound checkout bearer',
   read.ok&&read.receipt.receiptHash===submitted.receipt.receiptHash);
 check('same observation rejected by persistent replay adapter',
   (await gateway.ingest({orderId:checkout.orderId,bearer,assertion:evidence,observerSignature:sign()})).code==='REPLAYED');
 const originalAmount=checkout.amountPaise;
 checkout.amountPaise='50001';
 check('changed checkout amount invalidates stored receipt',
   (await gateway.readReceipt({orderId:checkout.orderId,bearer})).code==='OBSERVATION_NOT_AVAILABLE');
 check('changed checkout amount invalidates signed challenge',
   (await gateway.ingest({orderId:checkout.orderId,bearer,assertion:evidence,observerSignature:sign()})).code==='CHECKOUT_BINDING_CHANGED');
 checkout.amountPaise=originalAmount;
 const originalStatus=checkout.status;
 checkout.status='CANCELLED';
 check('cancelled checkout cannot issue or read observations',
   (await gateway.authorize({orderId:checkout.orderId,bearer,consent:true})).code==='CHECKOUT_UNAUTHORIZED' &&
   (await gateway.readReceipt({orderId:checkout.orderId,bearer})).code==='CHECKOUT_UNAUTHORIZED');
 checkout.status=originalStatus;
 clock=T+200000;
 check('expired checkout cannot reveal a previously observed receipt',
   (await gateway.readReceipt({orderId:checkout.orderId,bearer})).code==='CHECKOUT_UNAUTHORIZED');
 clock=T+3000;
 check('foreign order cannot consume evidence',
   (await gateway.ingest({orderId:'other12345',bearer,assertion:evidence,observerSignature:sign()})).code==='CHECKOUT_UNAUTHORIZED');
 console.log('D-NDEP gateway '+count+'/'+count+' synthetic integration checks PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
