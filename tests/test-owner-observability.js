'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createOwnerObservability,fixedN8nUrl}=require('../operations/owner-observability');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const now=Date.parse('2026-11-20T12:00:00.000Z');
function pool(){
 const sql=[];
 return {sql,async query(q){
  sql.push(String(q));
  if(q.includes('pg_stat_activity'))return {rows:[{connections:4,active:1,max_connections:100}]};
  if(q.includes('to_regclass'))return {rows:[{ready:true}]};
  if(q.includes('FROM disha_reconciliation_inbox'))return {rows:[{received:3,posted:2,quarantined:1,latest_at:new Date(now-10000)}]};
  if(q.includes('FROM disha_frontend_error_events'))return {rows:[{recent:2,last_at:now-20000}]};
  throw Error('Unexpected query '+q);
 }};
}
const calls=[];
const fetchImpl=async(u,o={})=>{
 const url=String(u);calls.push({url,headers:o.headers||{},method:o.method||'GET'});
 if(url.includes('/actions/runs'))return {ok:true,json:async()=>({workflow_runs:[{name:'DISHA 8.2 CI',status:'completed',conclusion:'success',created_at:'2026-11-20T10:00:00Z'}]})};
 if(url.includes('backboard.railway.com'))return {ok:true,json:async()=>({data:{deployments:{edges:[{node:{id:'d1',status:'SUCCESS',createdAt:'2026-11-20T08:00:00Z'}}]}}})};
 if(url.includes('api.cloudflare.com'))return {ok:true,json:async()=>({data:{viewer:{zones:[{groups:[{count:17,sum:{edgeResponseBytes:2187,visits:5}}]}]}}})};
 if(url.includes('/healthz/readiness'))return {ok:true,status:200};
 if(url.includes('/api/v1/executions'))return {ok:true,json:async()=>({data:[{status:'error',startedAt:'2026-11-20T07:00:00Z'},{status:'success',startedAt:'2026-11-20T07:10:00Z'}]})};
 throw Error('Unexpected network URL '+url);
};
(async()=>{
 assert.throws(()=>fixedN8nUrl('http://n8n.example.org'),/Invalid HTTPS/);
 assert.throws(()=>fixedN8nUrl('https://127.0.0.1'),/Invalid HTTPS/);
 assert.throws(()=>fixedN8nUrl('https://n8n.local'),/Invalid HTTPS/);
 assert.equal(fixedN8nUrl('https://flows.example.com').origin,'https://flows.example.com');
 const pg=pool();
 const empty=createOwnerObservability({getPool:()=>pg,fetchImpl,env:{},clock:()=>now});
 const p=await empty.get();
 assert.equal(p.services.postgres.status,'CONNECTED');
 assert.equal(p.services.postgres.metrics.connections,4);
 assert.equal(p.services.github.status,'CONNECTED','Public GitHub Actions can be checked without a token');
 assert.equal(p.services.railway.status,'NOT_CONFIGURED');
 assert.equal(p.services.cloudflare.status,'NOT_CONFIGURED');
 assert.equal(p.services.n8n.status,'NOT_CONFIGURED');
 assert.equal(p.services.webhooks.status,'PARTIAL','Inbound reconciliation must not be called outbound delivery');
 assert.equal(p.services.webhooks.metrics.quarantined24h,1);
 assert.equal(p.services.frontend.status,'CONNECTED');
 assert.equal(p.services.frontend.metrics.events24h,2);
 const again=await empty.get();
 assert.equal(again,p,'Read-only probes are bounded and cached for 45 seconds');
 const env={
  DISHA_MONITOR_RAILWAY_TOKEN:'railway-test-secret',
  DISHA_MONITOR_RAILWAY_PROJECT_ID:'test-project',
  DISHA_MONITOR_RAILWAY_SERVICE_ID:'test-service',
  DISHA_MONITOR_RAILWAY_ENVIRONMENT_ID:'test-env',
  DISHA_MONITOR_CLOUDFLARE_TOKEN:'cf-test-secret',
  DISHA_MONITOR_CLOUDFLARE_ZONE_ID:'a'.repeat(32),
  DISHA_MONITOR_N8N_URL:'https://flows.example.com',
  DISHA_MONITOR_N8N_API_KEY:'n8n-test-secret'
 };
 const ready=await createOwnerObservability({getPool:()=>pg,fetchImpl,env,clock:()=>now}).get();
 assert.equal(ready.services.railway.status,'CONNECTED');
 assert.equal(ready.services.railway.metrics.deploymentStatus,'SUCCESS');
 assert.equal(ready.services.cloudflare.status,'CONNECTED');
 assert.equal(ready.services.cloudflare.metrics.sampledRequests,17);
 assert.equal(ready.services.n8n.status,'CONNECTED');
 assert.equal(ready.services.n8n.metrics.failedRecent,1);
 assert.equal(ready.services.frontend.status,'CONNECTED');
 assert.ok(!JSON.stringify(ready).includes('railway-test-secret'),'Railway secret must never reach the browser');
 assert.ok(!JSON.stringify(ready).includes('cf-test-secret'),'Cloudflare token must never reach the browser');
 assert.ok(!JSON.stringify(ready).includes('n8n-test-secret'),'n8n token must never reach the browser');
 const noKey=await createOwnerObservability({getPool:()=>pg,fetchImpl,env:{DISHA_MONITOR_N8N_URL:'https://flows.example.com'},clock:()=>now}).n8n();
 assert.equal(noKey.status,'PARTIAL','Readiness alone does not prove workflow execution visibility');
 const offline=await createOwnerObservability({getPool:()=>null,fetchImpl:async()=>{throw Error('host down')},env:{
  DISHA_MONITOR_RAILWAY_TOKEN:'x',DISHA_MONITOR_RAILWAY_PROJECT_ID:'p',
  DISHA_MONITOR_RAILWAY_SERVICE_ID:'s',DISHA_MONITOR_RAILWAY_ENVIRONMENT_ID:'e'},clock:()=>now}).get();
 assert.equal(offline.services.postgres.status,'UNAVAILABLE');
 assert.equal(offline.services.railway.status,'UNAVAILABLE');
 assert.equal(offline.services.github.status,'UNAVAILABLE');
 assert.equal(offline.services.frontend.status,'UNAVAILABLE');
 const owner=read('public/owner-console.html'),client=read('public/platform-console.js');
 assert.ok(owner.includes('id="owner-infrastructure-connections"'));
 assert.ok(owner.includes('id="owner-integration-connections"'));
 assert.ok(!owner.includes('<b>Cloudflare edge analytics</b><span>Not connected</span>'),'Hardcoded connection badges removed');
 assert.ok(client.includes("api('/owner/observability')"));
 assert.ok(!client.includes("telemetry:{application:'NOT_CONNECTED'"));
 const backend=read('platform-control.js'),monitor=read('public/frontend-monitor.js');
 assert.ok(backend.includes("router.get('/owner/observability'"));
 assert.ok(backend.includes("router.post('/public/frontend-error'"));
 assert.ok(backend.includes("CREATE TABLE IF NOT EXISTS disha_frontend_error_events"));
 assert.ok(monitor.includes("'UNHANDLED_REJECTION'"));
 assert.ok(monitor.includes("'RESOURCE_ERROR'"));
 for(const forbidden of ['stack:','message:','location.search','upiUri','orderId','token:','userAgent']){
  assert.ok(!monitor.includes(forbidden),'Frontend reporter must not include sensitive input '+forbidden);
 }
 for(const dir of ['dist','disha-cinematic/public','disha-cinematic/dist']){
  assert.equal(read(dir+'/frontend-monitor.js'),monitor,'Frontend monitor must be mirrored');
 }
 assert.ok(calls.some(x=>x.url.includes('/api/v1/executions')),'Actual n8n workflow execution API must be queried');
 assert.ok(pg.sql.every(q=>!/\b(DELETE|DROP|TRUNCATE|UPDATE|INSERT)\b/i.test(q)),'Read-only monitoring probes must never mutate financial records');
 console.log('OWNER_OBSERVABILITY_PASS: live probes, privacy restrictions, missing states, UI and static parity');
})().catch(e=>{console.error(e);process.exitCode=1});
