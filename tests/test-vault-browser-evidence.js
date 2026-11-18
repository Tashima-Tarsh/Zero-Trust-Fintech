'use strict';
// Browser contract: one Vault authorization, no manual UTR, automatic evidence
// submission on observable return, no invented success from external UPI app.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../public/one-touch-vault.js'),'utf8');
const merchant=fs.readFileSync(path.join(__dirname,'../public/merchant-checkout.html'),'utf8');
const checkout=fs.readFileSync(path.join(__dirname,'../public/checkout.html'),'utf8');
const cosmic=fs.readFileSync(path.join(__dirname,'../public/cosmic-checkout.js'),'utf8');
assert.match(cosmic,/vault\.beginHandoff\(orderId\(\),vaultSessionId,session\.token,chosen\)/);
assert.match(cosmic,/const packet=vault\.requestEvidence\(orderId\(\)\)/);
assert.match(cosmic,/vault\.acknowledgeEvidence\(orderId\(\),packet\.eventId,result\)/);
for(const page of [cosmic]){
 assert.match(page,/fetch\('\/api\/vault\/evidence'/);
 assert.ok(page.indexOf('vault.requestEvidence(')<page.indexOf("fetch('/api/vault/evidence'"),
 'Browser must request evidence before transmitting');
 assert.ok(page.indexOf("fetch('/api/vault/evidence'")<page.indexOf('vault.acknowledgeEvidence('),
 'Browser must acknowledge only after server storage');
}
assert.doesNotMatch(cosmic,/finalizePayment\(orderId, txnRef/,
 'Browser return can never finalize a financial transfer');
(async()=>{
  const memory=new Map();
  const calls=[];
  let failFirst=false;
  const sessionStorage={
    getItem:k=>memory.get(k)||null,
    setItem:(k,v)=>memory.set(k,v),
    removeItem:k=>memory.delete(k)
  };
  const root={
    crypto:{randomUUID:()=> 'cccccccc-eeee-4444-aaaa-bbbbbbbbbbbb',
      getRandomValues:bytes=>{bytes.fill(9);return bytes}},
    location:{search:'',hash:'',assign:()=>{}}
  };
  const fetch=async(path,options)=>{
    assert.equal(path,'/api/vault/evidence');
    const parsed=JSON.parse(options.body);
    assert.equal(options.headers['X-CSRF-Token'],parsed.token);
    assert.equal(parsed.orderId,'ORD_TEST_1234');
    assert.equal(parsed.vaultSessionId,'a'.repeat(32));
    calls.push(parsed);
    if(failFirst){failFirst=false;throw Error('Network temporarily down');}
    const utr=parsed.evidence.returnParams.txnId||null;
    return {ok:true,status:202,json:async()=>({
      success:true,state:utr?'UTR_CANDIDATE_UNVERIFIED':'RETURN_OBSERVED_NO_UTR',
      utrCandidate:utr,verified:false,settled:false
    })};
  };
  const document={visibilityState:'visible'};
  vm.runInNewContext(script,{window:root,sessionStorage,document,fetch,
    URLSearchParams,Uint8Array,Date,console});
  const v=root.DISHAOneTouchVault;
  const order='ORD_TEST_1234',vault='a'.repeat(32),token='b'.repeat(48);
  v.beginHandoff(order,vault,token,'gpay');
  assert.equal(v.getPendingOrderId(),order);
  assert.equal(await v.submitReturnEvidence(order),null,
    'No background or explicit app return: no observation should be submitted');
  assert.equal(calls.length,0);

  v.markBackgrounded(order);
  root.location.search='?orderId='+order+'&Status=SUCCESS&txnId=123456789012&am=500.01';
  const vaultPacket=v.requestEvidence(order);
  assert.equal(vaultPacket.orderId,order);
  assert.equal(vaultPacket.vaultSessionId,vault);
  assert.equal(vaultPacket.token,token);
  assert.equal(vaultPacket.evidence.returnParams.txnId,'123456789012');
  assert.equal(vaultPacket.evidence.returnParams.Status,'SUCCESS');
  assert.equal(vaultPacket.evidence.browserEvent,'RETURN_QUERY_OBSERVED');
  assert.equal(vaultPacket.evidence.selectedApp,'gpay');
  assert.deepEqual(JSON.parse(JSON.stringify(v.requestEvidence(order))),
    JSON.parse(JSON.stringify(vaultPacket)),'Repeated Vault requests yield the same event');
  await assert.rejects(async()=>v.acknowledgeEvidence(order,'incorrect',{success:true,state:'UTR_CANDIDATE_UNVERIFIED'}),
    /does not match/);
  await assert.rejects(async()=>v.acknowledgeEvidence(order,vaultPacket.eventId,
    {success:true,state:'VERIFIED',verified:true}),/acknowledgment is invalid/);
  failFirst=true;
  await assert.rejects(v.submitReturnEvidence(order),/Network temporarily down/);
  assert.equal(calls.length,1);
  const attempt=memory.get('disha82:vault-evidence:'+order);
  assert.ok(attempt.includes('123456789012'));
  const result=await v.submitReturnEvidence(order);
  assert.equal(result.verified,false);
  assert.equal(result.settled,false);
  assert.equal(result.utrCandidate,'123456789012');
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1],'Network retries use frozen event ID and evidence payload');
  await v.submitReturnEvidence(order);
  assert.equal(calls.length,2,'Receipt suppresses duplicate HTTP posts');
  assert.equal(v.requestEvidence(order),null,'Acknowledged evidence cannot be sent again');
  assert.equal(JSON.parse(memory.get('disha82:vault-evidence:'+order)).token,undefined,
    'Checkout token must be erased from handoff store after acknowledgment');

  root.location.search='';
  v.beginHandoff(order,vault,token);
  v.markBackgrounded(order);
  const noUtr=await v.submitReturnEvidence(order);
  assert.equal(noUtr.state,'RETURN_OBSERVED_NO_UTR');
  assert.equal(noUtr.utrCandidate,null);
  assert.equal(noUtr.verified,false);
  assert.equal(calls.length,3);
  // Direct browser acknowledgment path, without invoking legacy submit helper.
  v.beginHandoff(order,vault,token);
  v.markBackgrounded(order);
  const browserReceived=v.requestEvidence(order);
  const directReceipt=v.acknowledgeEvidence(order,browserReceived.eventId,
    {success:true,state:'RETURN_OBSERVED_NO_UTR',utrCandidate:null});
  assert.equal(directReceipt.state,'RETURN_OBSERVED_NO_UTR');
  assert.equal(directReceipt.verified,false);
  assert.equal(v.requestEvidence(order),null);
  v.beginHandoff(order,vault,token,'phonepe');
  const unresolved=v.markIntentFallback(order);
  assert.equal(unresolved.evidence.browserEvent,'INTENT_FALLBACK');
  assert.equal(unresolved.evidence.selectedApp,'phonepe');
  assert.equal(unresolved.evidence.returnParams.txnId,undefined);
  const ack=v.acknowledgeEvidence(order,unresolved.eventId,
    {success:true,state:'INTENT_LAUNCH_UNRESOLVED',utrCandidate:null});
  assert.equal(ack.verified,false);
  assert.equal(ack.settled,false);
  const {validatePacket,classify}=require('../financial/vault-evidence');
  const received=validatePacket({orderId:order,vaultSessionId:vault,token,
    eventId:unresolved.eventId,evidence:unresolved.evidence});
  const current=Date.now();
  const classified=classify({created_at:current-20000,expires_at:current+120000,
    challenge_amount:1,vpa_address:'receiver@oksbi',txn_ref:'TXN_OK',order_id:order},
    received,null,current);
  assert.equal(classified.outcome,'INTENT_LAUNCH_UNRESOLVED');
  assert.equal(classified.utrCandidate,null);
  assert.equal(classified.correlation.intentLaunchFallbackObserved,true);
  assert.throws(()=>validatePacket({orderId:order,vaultSessionId:vault,token,
    eventId:unresolved.eventId,evidence:{...unresolved.evidence,returnParams:{txnId:'123456789012'}}}),
    /FALLBACK_CANNOT_CARRY_PAYMENT_RESULT/);
  console.log('VAULT_BROWSER_EVIDENCE_PASS: one-tap handoff, automatic observed return, UTR extraction, retry idempotency and no fake settlement.');
})().catch(e=>{console.error(e);process.exitCode=1});
