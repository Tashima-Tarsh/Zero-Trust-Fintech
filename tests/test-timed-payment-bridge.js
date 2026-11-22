'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),express=require('express');
const {createTimedPaymentRouter,expectedSession,makeTimedStore,initTimedStore,TTL_MS}=require('../financial/timed-payment-bridge');
const browser=require('../public/timed-payment-bridge');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const keys={testkey:publicKey.export({type:'spki',format:'pem'})};
const now=Date.now();
const session={orderId:'TEST_ORDER_902',sessionId:'a'.repeat(48),merchantType:'P2P',
 status:'PENDING',expiresAt:now+250000,challengeAmount:1.05,vpaAddress:'receiver@upi'};
const sign=(ref,override={})=>{
 const tezResponse=JSON.stringify({Status:'SUCCESS',responseCode:'00',txnRef:ref,
  amount:'1.05',toVpa:'receiver@upi',txnId:'TXNTEST123',...override});
 const digest=crypto.createHash('sha256').update(tezResponse).digest('hex');
 return {tezResponse,signature:crypto.sign('sha256',Buffer.from(digest),privateKey).toString('hex'),signatureKeyId:'testkey'};
};
function fakeStore(){
 const values=new Map(),transactions=new Set();
 return {
  async save(row){values.set(row.reference,{order_id:row.orderId,amount_rupees:row.amount,payee_vpa:row.pa,expires_ms:row.expiresAt,used_at:null})},
  async get(ref){return values.get(ref)||null},
  async consume({reference,orderId,txnId,now}){
   const row=values.get(reference),key='GOOGLE_PAY:'+txnId;
   if(!row||row.order_id!==orderId||row.used_at!==null||row.expires_ms<=now||transactions.has(key))
    return false;
   row.used_at=now;transactions.add(key);return true;
  }
 };
}
async function serverFor(store){
 const app=express();app.use(express.json());
 app.use('/api/upi-app-evidence/timed',createTimedPaymentRouter({
  store,getSession:async()=>session,getTrustedKeys:()=>keys,clock:()=>now
 }));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/api/upi-app-evidence/timed';
 const send=async(path,body)=>{
  const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 };
 return {server,send};
}
test('server preflight is authenticated, time bounded and amount/payee server-owned',async()=>{
 const {server,send}=await serverFor(fakeStore());
 try{
  const invalid=await send('/prepare',{orderId:session.orderId,token:'wrong'});
  assert.equal(invalid.status,401);
  const p=await send('/prepare',{orderId:session.orderId,token:session.sessionId,amount:'999.00',pa:'attacker@upi'});
  assert.equal(p.status,200);assert.equal(p.body.state,'CHALLENGE_PREPARED');
  assert.match(p.body.transactionRef,/^[0-9a-f]{32}$/);
  assert.ok(p.body.expiresAt<=now+TTL_MS);
  assert.equal(p.body.paymentRequest.methods[0].data.pa,session.vpaAddress);
  assert.equal(p.body.paymentRequest.methods[0].data.tr,p.body.transactionRef);
  assert.equal(p.body.paymentRequest.details.total.amount.value,'1.05');
  assert.equal(p.body.debitVerified,false);
 }finally{server.close()}
});
test('server accepts signed provider success once, never a verified debit',async()=>{
 const {server,send}=await serverFor(fakeStore());
 try{
  const p=(await send('/prepare',{orderId:session.orderId,token:session.sessionId})).body;
  const body={orderId:session.orderId,token:session.sessionId,
   transactionRef:p.transactionRef,methodName:browser.METHOD,details:sign(p.transactionRef)};
  const results=await Promise.all([send('/accept',body),send('/accept',body)]);
  assert.equal(results.filter(x=>x.status===200).length,1);
  const ok=results.find(x=>x.status===200).body;
  assert.equal(ok.state,'PROVIDER_REPORTED_SUCCESS');
  assert.equal(ok.signatureVerified,true);assert.equal(ok.debitVerified,false);
  assert.equal(ok.paymentVerified,false);assert.equal(ok.paymentStateChanged,false);
 }finally{server.close()}
});
test('wrong checkout, tamper and reused txn id are rejected',async()=>{
 const {server,send}=await serverFor(fakeStore());
 try{
  const prep=()=>send('/prepare',{orderId:session.orderId,token:session.sessionId});
  const p=(await prep()).body;
  const common={orderId:session.orderId,token:session.sessionId,transactionRef:p.transactionRef,
   methodName:browser.METHOD,details:sign(p.transactionRef)};
  assert.equal((await send('/accept',{...common,orderId:'WRONG_ORDER_902'})).status,401);
  const tampered=await send('/accept',{...common,details:{...common.details,signature:'ff'.repeat(72)}});
  assert.equal(tampered.status,422);
  const failedCode=await send('/accept',{...common,details:sign(p.transactionRef,{Status:'SUCCESS',responseCode:'ZM'})});
  assert.equal(failedCode.status,422);
  assert.equal(failedCode.body.debitVerified,false);
  const wrongAmount=await send('/accept',{...common,details:sign(p.transactionRef,{amount:'2.00'})});
  assert.equal(wrongAmount.status,422);
  const wrongRef=await send('/accept',{...common,details:sign('differentRef')});
  assert.equal(wrongRef.status,422);
  assert.equal((await send('/accept',common)).status,200);
  const second=(await prep()).body;
  const reuse=await send('/accept',{...common,transactionRef:second.transactionRef,details:sign(second.transactionRef)});
  assert.equal(reuse.status,409);
  assert.equal(reuse.body.debitVerified,false);
 }finally{server.close()}
});
test('source session ID must match requested order and expiry',()=>{
 assert.equal(expectedSession({...session,orderId:'ANOTHER_ORDER_902'},session.orderId,session.sessionId,now).error,'SESSION_AUTH_REQUIRED');
 assert.equal(expectedSession({...session,expiresAt:now},session.orderId,session.sessionId,now).error,'SESSION_NOT_ACTIVE');
});
test('Postgres store uses FOR UPDATE lock and globally unique provider txn replay insert',async()=>{
 const statements=[],client={
  async query(sql,args){statements.push(sql);if(sql.includes('SELECT order_id'))return {rows:[{order_id:session.orderId,expires_ms:now+120000,used_at:null}]};
   if(sql.includes('INSERT INTO disha_upi_app_evidence_replay'))return {rowCount:1};return {rowCount:1}},
  release(){statements.push('RELEASE')}
 };
 const pool={query:async sql=>{statements.push(sql);return {rows:[]}},connect:async()=>client};
 const store=makeTimedStore(()=>pool);
 await initTimedStore(pool);
 await store.save({reference:'f'.repeat(32),orderId:session.orderId,expiresAt:now+120000});
 assert.equal(await store.consume({reference:'f'.repeat(32),orderId:session.orderId,txnId:'TXNTEST123',now}),true);
 assert.ok(statements.some(s=>s.includes('FOR UPDATE')));
 assert.ok(statements.some(s=>s.includes('ON CONFLICT (fingerprint) DO NOTHING')));
 assert.ok(statements.includes('COMMIT'));
});
test('browser creates PaymentRequest during prepare and starts show on pay action',async()=>{
 let shown=0,completed=0,posted=[];
 const prepared={transactionRef:'a'.repeat(32),expiresAt:now+90000,
  paymentRequest:{methods:[{supportedMethods:browser.METHOD,data:{pa:'receiver@upi',tr:'a'.repeat(32)}}],
  details:{total:{label:'DISHA',amount:{currency:'INR',value:'1.05'}}}}};
 class FakePaymentRequest{
  async canMakePayment(){return true}
  async show(){shown++;return {methodName:browser.METHOD,details:{tezResponse:'x',signature:'y',signatureKeyId:'z'},
   complete:async()=>{completed++}}}
 }
 const adapter=browser.create({
  PaymentRequestClass:FakePaymentRequest,clock:()=>now,
  fetchImpl:async(url,opt)=>{posted.push({url,body:JSON.parse(opt.body)});return {
   ok:true,json:async()=>url.endsWith('/prepare')?prepared:{state:'PROVIDER_REPORTED_SUCCESS',debitVerified:false}}}
 });
 const checkout=await adapter.prepare({orderId:session.orderId,token:session.sessionId});
 assert.equal(shown,0);
 const result=await checkout.pay();
 assert.equal(shown,1);assert.equal(completed,1);assert.equal(posted[1].body.details.signature,'y');
 assert.equal(result.debitVerified,false);
 await assert.rejects(()=>checkout.pay(),/ALREADY_USED/);
});
