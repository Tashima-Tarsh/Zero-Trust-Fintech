'use strict';
/* Owner-only READ-ONLY operational probes. Never infer settlement from service health.
 * External credentials stay exclusively in server environment variables.
 * All probes have bounded deadlines and return only allowlisted aggregate fields.
 */
const state=(status,detail,metrics={})=>({status,detail,metrics,checkedAt:new Date().toISOString()});
const notConfigured=detail=>state('NOT_CONFIGURED',detail);
const unavailable=detail=>state('UNAVAILABLE',detail);
const connected=(detail,metrics={})=>state('CONNECTED',detail,metrics);
const partial=(detail,metrics={})=>state('PARTIAL',detail,metrics);
const bad=message=>{throw Error(message)};
const fetchJson=async(fetchImpl,url,options={})=>{
 const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(4500),redirect:'error'});
 if(!response||!response.ok)bad('Provider HTTP '+(response?.status||'unavailable'));
 const payload=await response.json();
 if(payload?.errors?.length||payload?.success===false)bad('Provider rejected the telemetry query');
 return payload;
};
function fixedN8nUrl(input){
 const url=new URL(String(input||''));
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||
    host.endsWith('.localhost')||host.endsWith('.test')||host.includes(':')||
    /^\d+(?:\.\d+){3}$/.test(host)||!host.includes('.'))bad('Invalid HTTPS n8n monitoring host');
 url.pathname='/';return url;
}
function createOwnerObservability({getPool,fetchImpl=globalThis.fetch,env=process.env,clock=()=>Date.now()}){
 let cache=null,until=0,inFlight=null;
 async function postgres(){
  const pool=getPool();
  if(!pool)return unavailable('PostgreSQL pool unavailable');
  const start=clock();
  try{
   const result=await pool.query("SELECT current_setting('max_connections')::int AS max_connections,"+
     "(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,"+
     "(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS active");
   const row=result.rows?.[0];
   if(!row)throw Error('No database response');
   return connected('Read-only PostgreSQL connection check succeeded',{
    latencyMs:Math.max(0,clock()-start),connections:Number(row.connections),active:Number(row.active),maxConnections:Number(row.max_connections)});
  }catch(_){return unavailable('PostgreSQL operational query failed')}
 }
 async function github(){
  const name=env.DISHA_MONITOR_GITHUB_REPO||'Tashima-Tarsh/Zero-Trust-Fintech';
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name))return unavailable('Invalid configured GitHub repository');
  try{
   const headers={'Accept':'application/vnd.github+json','User-Agent':'DISHA-owner-observability','X-GitHub-Api-Version':'2022-11-28'};
   if(env.DISHA_MONITOR_GITHUB_TOKEN)headers.Authorization='Bearer '+env.DISHA_MONITOR_GITHUB_TOKEN;
   const body=await fetchJson(fetchImpl,'https://api.github.com/repos/'+name+'/actions/runs?branch=main&per_page=8',{headers});
   const list=Array.isArray(body.workflow_runs)?body.workflow_runs:[];
   if(!list.length)return partial('GitHub API responded; no main-branch runs are visible');
   const latest=list[0];const finished=list.find(x=>x.status==='completed');
   return connected('GitHub Actions API connected; status is for CI, not the live deployment',{
    latestWorkflow:String(latest.name||'').slice(0,80),
    latestStatus:String(latest.status||'unknown').slice(0,30),
    latestConclusion:String(latest.conclusion||'pending').slice(0,30),
    lastCompletedConclusion:String(finished?.conclusion||'none').slice(0,30),
    lastRunAt:String(latest.created_at||'').slice(0,35),
    failedRecent:list.filter(x=>x.conclusion==='failure').length
   });
  }catch(_){return unavailable('GitHub Actions API could not be reached or authorized')}
 }
 async function railway(){
  const token=env.DISHA_MONITOR_RAILWAY_TOKEN;
  const project=env.DISHA_MONITOR_RAILWAY_PROJECT_ID,service=env.DISHA_MONITOR_RAILWAY_SERVICE_ID,environment=env.DISHA_MONITOR_RAILWAY_ENVIRONMENT_ID;
  if(!token||!project||!service||!environment)return notConfigured('Set DISHA_MONITOR_RAILWAY_TOKEN, PROJECT_ID, SERVICE_ID and ENVIRONMENT_ID for the DISHA Railway service');
  try{
   const query='query DISHADeployments($input: DeploymentListInput!) { deployments(input:$input,first:4) { edges { node { id status createdAt } } } }';
   const body=await fetchJson(fetchImpl,'https://backboard.railway.com/graphql/v2',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({query,variables:{input:{projectId:project,serviceId:service,environmentId:environment}}})});
   const rows=body.data?.deployments?.edges?.map(x=>x.node)||[];
   if(!rows.length)return partial('Railway connected but no deployment returned for the configured DISHA service');
   return connected('Railway deployment metadata retrieved',{deploymentStatus:String(rows[0].status||'UNKNOWN'),
    deployedAt:String(rows[0].createdAt||''),recentDeployments:rows.length});
  }catch(_){return unavailable('Railway deployment API check failed; verify DISHA service IDs and token permissions')}
 }
 async function cloudflare(){
  const token=env.DISHA_MONITOR_CLOUDFLARE_TOKEN,zone=env.DISHA_MONITOR_CLOUDFLARE_ZONE_ID;
  if(!token||!zone)return notConfigured('Set DISHA_MONITOR_CLOUDFLARE_TOKEN and ZONE_ID (read-only GraphQL Analytics)');
  if(!/^[a-f0-9]{32}$/i.test(zone))return unavailable('Cloudflare Zone ID is invalid');
  try{
   const end=new Date(clock()).toISOString(),start=new Date(clock()-3600000).toISOString();
   const query='query DISHAEdge($zoneTag: string,$start: Time,$end: Time){viewer{zones(filter:{zoneTag:$zoneTag}){groups:httpRequestsAdaptiveGroups(limit:1,filter:{datetime_geq:$start,datetime_lt:$end,requestSource:"eyeball"}){count sum{edgeResponseBytes visits}}}}}';
   const body=await fetchJson(fetchImpl,'https://api.cloudflare.com/client/v4/graphql',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({query,variables:{zoneTag:zone,start,end}})});
   const zones=body.data?.viewer?.zones;
   if(!Array.isArray(zones)||!zones.length)return unavailable('Cloudflare zone was not returned for this token');
   const groups=zones[0].groups||[];
   const count=groups.reduce((a,x)=>a+Number(x.count||0),0);
   const bytes=groups.reduce((a,x)=>a+Number(x.sum?.edgeResponseBytes||0),0);
   return connected('Cloudflare sampled HTTP request metrics (last hour)',{sampledRequests:count,edgeResponseBytes:bytes,windowMinutes:60});
  }catch(_){return unavailable('Cloudflare GraphQL Analytics query failed or permission unavailable')}
 }
 async function n8n(){
  if(!env.DISHA_MONITOR_N8N_URL)return notConfigured('Set DISHA_MONITOR_N8N_URL to the deployed n8n HTTPS origin');
  let origin;
  try{origin=fixedN8nUrl(env.DISHA_MONITOR_N8N_URL)}catch(_){return unavailable('n8n monitoring URL must be a public HTTPS hostname')}
  try{
   const readiness=await fetchImpl(new URL('/healthz/readiness',origin),{signal:AbortSignal.timeout(4500),redirect:'error'});
   if(!readiness?.ok)return unavailable('n8n readiness probe failed (including its database readiness)');
   if(!env.DISHA_MONITOR_N8N_API_KEY)return partial('n8n readiness healthy; API key needed for workflow execution monitoring');
   try{
    const result=await fetchJson(fetchImpl,new URL('/api/v1/executions?limit=20',origin),{
      headers:{'X-N8N-API-KEY':env.DISHA_MONITOR_N8N_API_KEY}});
    const records=Array.isArray(result.data)?result.data:[];
    return connected('n8n readiness and recent workflow executions',{
      recentExecutions:records.length,failedRecent:records.filter(x=>['error','crashed','failed'].includes(String(x.status||'').toLowerCase())).length,
      lastExecutionAt:String(records[0]?.startedAt||'').slice(0,35)});
   }catch(_){return partial('n8n readiness healthy; execution API not accessible with configured key')}
  }catch(_){return unavailable('n8n readiness endpoint unavailable')}
 }
 async function webhooks(){
  const pool=getPool();
  if(!pool)return unavailable('Database for webhook events is unavailable');
  try{
   const exists=await pool.query("SELECT to_regclass('public.disha_reconciliation_inbox') IS NOT NULL AS ready");
   if(!exists.rows?.[0]?.ready)return notConfigured('No reconciliation intake table; outbound webhook delivery tracking is not implemented');
   const result=await pool.query("SELECT count(*)::int AS received,"+
    "count(*) FILTER(WHERE status='POSTED')::int AS posted,"+
    "count(*) FILTER(WHERE status='QUARANTINED')::int AS quarantined,"+
    "max(created_at) AS latest_at FROM disha_reconciliation_inbox "+
    "WHERE created_at>=now()-interval '24 hours'");
   const row=result.rows?.[0]||{};
   return partial('Inbound reconciliation webhook inbox is available; no outbound delivery queue is implemented',{
    inbound24h:Number(row.received||0),posted24h:Number(row.posted||0),
    quarantined24h:Number(row.quarantined||0),lastReceivedAt:row.latest_at?new Date(row.latest_at).toISOString():null});
  }catch(_){return unavailable('Reconciliation webhook metrics query failed')}
 }
 async function frontend(){
  const pool=getPool();
  if(!pool)return unavailable('Frontend error store unavailable');
  try{
   const result=await pool.query("SELECT count(*) FILTER(WHERE created_at>$1)::int AS recent,"+
     "max(created_at) AS last_at FROM disha_frontend_error_events",[clock()-86400000]);
   const row=result.rows?.[0]||{};
   return connected('First-party browser error events recorded; client reports are not proof of service failures',{
     events24h:Number(row.recent||0),lastEventAt:row.last_at?new Date(Number(row.last_at)).toISOString():null});
  }catch(_){return unavailable('Frontend event store not initialized')}
 }
 async function snapshot(){
  const all=await Promise.allSettled([postgres(),railway(),cloudflare(),github(),n8n(),webhooks(),frontend()]);
  const names=['postgres','railway','cloudflare','github','n8n','webhooks','frontend'];
  const data={observedAt:new Date().toISOString(),services:{}};
  all.forEach((x,i)=>{data.services[names[i]]=x.status==='fulfilled'?x.value:unavailable('Monitoring probe failed')});
  return data;
 }
 async function get(){
  const time=clock();
  if(cache&&time<until)return cache;
  if(inFlight)return inFlight;
  inFlight=snapshot().then(result=>{cache=result;until=clock()+45000;return result}).finally(()=>{inFlight=null});
  return inFlight;
 }
 function invalidate(){cache=null;until=0}
 return {get, invalidate,postgres,github,railway,cloudflare,n8n,webhooks,frontend};
}
module.exports={createOwnerObservability,fixedN8nUrl};
