'use strict';
/* Quantum Signal unit contract: per-order immutable intent, no invented UTR,
 * no bank/gateway API, and fail-closed YES/NO/UNKNOWN classification. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const {snapshot,classify,returnFields}=require('../financial/quantum-signal');
const source=fs.readFileSync(path.join(root,'public','quantum-signal-client.js'),'utf8');
const checkout=fs.readFileSync(path.join(root,'public','cosmic-checkout.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
new vm.Script(source);
new vm.Script(checkout);
assert.match(server,/app\.use\('\/api\/quantum-signal',createQuantumSignalRouter/);
assert.match(server,/await initializeQuantumSignal\(db\.pgPool\)/);
assert.match(checkout,/quantumEnabled=query\.get\('qs'\)==='1'/);
assert.match(checkout,/quantumClient\.authorizeAndStart\(session\)/);
assert.match(checkout,/quantumClient\.handoff\(session,/);
assert.match(checkout,/quantumClient\.returned\(session\)/);
const personal=snapshot({challenge_amount:'1.00',vpa_address:'personal@oksbi',
 txn_ref:'PAYTEST',upi_uri:'upi://pay?pa=personal%40oksbi&am=1.00&cu=INR'});
assert.equal(personal.kind,'P2P');
assert.equal(personal.amountPaise,'100');
const merchant=snapshot({challenge_amount:'1.00',vpa_address:'shop@ypbiz',
 txn_ref:'PAYTEST',upi_uri:'upi://pay?pa=shop%40ypbiz&am=1.00&cu=INR&mc=5411&tr=PAYTEST'});
assert.equal(merchant.kind,'P2M');
assert.equal(merchant.txnRef,'PAYTEST');
assert.throws(()=>snapshot({challenge_amount:'1.00',vpa_address:'personal@oksbi',
 upi_uri:'upi://pay?pa=attacker%40oksbi&am=1.00'}),/IMMUTABLE_INTENT_MISMATCH/);
assert.deepEqual(returnFields({txnId:'123456789012'}),{txnId:'123456789012'});
assert.throws(()=>returnFields({success:true}),/INVALID_RETURN_FIELDS/);
const twin={amount_paise:'100',payee_vpa:'shop@ypbiz',txn_ref:'PAYTEST',expires_at:Date.now()+90000};
const result=(fields,other=null,time=Date.now())=>classify(twin,'RETURN',fields,time,other);
let c=result({Status:'SUCCESS',txnId:'123456789012',am:'1.00',pa:'shop@ypbiz',tr:'PAYTEST'});
assert.equal(c.state,'UTR_CANDIDATE_UNVERIFIED');
assert.equal(c.decision,'UNKNOWN','Browser status and random UTR cannot auto-complete payment');
assert.equal(c.correlation.paymentResultAuthenticated,false);
assert.equal(result({txnId:'123456789012',am:'2.00'}).decision,'NO');
assert.equal(result({txnId:'123456789012',pa:'friend@upi'}).state,'CONFLICTING_EVIDENCE');
assert.equal(result({txnId:'123456789012'},'OTHER_ORDER').correlation.utrReusedOnOtherOrder,true);
assert.equal(result({}).state,'RETURN_OBSERVED_NO_UTR');
assert.equal(result({txnId:'123456789012'},null,twin.expires_at+100).state,'LATE_RETURN_OBSERVATION');
(async()=>{
 const memory=new Map(),events=[],calls=[];
 const order={orderId:'PAY_TEST_1234',token:'a'.repeat(32)};
 let nextByte=5;
 const fake={crypto:{getRandomValues(b){b.fill(nextByte++);return b}},location:{search:'?Status=SUCCESS&txnId=123456789012&am=1.00',hash:''},
  DISHAOneTouchVault:{authorize:async()=>({sessionId:'b'.repeat(32)}),
   beginHandoff(...a){calls.push(['handoff',...a])},markBackgrounded(){calls.push(['background'])},
   submitReturnEvidence:async()=>({state:'UTR_CANDIDATE_UNVERIFIED'})}};
 const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 const fetch=async(url,options)=>{
  if(String(url).endsWith('/start'))return {ok:true,json:async()=>({success:true,nonce:'c'.repeat(40),
   expiresAt:Date.now()+30000,paymentType:'P2P'})};
  if(String(url).endsWith('/event')){
   const ev=JSON.parse(options.body);events.push(ev);
   return {ok:true,json:async()=>({success:true,eventState:'UTR_CANDIDATE_UNVERIFIED',decision:'UNKNOWN'})};
  }
  return {ok:true,json:async()=>({success:true,decision:'UNKNOWN'})};
 };
 vm.runInNewContext(source,{window:fake,sessionStorage:storage,Uint8Array,URLSearchParams,fetch,Date});
 const qs=fake.DISHAQuantumSignalClient;
 assert.equal(qs.restore(order),false);
 await qs.authorizeAndStart(order);
 assert.equal(qs.restore(order),true);
 qs.handoff(order,'gpay');
 qs.background(order);
 await qs.returned(order);
 await Promise.resolve();await Promise.resolve();
 assert.equal(events.some(e=>e.eventKind==='HANDOFF'),true);
 assert.equal(events.some(e=>e.eventKind==='BACKGROUND'),true);
 const observed=events.find(e=>e.eventKind==='RETURN');
 assert.equal(observed.returnParams.txnId,'123456789012');
 assert.equal(events.every(e=>e.token===order.token),true);
 assert.equal(await qs.returned(order),null,'Duplicate focus cannot fabricate another return');
 console.log('QUANTUM_SIGNAL_PASS: immutable order, two modes, Vault, nonce, no fake credit, return and replay gating');
})().catch(e=>{console.error(e);process.exitCode=1});
