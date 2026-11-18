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
assert.match(merchant,/DISHAOneTouchVault\.beginHandoff\(orderId,vaultSessionId,token\)/);
assert.match(merchant,/DISHAOneTouchVault\.submitReturnEvidence\(orderId\)/);
assert.match(checkout,/DISHAOneTouchVault\.beginHandoff\(currentSession\.orderId,vaultSessionId,currentSession\.sessionId\)/);
assert.match(checkout,/DISHAOneTouchVault\.submitReturnEvidence\(\)/);
assert.doesNotMatch(checkout,/finalizePayment\(orderId, txnRef/,
  'A URL status must not directly finalize settlement');
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
  v.beginHandoff(order,vault,token);
  assert.equal(v.getPendingOrderId(),order);
  assert.equal(await v.submitReturnEvidence(order),null,
    'No background or explicit app return: no observation should be submitted');
  assert.equal(calls.length,0);

  v.markBackgrounded(order);
  root.location.search='?orderId='+order+'&Status=SUCCESS&txnId=123456789012&am=500.01';
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

  root.location.search='';
  v.beginHandoff(order,vault,token);
  v.markBackgrounded(order);
  const noUtr=await v.submitReturnEvidence(order);
  assert.equal(noUtr.state,'RETURN_OBSERVED_NO_UTR');
  assert.equal(noUtr.utrCandidate,null);
  assert.equal(noUtr.verified,false);
  assert.equal(calls.length,3);
  console.log('VAULT_BROWSER_EVIDENCE_PASS: one-tap handoff, automatic observed return, UTR extraction, retry idempotency and no fake settlement.');
})().catch(e=>{console.error(e);process.exitCode=1});
