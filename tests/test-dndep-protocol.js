'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createChallenge,verify,canonicalChallenge,canonicalAssertion,digest,sig,PROTOCOL}=require('../experimental/dndep/protocol');
const keys=()=>crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const server=keys(),observer=keys(),rogue=keys();
const t=1763758800000;
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
function fixture() {
  const {challenge,serverSignature}=createChallenge({orderId:'order123456',amountPaise:'50000',
    payeeVpa:'recipient@upi',serverPrivateKey:server.privateKey,now:t});
  const assertion={protocol:PROTOCOL,challengeDigest:digest(canonicalChallenge(challenge)),
    eventId:'event123456789',sourceKind:'notification',sourceId:'com.phonepe.app',
    sourceSignerSha256:'a'.repeat(64),observedAt:t+2000,consentedAt:t+500,
    amountPaise:challenge.amountPaise,payeeVpa:challenge.payeeVpa,
    reference:'123456789012',direction:'DEBIT',observerKeyId:'platform-key-001'};
  const store=new Set();
  const sign=()=>sig(canonicalAssertion(assertion),observer.privateKey);
  const args={challenge,serverSignature,serverPublicKey:server.publicKey,
    assertion,observerSignature:sign(),resolveObserver:()=>({
      publicKey:observer.publicKey,platformAuthorized:true,
      sourceVerifier:e=>e.sourceId==='com.phonepe.app' && e.sourceSignerSha256==='a'.repeat(64)}),
    claimUniqueReference:(ref,event,hash)=>{
      if(store.has(ref)||store.has(event)||store.has(hash))return false;
      store.add(ref);store.add(event);store.add(hash);return true;},
    now:t+3000};
  return {args,assertion,sign,store};
}
function check(name,code,mutate,resign=true) {
  test(name,()=>{
    const f=fixture();mutate(f);
    if(resign) f.args.observerSignature=f.sign();
    assert.equal(verify(f.args).code,code);
  });
}
test('valid platform-asserted observation never confirms payment',()=>{
  const r=verify(fixture().args);
  assert.equal(r.ok,true);assert.equal(r.code,'DEBIT_EVIDENCE_OBSERVED');
  assert.equal(r.paymentVerified,false);assert.equal(r.debitVerified,false);
  assert.equal(r.ledgerMutated,false);
});
test('challenge protected by server signature',()=>{
  const f=fixture();f.args.serverSignature=sig(canonicalChallenge(f.args.challenge),rogue.privateKey);
  assert.equal(verify(f.args).code,'CHALLENGE_SIGNATURE_INVALID');
});
check('unapproved observer denied','OBSERVER_UNTRUSTED',f=>f.args.resolveObserver=()=>({
  publicKey:observer.publicKey,platformAuthorized:false,sourceVerifier:()=>true}));
check('self-declared observer key denied','OBSERVER_UNTRUSTED',f=>f.args.resolveObserver=()=>null);
check('observer signature from rogue key denied','OBSERVER_UNTRUSTED',f=>
  f.args.observerSignature=sig(canonicalAssertion(f.assertion),rogue.privateKey),false);
check('unsigned amount tampering fails before business checks','OBSERVER_UNTRUSTED',
  f=>f.assertion.amountPaise='50001',false);
check('signed wrong amount denied','AMOUNT_MISMATCH',f=>f.assertion.amountPaise='50001');
check('signed wrong payee denied','PAYEE_MISMATCH',f=>f.assertion.payeeVpa='thief@upi');
check('cross-session nonce digest denied','SESSION_BINDING',f=>f.assertion.challengeDigest='b'.repeat(64));
check('consent after observation denied','CONSENT_OR_EVENT_TIME',f=>f.assertion.consentedAt=t+2500);
check('consent before challenge denied','CONSENT_OR_EVENT_TIME',f=>f.assertion.consentedAt=t-1);
check('observed future event denied','CONSENT_OR_EVENT_TIME',f=>f.assertion.observedAt=t+4000);
check('session expired denied','SESSION_EXPIRED',f=>f.args.now=t+180000);
check('nonmatching source package denied','SOURCE_UNTRUSTED',f=>f.assertion.sourceId='com.fake.app');
check('source cert substitution denied','SOURCE_UNTRUSTED',f=>f.assertion.sourceSignerSha256='b'.repeat(64));
check('source verifier absent fail closed','PROVENANCE_UNAVAILABLE',f=>
  f.args.resolveObserver=()=>({publicKey:observer.publicKey,platformAuthorized:true}));
check('replay storage absent fails closed','REPLAY_STORE_UNAVAILABLE',f=>f.args.claimUniqueReference=null);
check('schema extra field rejected','SCHEMA',f=>f.assertion.unexpected=true,false);
check('SMS cannot claim signing certificate','SCHEMA',f=>{
  f.assertion.sourceKind='sms';f.assertion.sourceId='BANKXYZ';},false);
test('same observed reference rejected on replay',()=>{
  const f=fixture();assert.equal(verify(f.args).ok,true);
  assert.equal(verify(f.args).code,'REPLAYED');
});
test('same reference cannot be claimed in second session',()=>{
  const first=fixture(),second=fixture();
  assert.equal(verify(first.args).ok,true);
  second.args.claimUniqueReference=first.args.claimUniqueReference;
  second.assertion.eventId='another_event1234';second.args.observerSignature=second.sign();
  assert.equal(verify(second.args).code,'REPLAYED');
});
console.log('D-NDEP research protocol tests '+passed+'/'+passed+' PASS');
