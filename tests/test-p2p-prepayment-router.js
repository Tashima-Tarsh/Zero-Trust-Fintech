'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createP2pPrepaymentRouter}=require('../financial/p2p-prepayment-router');
const now=1_700_000_000_000,token='a'.repeat(48),orderId='P2P_ORDER_TEST_1',vaultId='b'.repeat(32);
const session={sessionId:token,orderId,expiresAt:now+120000,status:'PENDING',merchantType:'P2P'};
const vault={orderId,status:'VAULT_VERIFIED_AWAITING_UPI',verifiedAt:now-1000,expiresAt:now+90000};
const trusted={trustSource:'SERVER_VERIFIED_ATTESTATION',orderId,integrityVerdict:'MEETS_DEVICE_INTEGRITY',debuggerRiskVerdict:'NO_DEBUGGER_DETECTED',verifiedAt:now-1000};
async function withServer(deps,fn){
 const app=express();app.use(express.json());app.use('/api/p2p/prepayment',createP2pPrepaymentRouter({
  getSession:async()=>session,getVaultChallenge:async()=>vault,
  getVerifiedDeviceAttestation:async()=>null,clock:()=>now,...deps}));
 const listener=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>listener.listening?resolve():listener.once('listening',resolve));
 const send=async(body={},header=token)=>{
  const res=await fetch('http://127.0.0.1:'+listener.address().port+'/api/p2p/prepayment/authorize',{
   method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':header},
   body:JSON.stringify({orderId,token,vaultSessionId:vaultId,...body})});
  return {code:res.status,data:await res.json()};
 };
 try{await fn(send)}finally{await new Promise(resolve=>listener.close(resolve))}
}
test('server rejects device claim from browser even with signed WebAuthn session',async()=>{
 await withServer({},async send=>{
  const r=await send({device:{...trusted},rooted:false,debugger:false});
  assert.equal(r.code,403);
  assert.equal(r.data.authorized,false);
  assert.ok(r.data.reasons.includes('DEVICE_INTEGRITY_NOT_VERIFIED'));
  assert.ok(r.data.reasons.includes('DEBUGGER_RISK_NOT_VERIFIED'));
  assert.equal(r.data.debitVerified,false);
 });
});
test('wrong checkout token or missing CSRF token rejects before trust evaluation',async()=>{
 await withServer({},async send=>{
  assert.equal((await send({token:'c'.repeat(48)},'c'.repeat(48))).code,401);
  assert.equal((await send({},'wrong')).code,403);
 });
});
test('server requires matching recent WebAuthn challenge',async()=>{
 await withServer({getVaultChallenge:async()=>({...vault,orderId:'WRONG_ORDER'}),
  getVerifiedDeviceAttestation:async()=>trusted},async send=>{
   const r=await send();
   assert.equal(r.code,403);
   assert.ok(r.data.reasons.includes('PAYER_USER_VERIFICATION_REQUIRED'));
  });
});
test('trusted server-side attestation and valid payer unlock session without financial mutation',async()=>{
 await withServer({getVerifiedDeviceAttestation:async()=>trusted},async send=>{
  const r=await send();
  assert.equal(r.code,200);
  assert.equal(r.data.authorized,true);
  assert.equal(r.data.expiresAt,now+90000);
  assert.equal(r.data.debitVerified,false);
  assert.equal(r.data.paymentVerified,false);
 });
});
test('missing database or attestation infrastructure fails closed',async()=>{
 await withServer({getSession:async()=>{throw Error('DATABASE_DOWN')}},async send=>{
  const r=await send();assert.equal(r.code,503);assert.equal(r.data.authorized,false)
 });
});
