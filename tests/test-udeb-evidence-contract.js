'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {normalize,makeChallenge,verify,ORIGIN,PROTOCOL}=require('../financial/udeb-evidence-contract');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const {privateKey:attackerPrivate}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const now=1763758800000;
let passed=0;
const run=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
function fixture(){
 const challenge=makeChallenge({orderId:'order12345',amountPaise:'50000',payeeVpa:'person@upi',now});
 const evidence={protocol:PROTOCOL,orderId:challenge.orderId,nonce:challenge.nonce,origin:ORIGIN,
  sourceClass:'notification',sourceIdentity:'com.phonepe.app',sourceCertificateSha256:'a'.repeat(64),
  eventId:'event123456789',amountPaise:'50000',payeeVpa:'person@upi',direction:'DEBIT',
  reference:'123456789012',observedAt:now+1000,consentedAt:now+500};
 const sign=(e,key=privateKey)=>crypto.sign('sha256',Buffer.from(normalize(e)),key).toString('base64url');
 const seen=new Set();
 const replayStore={claim:(ref,hash)=>{if(seen.has(ref)||seen.has(hash))return false;seen.add(ref);seen.add(hash);return true}};
 const opts={challenge,evidence,signature:sign(evidence),trustedPublicKey:publicKey,now:now+3000,
  approvedSource:(cls,id,cert)=>cls==='notification'&&id==='com.phonepe.app'&&cert==='a'.repeat(64),replayStore};
 return {opts,sign,attackerPrivate};
}
function check(name,expected,mutate){run(name,()=>{const f=fixture();mutate(f);if(!['SIGNATURE_INVALID','EVIDENCE_SCHEMA'].includes(expected))f.opts.signature=f.sign(f.opts.evidence);assert.equal(verify(f.opts).code,expected)})}
run('valid signed fixture is observation-only',()=>{const r=verify(fixture().opts);assert.equal(r.ok,true);assert.equal(r.paymentVerified,false);assert.equal(r.debitVerified,false)});
check('tampered amount','AMOUNT_MISMATCH',f=>f.opts.evidence.amountPaise='50001');
check('wrong payee','PAYEE_MISMATCH',f=>f.opts.evidence.payeeVpa='thief@upi');
check('wrong nonce','SESSION_BINDING',f=>f.opts.evidence.nonce='b'.repeat(64));
check('wrong order','SESSION_BINDING',f=>f.opts.evidence.orderId='other12345');
check('expired','SESSION_EXPIRED',f=>f.opts.now=f.opts.challenge.expiresAt);
check('pre-session event','TIME_INVALID',f=>f.opts.evidence.observedAt=now-1);
check('future event','TIME_INVALID',f=>f.opts.evidence.observedAt=now+9000);
check('consent after observed event','TIME_INVALID',f=>f.opts.evidence.consentedAt=now+1500);
check('fake package','SOURCE_UNTRUSTED',f=>f.opts.evidence.sourceIdentity='com.phonepe.fake');
check('fake certificate','SOURCE_UNTRUSTED',f=>f.opts.evidence.sourceCertificateSha256='b'.repeat(64));
check('bad signature','SIGNATURE_INVALID',f=>f.opts.signature=f.sign(f.opts.evidence,f.attackerPrivate));
check('no trust key','SIGNATURE_INVALID',f=>f.opts.trustedPublicKey=null);
check('missing replay storage','REPLAY_STORE_UNAVAILABLE',f=>f.opts.replayStore=null);
check('schema extra field','EVIDENCE_SCHEMA',f=>f.opts.evidence.test=true);
check('schema SMS header cannot claim app certificate','EVIDENCE_SCHEMA',f=>{f.opts.evidence.sourceClass='sms';f.opts.evidence.sourceIdentity='BANKXYZ'});
run('valid consent before debit observation',()=>{const r=verify(fixture().opts);assert.equal(r.ok,true)});
check('consent before issued challenge','TIME_INVALID',f=>f.opts.evidence.consentedAt=now-1);
check('tampered amount with stale signature rejected before field match','SIGNATURE_INVALID',f=>f.opts.evidence.amountPaise='50001');
run('same signed reference cannot be replayed',()=>{const f=fixture();assert.equal(verify(f.opts).ok,true);assert.equal(verify(f.opts).code,'REPLAYED')});
run('duplicate reference in another session is rejected',()=>{const f=fixture();assert.equal(verify(f.opts).ok,true);const other=fixture();other.opts.replayStore=f.opts.replayStore;assert.equal(verify(other.opts).code,'REPLAYED')});
console.log('UDEB contract tests: '+passed+'/'+passed+' PASS');
