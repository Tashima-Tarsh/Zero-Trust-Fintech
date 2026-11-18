/* DISHA 8.2 — live merchant console. No preview, mock orders, or sample balances. */
(() => {
'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const esc = x => String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(value)||0);
const num = value => new Intl.NumberFormat('en-IN').format(Number(value)||0);
const date = value => value?new Date(Number(value)).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const plain = value => String(value||'').trim();
const views = {
 overview:['Overview','Your business activity, financial evidence and operational priorities'],
 intelligence:['Payment Intelligence','Order-bound UTR and evidence correlation'],
 payments:['Transactions','Track every payment request and recorded outcome'],
 create:['Create payment','Generate a customer-specific UPI link and QR'],
 vpas:['UPI Accounts & Routing','Manage the UPI addresses that receive your payments'],
 routing:['Routing & accounts','Inspect the primary and active receiving accounts'],
 vault:['Vault & Evidence','Device observations and order-bound evidence'],
 ledger:['Reconciliation & Ledger','Qualified financial records and report status'],
 integrations:['Integrations & Automation','Developer connections and configuration'],
 risk:['Security review','Actual order-state indicators for this workspace'],
 access:['IP directory','Maintain the server IP addresses registered for your business'],
 reports:['Reports & exports','Download recorded merchant payment activity'],
 notifications:['Notifications','Operational events from this workspace'],
 soundbox:['Voice alerts','Announce a recorded completed transaction'],
 api:['Developer connections','Check your authenticated merchant API connectivity'],
 settings:['Business settings','Manage your company profile and access']
};
let merchant=null,metrics={},orders=[],vpas=[],notifications=[],trend=[],filter='ALL',clerk=null;
let created=null,loading=false;
function toast(message){
 const el=$('#toast');if(!el)return;el.textContent=message;el.classList.remove('hidden');
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add('hidden'),4500);
}
function notice(message){
 const el=$('#appNotice');if(!el)return;el.textContent=message||'';el.style.display=message?'block':'none';
}
function busy(element,flag){if(element)element.disabled=Boolean(flag);}
async function authInit(){
 const key=window.DISHA_CLERK_PUBLISHABLE_KEY;
 if(!key)throw Error('Merchant authentication is unavailable');
 const part=key.split('_')[2];
 if(!part)throw Error('Invalid authentication configuration');
 const host=atob(part.replace(/-/g,'+').replace(/_/g,'/')).replace(/(?:\$|\0+)$/, '');
 if(!/^[a-z0-9.-]+$/i.test(host))throw Error('Authentication host invalid');
 if(!window.Clerk){
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://'+host+'/npm/@clerk/clerk-js@6/dist/clerk.browser.js';
   script.dataset.clerkPublishableKey=key;
   script.crossOrigin='anonymous';
   script.onload=resolve;script.onerror=()=>reject(Error('Unable to connect to secure sign-in'));
   document.head.appendChild(script);
  });
 }
 clerk=window.Clerk;await clerk.load();
 if(!clerk.isSignedIn||!clerk.session){location.replace('/login');return false}
 return true;
}
async function authHeaders(withBody=false){
 if(!clerk?.session)throw Error('Your sign-in session has expired');
 const jwt=await clerk.session.getToken();
 if(!jwt)throw Error('Your sign-in session has expired');
 const authorization='Bearer '+jwt;
 const headers={Authorization:authorization,'X-CSRF-Token':authorization,Accept:'application/json'};
 if(withBody)headers['Content-Type']='application/json';
 return headers;
}
async function api(path,options={}){
 const headers={...(await authHeaders(Boolean(options.body))),...(options.headers||{})};
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers});
 let data;try{data=await r.json()}catch{data={}}
 if(!r.ok){const error=Error(data.error||data.message||'Request failed ('+r.status+')');error.status=r.status;throw error}
 return data;
}
function view(name,replaceHistory=false){
 if(!views[name])name='overview';
 document.body.dataset.currentView=name;
 $$('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+name));
 $$('#appSide [data-view]').forEach(el=>{
  el.classList.toggle('active',el.dataset.view===name);
  if(el.dataset.view===name)el.setAttribute('aria-current','page');
  else el.removeAttribute('aria-current');
 });
 $('#viewHeading').textContent=views[name][0];$('#viewSubtitle').textContent=views[name][1];
 if(location.hash!=='#'+name) {
  if(replaceHistory)history.replaceState(null,'','#'+name);
  else history.pushState(null,'','#'+name);
 }
 closeMenu();
 if(typeof window.scrollTo==='function')window.scrollTo(0,0);
 const actions={overview:loadOverview,payments:loadPayments,create:loadVpas,vpas:loadVpas,
 routing:loadVpas,risk:loadRisk,access:loadAccess,reports:loadReports,
 notifications:loadNotifications,api:showApiStatus,intelligence:loadIntelligence,vault:loadVault,ledger:loadLedger};
 if(actions[name]) {
  const work=actions[name]();
  if(work&&typeof work.catch==='function')work.catch(error=>toast(error.message));
 }
}
function closeMenu(){
 $('#appSide')?.classList.remove('open');$('#sideBackdrop')?.classList.remove('open');
 $('#sideToggle')?.setAttribute('aria-expanded','false');
}
function setupBindings(){
 $$('#appSide [data-view]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.view)));
 $$('.merchant-tabbar [data-smart-tab]').forEach(button=>button.addEventListener('click',()=>{
   const area=button.closest('.module');area.querySelectorAll('[data-smart-tab]').forEach(b=>b.classList.toggle('active',b===button));
   area.querySelectorAll('.smart-pane').forEach(p=>p.classList.toggle('active',p.id===button.dataset.smartTab));
 }));
 $('#merchant-mobile-menu')?.addEventListener('click',()=>{
   $('#appSide')?.classList.add('open');$('#sideBackdrop')?.classList.add('open');
   $('#sideToggle')?.setAttribute('aria-expanded','true');
 });
 document.addEventListener('click',event=>{
  const target=event.target.closest('[data-switch]');
  if(target)view(target.dataset.switch);
 });
 $('#sideToggle')?.addEventListener('click',()=>{
  $('#appSide').classList.toggle('open');$('#sideBackdrop').classList.toggle('open');
  $('#sideToggle').setAttribute('aria-expanded',String($('#appSide').classList.contains('open')));
 });
 $('#sideBackdrop')?.addEventListener('click',closeMenu);
 document.addEventListener('keydown',e=>{
   if(e.key==='Escape')closeMenu();
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
     e.preventDefault();$('#globalSearch')?.focus();$('#globalSearch')?.select();
   }
 });
 const routeFromUrl=()=>{const target=location.hash.slice(1);if(views[target])view(target,true)};
 window.addEventListener('hashchange',routeFromUrl);
 window.addEventListener('popstate',routeFromUrl);
 $('#periodSelect')?.addEventListener('change',()=>{loadOverview();loadReports()});
 $('#globalSearch')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){view('payments');$('#paymentsSearch').value=e.target.value;loadPayments()}
 });
 let debounce;$('#paymentsSearch')?.addEventListener('input',()=>{
  clearTimeout(debounce);debounce=setTimeout(loadPayments,260);
 });
 $$('#paymentFilter [data-status]').forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.status;
  $$('#paymentFilter [data-status]').forEach(b=>b.classList.toggle('active',b===button));
  loadPayments();
 }));
 const forms={setupMerchantForm:setupMerchant,addVpaForm:addVpa,createPaymentForm:createPayment,
   addAccessForm:addAccess,settingsForm:saveSettings};
 Object.entries(forms).forEach(([key,fn])=>$('#'+key)?.addEventListener('submit',fn));
 const actions={exportTop:exportCsv,exportReport:exportCsv,refreshVpas:loadVpas,
   importVpaCsv:bulkImportVpas,downloadVpaTemplate:downloadVpaTemplate,
   refreshAccess:loadAccess,markRead:markRead,runApiExplorer:showApiStatus,
   testHealth:testHealth,playVoice:announceLatest,signOut:logout,settingsLogout:logout};
 Object.entries(actions).forEach(([key,fn])=>$('#'+key)?.addEventListener('click',fn));
 $('#copyEndpoints')?.addEventListener('click',()=>copyText(
  'GET /api/auth/me\nGET /api/merchant/dashboard\nGET /api/merchant/payments\nPOST /api/merchant/payments\nGET /api/merchant/vpas\nPOST /api/merchant/vpas\nGET /api/merchant/reports'));
 $('#vpaTable')?.addEventListener('click',e=>{
  const button=e.target.closest('[data-vpa-action]');if(button)updateVpa(button.dataset.vpaId,button.dataset.vpaAction);
 });
 $('#paymentsTable')?.addEventListener('click',e=>{
  const button=e.target.closest('[data-order-id]');if(button)showOrder(button.dataset.orderId);
 });
 $('#createResult')?.addEventListener('click',e=>{
  const button=e.target.closest('[data-copy]');if(button)copyText(button.dataset.copy);
 });
 $('#accessTable')?.addEventListener('click',e=>{
  const button=e.target.closest('[data-remove-access]');if(button)removeAccess(button.dataset.removeAccess);
 });
}
function merchantHeader(){
 const name=merchant.business_name||merchant.email||'New merchant';
 $('#merchantSideName').textContent=name;
 $('#merchantSideSub').textContent=merchant.email||'Merchant administrator';
 $('#merchantInitial').textContent=name.slice(0,2).toUpperCase();
 $('#environmentLabel').innerHTML='<span class="dot"></span> '+(merchant.is_internal_test?'Internal production test':'Merchant workspace');
 $('#settingsName').value=merchant.business_name||'';
 $('#settingsPhone').value=merchant.contact_phone||'';
 $('#settingsCity').value=merchant.city||'';
 $('#merchantSetup').style.display=merchant.setup_completed?'none':'block';
 if(!merchant.setup_completed)$('#setupBusinessName').value=merchant.business_name||'';
 notice('');
}
async function init(){
 setupBindings();
 try{
  if(!await authInit())return;
  const result=await api('/api/auth/me');
  merchant=result.merchant;
  if(!merchant)throw Error('Merchant identity is missing');
  merchantHeader();
  await Promise.allSettled([loadVpas(),loadOverview(),loadNotifications()]);
  view(views[location.hash.slice(1)]?location.hash.slice(1):'overview',true);
 }catch(error){
  if(error.status===401){location.replace('/login');return}
  notice('Unable to load your merchant workspace: '+error.message);
  toast('Connection needs attention');
 }
}
async function setupMerchant(event){
 event.preventDefault();const button=event.submitter;busy(button,true);
 try{
  const d=await api('/api/merchant/setup',{method:'POST',
   body:JSON.stringify({businessName:plain($('#setupBusinessName').value),
     primaryVpa:plain($('#setupPrimaryVpa').value),primaryHolderName:plain($('#setupHolderName').value),primaryBankName:plain($('#setupBankName').value),accountType:$('#setupAccountType').value,mcc:$('#setupMcc').value.trim()})});
  merchant=d.merchant;merchantHeader();await loadVpas();await loadOverview();view('overview');toast('Workspace activated');
 }catch(error){toast(error.message)}finally{busy(button,false)}
}
function orderTable(rows,compact=false){
 if(!rows.length)return '<tr><td colspan="'+(compact?5:7)+'" class="empty">No real payment records in this view.</td></tr>';
 return rows.map(o=>'<tr><td><strong>'+esc(o.id)+'</strong></td><td>'+esc(date(o.created_at))+
  '</td><td>'+money(o.amount)+'</td><td>'+esc(o.vpa_address)+'</td>'+
  (compact?'':'<td>'+esc(o.utr||'—')+'</td>')+
  '<td><span class="state '+esc(String(o.status).toLowerCase())+'">'+esc(o.status)+'</span></td>'+
  (compact?'':'<td><button type="button" class="btn-inline" data-order-id="'+esc(o.id)+'">Details</button></td>')+'</tr>').join('');
}
async function loadOverview(){
 try{
  const d=await api('/api/merchant/dashboard?dateFilter='+encodeURIComponent($('#periodSelect').value));
  metrics=d.metrics||{};orders=d.recentTransactions||[];trend=d.trend||[];if(d.vpas)vpas=d.vpas;
  if(d.notifications)notifications=d.notifications;
  $('#metricVolume').textContent=money(metrics.totalVolume);
  $('#metricCompleted').textContent=num(metrics.completedTransactions);
  $('#metricPending').textContent=num(metrics.pendingTransactions);
  $('#metricOrders').textContent=num(metrics.totalTransactions);
  $('#recentTable').innerHTML=orderTable(orders.slice(0,7),true);
  const pct=Number(metrics.successRate)||0;
  $('#completionRate').textContent=pct+'%';
  $('#completionRing').style.background='conic-gradient(#2e6fe4 '+pct+'%, #e7edf8 '+pct+'% 100%)';
  $('#statusCompleted').textContent=num(metrics.completedTransactions);
  $('#statusPending').textContent=num(metrics.pendingTransactions);
  $('#statusTotal').textContent=num(metrics.totalTransactions);
  renderChart();miniPanels();
 }catch(e){notice('Unable to load live dashboard data: '+e.message)}
}
function renderChart(){
 const target=$('#activityChart');
 const values=trend.filter(point=>Number(point.volume)>0).slice(-30);
 if(!values.length){
  target.innerHTML='<div class="empty-state"><span class="empty-graphic" aria-hidden="true">↗</span><strong>Activity will appear here</strong><p>No completed payment records in this period. Create a payment request to begin tracking.</p><button type="button" class="btn tiny ghost" data-switch="create">Create payment ↗</button></div>';
  return;
 }
 const width=680,top=24,bottom=182;
 const max=Math.max(1,...values.map(p=>Number(p.volume)));
 const points=values.map((p,i)=>{
  const x=values.length===1?width/2:(i/(values.length-1))*width;
  const y=bottom-(Number(p.volume)/max)*(bottom-top);
  return {x,y,label:new Date(Number(p.day)).toLocaleDateString('en-IN',{day:'numeric',month:'short'}),amount:Number(p.volume)};
 });
 const line=points.map(p=>p.x.toFixed(2)+','+p.y.toFixed(2)).join(' ');
 const area='0,'+bottom+' '+line+' '+width+','+bottom;
 const grid=[0,1,2,3,4].map(i=>{
  const y=bottom-i*(bottom-top)/4;
  return '<line x1="0" y1="'+y+'" x2="'+width+'" y2="'+y+'" class="trend-grid"/>';
 }).join('');
 const ticks=[points[0],points[Math.floor(points.length/2)],points[points.length-1]]
  .filter((point,i,array)=>array.indexOf(point)===i)
  .map(point=>'<text class="trend-axis" x="'+point.x+'" y="217" text-anchor="middle">'+esc(point.label)+'</text>').join('');
 target.innerHTML='<div class="chart-frame"><div class="chart-total"><span>Recorded volume</span><strong>'+money(values.reduce((sum,p)=>sum+Number(p.volume),0))+'</strong></div>'+
  '<svg class="chart premium-trend" viewBox="0 0 680 226" role="img" aria-label="Actual completed payment volume by day">'+
  '<defs><linearGradient id="dishaArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7563d5" stop-opacity=".28"/><stop offset="1" stop-color="#7563d5" stop-opacity="0"/></linearGradient></defs>'+
  grid+'<polygon points="'+area+'" fill="url(#dishaArea)"/><polyline points="'+line+'" fill="none" stroke="#7563d5" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'+
  points.map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="#7563d5" stroke="#fff" stroke-width="2"><title>'+esc(p.label+': '+money(p.amount))+'</title></circle>').join('')+ticks+'</svg></div>';
}
function miniPanels(){
 $('#overviewVpas').textContent=num(vpas.length);
 $('#overviewActiveVpas').textContent=num(vpas.filter(o=>o.status==='ACTIVE').length);
 const html=notifications.slice(0,3).map(n=>
  '<div class="activity-item"><div class="n-icon">•</div><div><b>'+esc(n.title)+
  '</b><small>'+esc(n.message)+'</small></div></div>').join('');
 $('#overviewNotifications').innerHTML=html||'<div class="empty">No operational notifications.</div>';
}

async function merchantEvidence(){
 const d=await api('/api/merchant/payments?limit=200');
 return d.orders||[];
}
function evidenceTable(rows,mode){
 if(!rows.length)return '<div class="empty">No recorded merchant orders in this workspace.</div>';
 const heading=mode==='vault'?'<th>Order</th><th>Vault outcome</th><th>Reference candidate</th><th>Payment status</th>':'<th>Order</th><th>Amount</th><th>UTR</th><th>Observed evidence</th><th>Recorded status</th>';
 const cells=rows.map(o=>{
  const outcome=o.vault_outcome||'No Vault observation';
  if(mode==='vault')return '<tr><td>'+esc(o.id)+'</td><td>'+esc(outcome)+'</td><td>'+esc(o.vault_utr_candidate||'Not provided')+'</td><td>'+esc(o.status)+'</td></tr>';
  return '<tr><td>'+esc(o.id)+'<small>'+esc(o.vpa_address)+'</small></td><td>'+esc(money(o.amount))+'</td><td>'+esc(o.utr||'Not recorded')+'</td><td>'+esc(outcome)+'</td><td>'+esc(o.status)+'</td></tr>';
 }).join('');
 return '<table class="merchant-op-table"><thead><tr>'+heading+'</tr></thead><tbody>'+cells+'</tbody></table>';
}
async function loadIntelligence(){
 try{
  const items=await merchantEvidence();
  $('#intelligence-table').innerHTML=evidenceTable(items,'intelligence');
  const questionable=items.filter(o=>o.vault_outcome&&String(o.vault_outcome).toUpperCase()!=='VERIFIED'||o.status==='EXPIRED'||o.status==='FAILED');
  $('#intelligence-exceptions').innerHTML=questionable.length?evidenceTable(questionable,'intelligence'):'<div class="empty">No recorded exceptions in the loaded order register. This is not a platform-wide fraud guarantee.</div>';
 }catch(e){$('#intelligence-table').textContent='Unable to retrieve merchant intelligence: '+e.message}
}

async function loadLedger(){
 const summary=$('#merchant-ledger-summary'),body=$('#merchant-ledger-records');
 if(!summary||!body)return;
 try{
  const d=await api('/api/merchant/ledger');
  if(!d.connected){summary.textContent='Financial journal schema is not provisioned';body.innerHTML='<div class="empty">No journal data available.</div>';return}
  summary.textContent='Posted journals: '+num(d.summary?.posted||0)+' · Amount: '+money(Number(d.summary?.posted_paise||0)/100);
  body.innerHTML=d.journals.length?'<table class="merchant-op-table"><thead><tr><th>Journal</th><th>Order</th><th>Amount</th><th>State</th><th>Posted</th></tr></thead><tbody>'+
    d.journals.map(j=>'<tr><td>'+esc(j.journal_id)+'</td><td>'+esc(j.order_id)+'</td><td>'+esc(money(Number(j.amount_paise)/100))+'</td><td>'+esc(j.state)+'</td><td>'+esc(j.posted_at||'Not posted')+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No financial journal records exist for this tenant.</div>';
 }catch(e){summary.textContent='Ledger unavailable';body.textContent=e.message}
}

async function loadVault(){
 try{$('#vault-table').innerHTML=evidenceTable((await merchantEvidence()).filter(o=>o.vault_outcome||o.vault_utr_candidate),'vault')}
 catch(e){$('#vault-table').textContent='Unable to retrieve Vault records: '+e.message}
}

async function loadPayments(){
 try{
  const params=new URLSearchParams({status:filter,search:$('#paymentsSearch').value.trim(),limit:'200'});
  const d=await api('/api/merchant/payments?'+params.toString());
  orders=d.orders||[];$('#paymentsTable').innerHTML=orderTable(orders);
 }catch(error){toast(error.message)}
}
function showOrder(id){
 const o=orders.find(x=>x.id===id);if(!o)return;
 const detail=$('#txDetails');detail.style.display='block';
 detail.innerHTML='<div class="module-head"><h2>Payment '+esc(o.id)+'</h2><button type="button" class="btn tiny" id="closeDetail">Close ×</button></div>'+
  '<div class="order-details">'+[
   ['Amount',money(o.amount)],['Status',esc(o.status)],['Receiving UPI',esc(o.vpa_address)],
   ['UTR',esc(o.utr||'Not recorded')],['Created',esc(date(o.created_at))],
   ['Your reference',esc(o.external_reference||'—')]
  ].map(pair=>'<div>'+pair[0]+'<strong>'+pair[1]+'</strong></div>').join('')+'</div>';
 $('#closeDetail').onclick=()=>detail.style.display='none';
 detail.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function loadVpas(){
 try{
  const d=await api('/api/merchant/vpas');vpas=d.vpas||[];
  $('#vpaTotal').textContent=num(vpas.length);
  $('#vpaActive').textContent=num(vpas.filter(v=>v.status==='ACTIVE').length);
  $('#vpaPaused').textContent=num(vpas.filter(v=>v.status==='PAUSED').length);
  $('#vpaDefault').textContent=num(vpas.filter(v=>v.is_default).length);
  $('#vpaTable').innerHTML=vpas.length?vpas.map(v=>
   '<tr><td><strong>'+esc(v.vpa_address)+'</strong></td><td>'+esc(v.holder_name||'Not entered')+'</td><td>'+esc((v.bank_name||'—')+' · '+(v.account_type==='MERCHANT'?'P2M':'P2P'))+'</td>'+
   '<td><span class="state '+(v.status==='ACTIVE'?'active':'paused')+'">'+esc(v.status)+'</span></td>'+
   '<td>'+(v.is_default?'Primary':'—')+'</td><td>'+
   (v.is_default?'':'<button type="button" class="btn-inline" data-vpa-action="set_default" data-vpa-id="'+esc(v.id)+'">Make primary</button>')+
   '<button type="button" class="btn-inline" data-vpa-action="'+(v.status==='ACTIVE'?'pause':'resume')+
   '" data-vpa-id="'+esc(v.id)+'">'+(v.status==='ACTIVE'?'Pause':'Resume')+'</button></td></tr>').join(''):
   '<tr><td colspan="6" class="empty">No UPI accounts yet. Add your own receiving UPI ID below, or import a CSV.</td></tr>';
  $('#routingAccounts').innerHTML=vpas.length?vpas.map(v=>{
   const used=Math.max(0,Number(v.daily_tx_count)||0),limit=Math.max(1,Number(v.daily_tx_limit)||15);
   const pct=Math.min(100,Math.round(used/limit*100));
   const score=Math.max(0,Math.min(100,Number(v.health_score)||0));
   return '<article class="routing-entry"><div class="routing-entry-head"><div><strong>'+esc(v.holder_name||v.vpa_address)+
     '</strong><small>'+esc(v.vpa_address)+'</small></div><span class="state '+(v.status==='ACTIVE'?'active':'paused')+'">'+esc(v.status)+'</span></div>'+
     '<div class="routing-facts"><span>Internal health score <b>'+num(score)+'/100</b></span>'+
     '<span>Requests today <b>'+num(used)+' / '+num(limit)+'</b></span>'+
     '<span>Policy volume today <b>'+money(v.daily_volume)+'</b></span></div>'+
     '<div class="routing-meter" aria-label="'+pct+' percent daily request allowance used"><span style="width:'+pct+'%"></span></div>'+
     '<small class="routing-caption">'+(v.is_default?'Primary receiving account':'Additional receiving account')+
     ' · Internal policy indicators, not a bank-verified balance</small></article>';
  }).join(''):
   '<div class="empty-state"><strong>No receiving accounts connected</strong><p>Add your own UPI ID in Accounts before creating payment requests.</p><button type="button" class="btn tiny ghost" data-switch="vpas">Open UPI accounts</button></div>';
  populateSelect();miniPanels();
 }catch(e){toast(e.message)}
}
function populateSelect(){
 const select=$('#newVpa');if(!select)return;
 const previous=select.value;
 select.innerHTML='<option value="">Use primary active UPI ID</option>'+vpas.filter(v=>v.status==='ACTIVE').map(v=>
  '<option value="'+esc(v.vpa_address)+'">'+esc(v.vpa_address)+(v.is_default?' (Primary)':'')+'</option>').join('');
 if([...select.options].some(o=>o.value===previous))select.value=previous;
}
async function addVpa(e){
 e.preventDefault();busy(e.submitter,true);
 try{
  await api('/api/merchant/vpas',{method:'POST',body:JSON.stringify({
   vpaAddress:$('#vpaAddress').value.trim(),holderName:$('#vpaHolder').value.trim(),bankName:$('#vpaBank').value.trim(),accountType:$('#vpaAccountType').value,mcc:$('#vpaMcc').value.trim()
  })});
  $('#addVpaForm').reset();await loadVpas();toast('Receiving UPI ID added');
 }catch(error){toast(error.message)}finally{busy(e.submitter,false)}
}
async function bulkImportVpas(event){
 const button=event.currentTarget;
 const input=$('#vpaCsvFile'),status=$('#importVpaStatus'),file=input?.files?.[0];
 if(!file){toast('Choose a CSV file first');return}
 if(file.size>256*1024){toast('CSV file must be smaller than 256 KB');return}
 busy(button,true);
 try{
  if(!window.DISHAVpaImport)throw Error('UPI import tool is unavailable');
  const source=await file.text();
  const accounts=window.DISHAVpaImport.parseVpaCsv(source);
  status.textContent='Validating '+accounts.length+' UPI account(s)…';
  const result=await api('/api/merchant/vpas/import',{method:'POST',body:JSON.stringify({accounts})});
  input.value='';
  status.textContent=result.imported+' account(s) imported. All accounts belong to your merchant workspace.';
  await loadVpas();toast(result.imported+' receiving UPI accounts imported');
 }catch(error){status.textContent='Import not saved: '+error.message;toast(error.message)}
 finally{busy(button,false)}
}
function downloadVpaTemplate(){
 const csv='upi_id,account_holder,bank_name,account_type,mcc\n';
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const href=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=href;a.download='disha-upi-accounts-template.csv';document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(href),2500);
}
async function updateVpa(id,action){
 try{
  await api('/api/merchant/vpas/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({action})});
  await loadVpas();toast('Receiving account updated');
 }catch(e){toast(e.message)}
}
async function createPayment(e){
 e.preventDefault();const button=e.submitter;busy(button,true);
 const amount=plain($('#newAmount').value);
 if(!/^\d+(?:\.\d{1,2})?$/.test(amount)){toast('Enter a valid amount up to two decimal places');busy(button,false);return}
 try{
  const response=await api('/api/merchant/payments',{method:'POST',body:JSON.stringify({
   amount,description:$('#newDesc').value.trim(),orderId:$('#newOrderId').value.trim(),
   vpaAddress:$('#newVpa').value||null
  })});
  created=response.order;showCreatedOrder(created);toast('Live payment request generated');
  await loadOverview();
 }catch(error){toast(error.message)}finally{busy(button,false)}
}
function showCreatedOrder(o){
 const link=location.origin+o.checkout_url;
 const box=$('#createResult');box.className='';
 box.innerHTML='<div class="qr-result"><div class="qr-shell"><div id="createdQr"></div></div>'+
  '<div class="qr-copy"><div class="overline">REQUEST CREATED</div><div class="pay-amount">'+money(o.amount)+'</div>'+
  '<p>'+esc(o.id)+'</p><p>Receiving '+esc(o.vpa_address)+'</p>'+
  '<div class="form-actions">'+
  '<button type="button" class="btn tiny" data-copy="'+esc(link)+'">Copy payment link</button>'+
  '<button type="button" class="btn tiny ghost" data-copy="'+esc(o.upi_uri_dynamic)+'">Copy UPI URI</button>'+
  '<a class="btn tiny primary" href="'+esc(o.checkout_url)+'" target="_blank" rel="noopener">Open checkout ↗</a>'+
  '</div></div></div><p class="fine" style="margin-top:14px">The request expires after three minutes. Share the link with your customer.</p>';
 const node=$('#createdQr');
 if(window.QRCode && o.upi_uri_dynamic){
  new QRCode(node,{text:o.upi_uri_dynamic,width:174,height:174,correctLevel:QRCode.CorrectLevel.M});
 }else node.textContent='UPI URI ready — use the payment link.';
}
async function loadReports(){
 try{
  const d=await api('/api/merchant/reports?dateFilter='+encodeURIComponent($('#periodSelect').value));
  const m=d.metrics||{};
  $('#reportVolume').textContent=money(m.totalVolume);
  $('#reportCompleted').textContent=num(m.completedTransactions);
  $('#reportPending').textContent=num(m.pendingTransactions);
 }catch(e){toast(e.message)}
}
async function exportCsv(){
 try{
  const headers=await authHeaders();
  const response=await fetch('/api/merchant/reports?dateFilter='+
   encodeURIComponent($('#periodSelect').value)+'&format=csv',
   {headers,credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Export unavailable ('+response.status+')');
  const data=await response.blob(),url=URL.createObjectURL(data),anchor=document.createElement('a');
  anchor.href=url;anchor.download='disha-merchant-ledger.csv';document.body.appendChild(anchor);
  anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);
  toast('Ledger CSV downloaded');
 }catch(e){toast(e.message)}
}
async function loadRisk(){
 try{
  const d=await api('/api/merchant/risk'),r=d.risk||{};
  $('#riskResult').style.display='block';
  $('#riskResult').innerHTML='<h2>Current order controls</h2><div class="risk-facts">'+
    '<div><b>'+num(r.open)+'</b><small>Open payment requests</small></div>'+
    '<div><b>'+num(r.expired)+'</b><small>Expired requests</small></div>'+
    '<div><b>'+num(r.completed)+'</b><small>Completed records</small></div></div>';
 }catch(e){toast(e.message)}
}
async function loadAccess(){
 try{
  const d=await api('/api/merchant/ip-whitelist'),ips=d.ips||[];
  $('#accessTable').innerHTML=ips.length?ips.map(o=>
   '<tr><td>'+esc(o.ip_address)+'</td><td>'+esc(o.description||'—')+'</td>'+
   '<td>Saved</td><td><button type="button" class="btn-inline" data-remove-access="'+esc(o.id)+'">Remove</button></td></tr>').join(''):
   '<tr><td colspan="4" class="empty">No server addresses registered yet.</td></tr>';
  if($('#blockedAccess'))$('#blockedAccess').innerHTML='<div class="empty">No events available for this workspace.</div>';
 }catch(e){toast(e.message)}
}
async function addAccess(e){
 e.preventDefault();busy(e.submitter,true);
 const input=$('#accessIp').value.trim();
 try{
  await api('/api/merchant/ip-whitelist',{method:'POST',body:JSON.stringify({
   ip_address:input.includes('/')?'':input,ip_range:input.includes('/')?input:'',
   description:$('#accessDesc').value.trim()
  })});
  $('#addAccessForm').reset();await loadAccess();toast('Server address saved');
 }catch(err){toast(err.message)}finally{busy(e.submitter,false)}
}
async function removeAccess(id){
 if(!confirm('Remove this server address?'))return;
 try{await api('/api/merchant/ip-whitelist/'+encodeURIComponent(id),{method:'DELETE'});await loadAccess();toast('Address removed')}
 catch(e){toast(e.message)}
}
async function loadNotifications(){
 try{
  const d=await api('/api/merchant/notifications');notifications=d.notifications||[];
  $('#fullNotifications').innerHTML=notifications.length?notifications.map(n=>
   '<div class="activity-item"><div class="n-icon">•</div><div><b>'+esc(n.title)+'</b>'+
   '<small>'+esc(n.message)+'</small><small>'+esc(date(n.created_at))+'</small></div></div>').join(''):
   '<div class="empty">You have no notifications.</div>';
  miniPanels();
 }catch(e){toast(e.message)}
}
async function markRead(){
 try{await api('/api/merchant/notifications/read',{method:'POST',body:'{}'});await loadNotifications();toast('Notifications marked read')}
 catch(e){toast(e.message)}
}
async function saveSettings(e){
 e.preventDefault();busy(e.submitter,true);
 try{
  await api('/api/merchant/profile',{method:'PUT',body:JSON.stringify({
   businessName:$('#settingsName').value.trim(),contactPhone:$('#settingsPhone').value.trim(),
   city:$('#settingsCity').value.trim()
  })});
  merchant.business_name=$('#settingsName').value.trim();
  merchantHeader();toast('Business profile saved');
 }catch(e2){toast(e2.message)}finally{busy(e.submitter,false)}
}
async function testHealth(){
 try{
  const r=await fetch('/health',{cache:'no-store'});
  if(!r.ok)throw Error('Backend returned '+r.status);
  const d=await r.json();$('#healthResult').textContent='Railway API: '+(d.status||'Online');
 }catch(e){$('#healthResult').textContent=e.message}
}
async function showApiStatus(){
 const selected=$('#apiExplorerEndpoint')?.value||'/api/auth/me';
 const allowed=['/health','/api/auth/me','/api/merchant/dashboard','/api/merchant/vpas','/api/merchant/notifications'];
 const path=allowed.includes(selected)?selected:'/api/auth/me';
 const output=$('#apiExplorerResult');if(!output)return;
 output.textContent='Checking live API…';
 try{
  const response=path==='/health'?await fetch(path,{cache:'no-store'}):null;
  const result=response?await response.json():await api(path);
  output.textContent=JSON.stringify(result,null,2).slice(0,5500);
 }catch(e){output.textContent=e.message}
}
function announceLatest(){
 if(!('speechSynthesis' in window)){toast('Voice alerts are not supported by this browser');return}
 const completed=orders.find(o=>o.status==='COMPLETED');
 if(!completed){toast('No completed payment is available to announce');return}
 const language=$('#voiceLanguage').value,volume=Number($('#voiceVolume').value)/100;
 const phrase=language==='hi-IN'?'भुगतान दर्ज हुआ '+money(completed.amount):
  language==='mr-IN'?'पेमेंट नोंदले गेले '+money(completed.amount):
  'Recorded payment of '+money(completed.amount);
 const utterance=new SpeechSynthesisUtterance(phrase);utterance.lang=language;
 utterance.volume=volume;window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);
}
async function copyText(value){
 try{await navigator.clipboard.writeText(value);toast('Copied to clipboard')}
 catch(e){toast('Clipboard unavailable — use your browser share controls')}
}
async function logout(){
 try{if(!clerk)throw Error('No active authentication session');await clerk.signOut();location.assign('/login')}
 catch(e){toast('Unable to sign out: '+e.message)}
}
document.addEventListener('DOMContentLoaded',init);
})();
