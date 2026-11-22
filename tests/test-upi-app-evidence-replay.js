'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fingerprint,makeReplayGuard,initUpiAppEvidenceReplay}=require('../financial/upi-app-evidence-replay');
test('same transaction fingerprint is stable but differs on provider, transaction id or ref',()=>{
 const a=fingerprint('GOOGLE_PAY','TXN-1','ORDER1');
 assert.match(a,/^[a-f0-9]{64}$/);
 assert.equal(fingerprint('GOOGLE_PAY','TXN-1','ORDER1'),a);
 assert.notEqual(fingerprint('GOOGLE_PAY','TXN-2','ORDER1'),a);
 assert.notEqual(fingerprint('PHONEPE','TXN-1','ORDER1'),a);
 assert.notEqual(fingerprint('GOOGLE_PAY','TXN-1','ORDER2'),a);
});
test('atomic duplicate guard returns false for repeated provider transaction',async()=>{
 const seen=new Set();
 const db={async query(sql,values){
  assert.match(sql,/ON CONFLICT \(fingerprint\) DO NOTHING/);
  const before=seen.size;seen.add(values[0]);
  return {rowCount:seen.size>before?1:0};
 }};
 const consume=makeReplayGuard(()=>db);
 const p={provider:'GOOGLE_PAY',txnId:'TXN-1',txnRef:'ORDER1',orderId:'CHECKOUT_1'};
 assert.equal(await consume(p),true);
 assert.equal(await consume(p),false);
 assert.equal(await consume({...p,orderId:'CHECKOUT_2'}),false);
});
test('concurrent inserts delegate duplicate exclusion to PostgreSQL unique constraint',async()=>{
 const seen=new Set();
 const consume=makeReplayGuard(()=>({async query(_sql,values){
  await Promise.resolve();
  const fresh=!seen.has(values[0]);seen.add(values[0]);
  return {rowCount:fresh?1:0};
 }}));
 const p={provider:'GOOGLE_PAY',txnId:'TXN-1',txnRef:'ORDER1',orderId:'CHECKOUT_1'};
 const results=await Promise.all(Array.from({length:10},()=>consume(p)));
 assert.equal(results.filter(Boolean).length,1);
});
test('missing database fails closed, no in-memory positive fallback',async()=>{
 const consume=makeReplayGuard(()=>null);
 await assert.rejects(()=>consume({provider:'GOOGLE_PAY',txnId:'TXN-1',txnRef:'ORDER1',orderId:'CHECKOUT_1'}),/UNAVAILABLE/);
});
test('initialization creates unique fingerprint key',async()=>{
 const statements=[];
 assert.equal(await initUpiAppEvidenceReplay({async query(sql){statements.push(sql)}}),true);
 assert.match(statements[0],/fingerprint TEXT PRIMARY KEY/);
 assert.equal(await initUpiAppEvidenceReplay(null),false);
});
