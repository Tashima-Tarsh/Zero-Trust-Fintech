/* DISHA 8.2 Platform Owner Console — real data only, no manufactured KPI. */
(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
let clerk,owner=null,requests=[],tenants=[],transactions=[],incidents=[],overview={};
const money=p=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format((Number(p)||0)/100);
const when=t=>t?new Date(Number(t)).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const notice=message=>{$('#owner-notice').textContent=message||''};
async function authInit(){
 const key=window.DISHA_CLERK_PUBLISHABLE_KEY;if(!key)throw Error('Clerk is not configured');
 const match=key.split('_')[2];if(!match)throw Error('Invalid authentication configuration');
 const domain=atob(match.replace(/-/g,'+').replace(/_/g,'/')).replace(/(?:\$|\0+)$/,'');
 if(!/^[a-z0-9.-]+$/i.test(domain))throw Error('Invalid identity domain');
 if(!window.Clerk){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://'+domain+'/npm/@clerk/clerk-js@6/dist/clerk.browser.js';s.dataset.clerkPublishableKey=key;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error('Clerk service is unavailable'));document.head.appendChild(s)})}
 clerk=window.Clerk;await clerk.load();if(!clerk.isSignedIn||!clerk.session){location.assign('/login');throw Error('Sign in required')}
}
async function api(path,options={}){
 const token=await clerk.session.getToken();if(!token)throw Error('Session expired');
 const headers={Authorization:'Bearer '+token,'X-CSRF-Token':'Bearer '+token,Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})};
 const r=await fetch('/api/platform'+path,{...options,headers,cache:'no-store',credentials:'same-origin'});let result;
 try{result=await r.json()}catch{result={}}
 if(!r.ok){const e=Error(result.error||'Platform request failed ('+r.status+')');e.status=r.status;throw e}return result;
}
const titles={overview:'Platform Overview',requests:'Access Requests',tenants:'Tenant Management',onboarding:'Merchant Onboarding',transactions:'All Transactions',trust:'Trust & Evidence',ledger:'Reconciliation & Ledger',analytics:'Platform Analytics',incidents:'Errors & Bugs',infrastructure:'Infrastructure Health',integrations:'Automation & Integrations',settings:'Platform Settings'};
function select(screen){if(!titles[screen])screen='overview';$$('.owner-screen').forEach(x=>x.classList.toggle('active',x.id==='screen-'+screen));$$('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===screen));$('#screen-title').textContent=titles[screen];if(location.hash!=='#'+screen)history.replaceState(null,'','#'+screen);$('#console-nav').classList.remove('open');$('#nav-backdrop').classList.remove('open');window.scrollTo(0,0);load(screen).catch(e=>notice(e.message))}
function field(value,label){return '<article class="metric"><label>'+esc(label)+'</label><strong>'+esc(value)+'</strong><small>Recorded platform data</small></article>'}
async function load(screen){
 notice('');
 if(screen==='overview'||screen==='analytics'){const r=await api('/owner/overview');overview=r.metrics;const t=r.metrics.tenants,q=r.metrics.requests,o=r.metrics.orders,i=r.metrics.incidents;const html=field(t.active,'Active external tenants')+field(q.pending,'Awaiting approval')+field(o.total,'Payment requests')+field(i.open,'Open recorded incidents');$('#owner-kpis').innerHTML=html;$('#analytics-kpis').innerHTML=html;}
 if(screen==='requests'){requests=(await api('/owner/requests')).requests||[];$('#requests-body').innerHTML=requests.length?requests.map(r=>'<tr><td><strong>'+esc(r.business_name)+'</strong><span class="sub">'+esc(r.category)+'</span></td><td>'+esc(r.contact_name)+'<span class="sub">'+esc(r.email)+'</span></td><td>'+when(r.created_at)+'</td><td><span class="state">'+esc(r.status)+'</span></td><td>'+(r.status==='REQUESTED'?'<button data-decision="APPROVE" data-id="'+esc(r.id)+'">Approve</button><button data-decision="REJECT" data-id="'+esc(r.id)+'">Reject</button>':'Reviewed')+'</td></tr>').join(''):'<tr><td colspan="5">No access requests received yet.</td></tr>';}
 if(screen==='tenants'||screen==='onboarding'){tenants=(await api('/owner/tenants')).tenants||[];$('#tenants-body').innerHTML=tenants.length?tenants.map(t=>'<tr><td><strong>'+esc(t.business_name||'Unconfigured')+'</strong>'+(t.is_internal_test?'<span class="sub">INTERNAL PRODUCTION TEST</span>':'')+'</td><td>'+esc(t.email||'Owner account')+'</td><td><span class="state">'+esc(t.access_status)+'</span></td><td>'+esc(t.setup_completed?'Complete':'Pending')+'</td><td>'+(t.is_internal_test?'Owner only':t.access_status==='APPROVED'?'<button data-invite="'+esc(t.id)+'">Send Clerk invite</button>':t.access_status==='ACTIVE'?'<button data-status="SUSPENDED" data-tenant="'+esc(t.id)+'">Suspend</button>':t.access_status==='SUSPENDED'?'<button data-status="ACTIVE" data-tenant="'+esc(t.id)+'">Reactivate</button>':'—')+'</td></tr>').join(''):'<tr><td colspan="5">No merchants provisioned.</td></tr>';
 $('#onboarding-body').innerHTML=tenants.map(t=>'<div><b>'+esc(t.business_name||t.email||'Merchant')+'</b><span>'+esc(t.access_status)+' · '+(t.setup_completed?'Setup complete':'Setup pending')+'</span></div>').join('')||'No tenant applications approved yet.';}
 if(screen==='transactions'){transactions=(await api('/owner/transactions')).transactions||[];$('#transactions-body').innerHTML=transactions.length?transactions.map(t=>'<tr><td>'+esc(t.id)+'</td><td>'+esc(t.business_name)+'</td><td>'+money(t.amount_paise)+'</td><td><span class="state">'+esc(t.status)+'</span></td><td>'+when(t.created_at)+'</td></tr>').join(''):'<tr><td colspan="5">No payment requests recorded.</td></tr>';}

 if(screen==='ledger'){const r=await api('/owner/ledger');$('#owner-ledger-summary').innerHTML=r.connected?field(r.summary?.posted??0,'Posted journals')+field(r.summary?.total??0,'Total journals')+field(money(r.summary?.posted_paise??0),'Posted journal amount'):field('Unavailable','Financial schema not provisioned');
 $('#owner-ledger-body').innerHTML=r.connected&&r.journals.length?r.journals.map(j=>'<tr><td>'+esc(j.journal_id)+'</td><td>'+esc(j.business_name||j.merchant_id)+'</td><td>'+esc(j.order_id)+'</td><td>'+money(j.amount_paise)+'</td><td><span class="state">'+esc(j.state)+'</span></td></tr>').join(''):'<tr><td colspan="5">'+(r.connected?'No journals recorded.':'Financial core schema not provisioned.')+'</td></tr>';}
 if(screen==='trust'){const r=await api('/owner/evidence');$('#owner-evidence-body').innerHTML=r.connected&&r.evidence.length?r.evidence.map(v=>'<tr><td>'+esc(v.order_id)+'</td><td>'+esc(v.business_name)+'</td><td>'+esc(v.outcome||'Observed')+'</td><td>'+esc(v.utr_candidate||'—')+'</td><td>'+esc(v.status)+'</td></tr>').join(''):'<tr><td colspan="5">'+(r.connected?'No order-bound Vault events recorded.':'Vault reporting is not available.')+'</td></tr>';}

 if(screen==='incidents'){const r=await api('/owner/incidents');incidents=r.incidents||[];$('#incident-kpis').innerHTML=field(incidents.filter(x=>x.status==='OPEN').length,'Open recorded incidents')+field(incidents.filter(x=>x.severity==='CRITICAL').length,'Critical incidents')+field('Unavailable','Frontend monitoring')+field('Unavailable','Deployment monitoring');
 $('#incidents-body').innerHTML=incidents.length?incidents.map(i=>'<tr><td><span class="state">'+esc(i.severity)+'</span></td><td>'+esc(i.service)+'</td><td>'+esc(i.summary)+'</td><td>'+esc(i.status)+'</td><td>'+when(i.created_at)+'</td><td>'+(i.status==='RESOLVED'?'Resolved':'<button data-incident="'+esc(i.id)+'" data-inc-status="'+(i.status==='OPEN'?'ACKNOWLEDGED':'RESOLVED')+'">'+(i.status==='OPEN'?'Acknowledge':'Resolve')+'</button>')+'</td></tr>').join(''):'<tr><td colspan="6">No incidents recorded in the platform incident store. External telemetry is not connected.</td></tr>';
 $('#telemetry-body').innerHTML=Object.entries(r.telemetry||{}).map(([k,v])=>'<div><b>'+esc(k)+'</b><span>'+esc(v)+'</span></div>').join('');}
 if(screen==='settings'){const r=await api('/owner/audit');$('#audit-body').innerHTML=(r.events||[]).slice(0,35).map(e=>'<div><b>'+esc(e.action)+'</b><span>'+esc(e.target_id)+' · '+when(e.created_at)+'</span></div>').join('')||'No audit events recorded yet.';}
 if(screen==='infrastructure'){try{const r=await fetch('/health',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();$('#infra-api').textContent=j.status||'Responding'}catch(e){$('#infra-api').textContent='Unavailable: '+e.message;}}
}
document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-screen]');if(nav){select(nav.dataset.screen);return}
 const decision=event.target.closest('[data-decision]'),invite=event.target.closest('[data-invite]'),status=event.target.closest('[data-status]'),incident=event.target.closest('[data-incident]');
 if(!decision&&!invite&&!status&&!incident)return;
 const button=decision||invite||status||incident;if(button.disabled)return;
 const action=decision?decision.dataset.decision:status?status.dataset.status:incident?incident.dataset.incStatus:'INVITE';
 if(!confirm('Confirm '+action.toLowerCase()+' for this merchant?'))return;
 button.disabled=true;
 try{
   if(decision)await api('/owner/requests/'+encodeURIComponent(decision.dataset.id)+'/decision',{method:'POST',body:JSON.stringify({decision:action})});
   if(invite)await api('/owner/tenants/'+encodeURIComponent(invite.dataset.invite)+'/invite',{method:'POST',body:'{}'});
   if(status)await api('/owner/tenants/'+encodeURIComponent(status.dataset.tenant)+'/status',{method:'POST',body:JSON.stringify({status:action})});
   if(incident)await api('/owner/incidents/'+encodeURIComponent(incident.dataset.incident)+'/status',{method:'POST',body:JSON.stringify({status:action})});
   await load(decision?'requests':incident?'incidents':'tenants');notice('Action recorded in platform audit.');
 }catch(e){notice(e.message)}finally{button.disabled=false}
});
$('#owner-menu-toggle').addEventListener('click',()=>{let open=!$('#console-nav').classList.contains('open');$('#console-nav').classList.toggle('open',open);$('#nav-backdrop').classList.toggle('open',open);$('#owner-menu-toggle').setAttribute('aria-expanded',String(open))});
$('#nav-backdrop').addEventListener('click',()=>{$('#console-nav').classList.remove('open');$('#nav-backdrop').classList.remove('open')});
$('#refresh-data').addEventListener('click',()=>load(location.hash.slice(1)||'overview').catch(e=>notice(e.message)));
$('#owner-signout').addEventListener('click',async()=>{if(clerk){await clerk.signOut();location.assign('/login')}});
(async()=>{try{await authInit();owner=await api('/owner/me');if(owner.role!=='PLATFORM_OWNER')throw Error('Not authorized');select(titles[location.hash.slice(1)]?location.hash.slice(1):'overview')}catch(e){notice(e.status===403?'Platform owner access is not authorized for this account.':e.message);$$('.owner-screen').forEach(x=>x.classList.remove('active'))}})();
})();
