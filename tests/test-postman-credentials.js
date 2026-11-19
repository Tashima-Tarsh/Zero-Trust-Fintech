'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','postman');
for(const file of ['DISHA_8.2_Local.postman_environment.json','DISHA_8.2_Production.postman_environment.json']){
 const e=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
 for(const item of e.values||[])if(['MERCHANT_EMAIL','MERCHANT_PASSWORD','PRIMARY_VPA'].includes(item.key))
  assert.equal(item.value,'','Postman must not ship identity/payment credentials: '+file+' '+item.key);
}
const runner=fs.readFileSync(path.join(root,'test-runner.js'),'utf8');
assert.match(runner,/DISHA_8.2_Local.postman_environment.json/);
assert.match(runner,/DISHA_ALLOW_PROD_POSTMAN/);
assert.ok(!fs.existsSync(path.join(__dirname,'..','disha-local.postman_environment.json')),'Remove obsolete sample-password environment');
assert.ok(!fs.existsSync(path.join(__dirname,'..','disha-api.postman_collection.json')),'Remove obsolete simulated-transaction collection');
console.log('POSTMAN_CREDENTIALS_PASS: no embedded merchant credentials; production test requires explicit opt-in');