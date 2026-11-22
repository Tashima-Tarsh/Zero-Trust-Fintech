'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createDebitCredentialRouter}=require('../financial/debit-credential');
const token='a'.repeat(48),order='SERVICE_UNSIGNED_BROWSER_123';
const session={sessionId:token,merchantType:'P2P',status:'PENDING',
 expiresAt:Date.now()+120000,challengeAmount:'1.00',vpaAddress:'seller@oksbi'};
let stored=null;
const query=async(sql,values=[])=>{
 if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
 if(sql.includes('SELECT * FROM disha_debit_credential_challenges'))
  return {rows:stored?[stored]:[]};
 if(sql.includes('SELECT 1 FROM disha_debit_credential_claims'))
  return {rows:[]};
 if(sql.startsWith('INSERT INTO disha_debit_credential_challenges')){
  const [service_request_id,token_hash,challenge,amount_paise,payee_vpa,created_at,expires_at]=values;
  stored={service_request_id,token_hash,challenge,amount_paise,payee_vpa,created_at,expires_at};
  return {rows:[]};
 }
 throw Error('Unexpected SQL: '+sql);
};
const pool={query,connect:async()=>({query,release(){}})};
const app=express();app.use(express.json());app.use('/api/debit-credential',
 createDebitCredentialRouter({getPool:()=>pool,getSession:async id=>id===order?session:null}));
const server=app.listen(0,'127.0.0.1');
(async()=>{
 try {
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/debit-credential/challenge';
  const response=await fetch(url,{method:'POST',headers:{
   'content-type':'application/json','x-csrf-token':token,'x-forwarded-host':'attacker.example'},
   body:JSON.stringify({serviceRequestId:order,token})});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.protocol,'openid4vp-v1-unsigned');
  assert.equal(body.request.response_type,'vp_token');
  assert.equal(body.request.response_mode,'dc_api');
  assert.equal(body.request.nonce,stored.challenge);
  assert.match(body.request.nonce,/^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(body.request,'client_id'),false,
   'Unsigned browser API must own caller origin, never derive from Host');
  const dcql=body.request.dcql_query.credentials;
  assert.equal(dcql.length,1);
  assert.equal(dcql[0].format,'dc+sd-jwt');
  assert.deepEqual(dcql[0].meta.vct_values,
   ['https://disha8-2.thenitishkr.in/credentials/upi-debit-v1']);
  assert.deepEqual(dcql[0].claims.map(c=>c.path[0]),
   ['utr','debitConfirmed','amountPaise','payeeVpa']);
  const bad=await fetch(url,{method:'POST',headers:{
   'content-type':'application/json','x-csrf-token':'b'.repeat(48)},
   body:JSON.stringify({serviceRequestId:order,token})});
  assert.equal(bad.status,403);
  console.log('UNSIGNED_OPENID4VP_CHALLENGE_PASS: protocol, VCT, nonce, CSRF, browser-owned origin');
 }finally{server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
