'use strict';
/* DISHA Platform Control: owner-only access requests, tenant activation,
 * Clerk invitations, scoped reporting and audit events.
 * Invite-only gate activates ONLY with both owner Clerk ID and env flag.
 */
const express=require('express');
const crypto=require('node:crypto');
const {getClerkVerifiedEmail}=require('./utils/platform-clerk-identity');
const id=(p)=>p+crypto.randomBytes(12).toString('hex');
const val=(s,max=200)=>String(s??'').trim().slice(0,max);
const err=(status,message)=>Object.assign(new Error(message),{status});
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const safeName=s=>val(s,160).replace(/[\u0000-\u001f]/g,'');
function createPlatformControl({db,getAuth,clerkEmailResolver=getClerkVerifiedEmail}){
 const router=express.Router();
 let pool=db.pgPool;
 const active=()=>process.env.DISHA_INVITE_ONLY_ENABLED==='true';
 const ownerId=()=>process.env.DISHA_OWNER_CLERK_USER_ID||'';
 const ownerEmail=()=>String(process.env.DISHA_OWNER_EMAIL||'').trim().toLowerCase();
 const ownerKey=()=>crypto.createHash('sha256').update(ownerEmail()||ownerId()||'unconfigured').digest('hex').slice(0,20);
 const ownerTenantId=()=> 'mer_internal_'+ownerKey();
 const companyTenantId=()=> 'mer_company_'+ownerKey();
 const companyVpa=()=>val(process.env.DISHA_COMPANY_P2M_VPA||'',150).toLowerCase();
 async function verifiedOwner(userId){
   if(!active()||!userId)return false;
   if(ownerId())return userId===ownerId();
   if(!EMAIL.test(ownerEmail()))return false;
   return (await clerkEmailResolver(userId))===ownerEmail();
 }
 async function ensureOwnerTestTenant(){
   if(!active()||!EMAIL.test(ownerEmail()))return null;
   const now=Date.now(),ownerName=val(process.env.DISHA_OWNER_DISPLAY_NAME||'',150);
   const phone=val(process.env.DISHA_OWNER_PHONE||'',30);
   const business=val(process.env.DISHA_OWNER_BUSINESS||'',150)||'DISHA Internal Testing';
   const alias='internal:owner:'+ownerKey();
   await pool.query(
    "INSERT INTO saas_merchants(id,clerk_user_id,business_name,email,contact_phone,setup_completed,access_status,is_internal_test,approved_by,approved_at,created_at,updated_at) "+
    "VALUES($1,$2,$3,$4,$5,TRUE,'ACTIVE',TRUE,$2,$6,$6,$6) "+
    "ON CONFLICT(id) DO UPDATE SET business_name=EXCLUDED.business_name,email=EXCLUDED.email,"+
    "contact_phone=EXCLUDED.contact_phone,setup_completed=TRUE,access_status='ACTIVE',is_internal_test=TRUE,updated_at=EXCLUDED.updated_at",
    [ownerTenantId(),alias,business,ownerEmail(),phone,now]);
   await pool.query(
    "INSERT INTO disha_owner_profile(owner_key,display_name,email,phone,business_name,professional_title,updated_at) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_key) DO UPDATE SET "+
    "display_name=EXCLUDED.display_name,email=EXCLUDED.email,phone=EXCLUDED.phone,"+
    "business_name=EXCLUDED.business_name,professional_title=EXCLUDED.professional_title,updated_at=EXCLUDED.updated_at",
    [ownerKey(),ownerName,ownerEmail(),phone,business,val(process.env.DISHA_OWNER_TITLE||'',100),now]);
   const accounts=String(process.env.DISHA_OWNER_P2P_VPAS||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(x));
   for(const [i,account] of [...new Set(accounts)].entries()){
     const primary=i===0;
     await pool.query(
      "INSERT INTO saas_merchant_vpas(id,merchant_id,vpa_address,bank_name,holder_name,status,is_default,account_type,created_at) "+
      "VALUES($1,$2,$3,'', $4,'ACTIVE',$5,'PERSONAL',$6) ON CONFLICT(vpa_address) DO NOTHING",
      ['vpa_owner_'+crypto.createHash('sha256').update(account).digest('hex').slice(0,20),ownerTenantId(),account,ownerName,primary,now]);
   }
   const company=val(process.env.DISHA_COMPANY_BUSINESS||'',150);
   const mcc=val(process.env.DISHA_COMPANY_MCC||'',4);
   if(company&&companyVpa()){
     await pool.query(
      "INSERT INTO saas_merchants(id,clerk_user_id,business_name,email,setup_completed,access_status,is_internal_test,created_at,updated_at) "+
      "VALUES($1,NULL,$2,'',FALSE,'PENDING',FALSE,$3,$3) ON CONFLICT(id) DO NOTHING",
      [companyTenantId(),company,now]);
     if(/^\d{4}$/.test(mcc)&&/^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$/.test(companyVpa()))
       await pool.query(
        "INSERT INTO saas_merchant_vpas(id,merchant_id,vpa_address,holder_name,bank_name,status,is_default,account_type,mcc,created_at) "+
        "VALUES($1,$2,$3,$4,'','PAUSED',TRUE,'MERCHANT',$5,$6) ON CONFLICT(vpa_address) DO NOTHING",
        ['vpa_company_'+ownerKey(),companyTenantId(),companyVpa(),company,mcc,now]);
   }
   return (await pool.query("SELECT * FROM saas_merchants WHERE id=$1 AND is_internal_test=TRUE",[ownerTenantId()])).rows[0]||null;
 }
 const limiter=new Map();
 const wrap=f=>(req,res,next)=>Promise.resolve().then(()=>f(req,res)).catch(next);
 const audit=async(client,actor,action,target,details={})=>client.query(
   'INSERT INTO disha_platform_audit(id,actor_id,action,target_id,details,created_at) VALUES($1,$2,$3,$4,$5,$6)',
   [id('aud_'),actor,action,target,JSON.stringify(details),Date.now()]);
 async function init(){
   // db.initDb() assigns the PostgreSQL pool asynchronously after this router is constructed.
   // Resolve it at startup; all handlers reference this same refreshed closure variable.
   pool=db.pgPool||pool;
   if(!pool)throw Error('Platform control requires PostgreSQL');
   // Never grant platform access without a server-configured and verified owner identity.
   if(active()&&!ownerId()&&!EMAIL.test(ownerEmail()))console.error('[Platform Control] OWNER IDENTITY MISSING — access denied');
   await pool.query(
    "CREATE TABLE IF NOT EXISTS disha_access_requests ("+
    "id TEXT PRIMARY KEY,business_name TEXT NOT NULL,contact_name TEXT NOT NULL,email TEXT NOT NULL,"+
    "phone TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',estimated_volume TEXT NOT NULL DEFAULT '',"+
    "status TEXT NOT NULL DEFAULT 'REQUESTED',reviewed_by TEXT,reviewed_at BIGINT,merchant_id TEXT,"+
    "created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);"+
    "CREATE INDEX IF NOT EXISTS idx_disha_access_pending ON disha_access_requests(status,created_at DESC);"+
    "CREATE TABLE IF NOT EXISTS disha_platform_audit ("+
    "id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,"+
    "details JSONB NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL);"+
    "CREATE INDEX IF NOT EXISTS idx_disha_audit_time ON disha_platform_audit(created_at DESC);"+
    "CREATE TABLE IF NOT EXISTS disha_platform_incidents ("+
    "id TEXT PRIMARY KEY,severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','ERROR','CRITICAL')),"+
    "service TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN',"+
    "release_id TEXT NOT NULL DEFAULT '',trace_id TEXT NOT NULL DEFAULT '',"+
    "created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);"+
    "CREATE INDEX IF NOT EXISTS idx_disha_incidents_time ON disha_platform_incidents(created_at DESC);"+
    "ALTER TABLE saas_merchants ALTER COLUMN clerk_user_id DROP NOT NULL;"+
    "ALTER TABLE saas_merchants ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'PENDING';"+
    "ALTER TABLE saas_merchants ADD COLUMN IF NOT EXISTS approved_email TEXT;"+
    "ALTER TABLE saas_merchants ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT FALSE;"+
    "ALTER TABLE saas_merchants ADD COLUMN IF NOT EXISTS approved_by TEXT;"+
    "CREATE TABLE IF NOT EXISTS disha_owner_profile ("+
    "owner_key TEXT PRIMARY KEY,display_name TEXT NOT NULL,email TEXT NOT NULL,"+
    "phone TEXT NOT NULL DEFAULT '',business_name TEXT NOT NULL,professional_title TEXT NOT NULL DEFAULT '',updated_at BIGINT NOT NULL);"+
    "ALTER TABLE saas_merchants ADD COLUMN IF NOT EXISTS approved_at BIGINT;"+
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_disha_approved_email ON saas_merchants(lower(approved_email)) WHERE approved_email IS NOT NULL;"
   );
   // Idempotent configuration: never erase or reassign historical transactions.
   if(active()&&EMAIL.test(ownerEmail()))await ensureOwnerTestTenant();
   console.log('[Platform Control] initialized; controlled access '+(active()?'ENABLED':'not yet activated'));
 }
 function isOwner(userId){return active()&&Boolean(ownerId())&&userId===ownerId();}
 async function verifyMerchant(userId,auth){
   if(!active())return null;
   if(await verifiedOwner(userId)){
     const r=await ensureOwnerTestTenant();
     if(!r)throw err(503,'Owner test tenant is not ready');
     return r;
   }
   let r=await pool.query("SELECT * FROM saas_merchants WHERE clerk_user_id=$1",[userId]);
   if(r.rowCount){
     if(r.rows[0].access_status!=='ACTIVE')throw err(403,'Merchant account is not active');
     return r.rows[0];
   }
   const verifiedEmail=await clerkEmailResolver(userId);
   if(!verifiedEmail)throw err(403,'An approved invitation is required');
   // Binding cannot accept a browser-supplied email. The server fetches the verified
   // identity directly from Clerk. Atomic conditional claim defeats concurrent bindings.
   const c=await pool.connect();
   try{
     await c.query('BEGIN');
     r=await c.query("SELECT * FROM saas_merchants WHERE lower(approved_email)=lower($1) AND access_status IN ('APPROVED','INVITED','ACTIVE') FOR UPDATE",[verifiedEmail]);
     if(r.rowCount!==1)throw err(403,'Your approved merchant invitation was not found');
     if(r.rows[0].clerk_user_id&&r.rows[0].clerk_user_id!==userId)throw err(403,'Invitation is already bound to another account');
     const upd=await c.query("UPDATE saas_merchants SET clerk_user_id=$2,access_status='ACTIVE',updated_at=$3 WHERE id=$1 AND (clerk_user_id IS NULL OR clerk_user_id=$2) RETURNING *",
       [r.rows[0].id,userId,Date.now()]);
     if(!upd.rowCount)throw err(403,'Merchant invitation could not be activated');
     await audit(c,userId,'MERCHANT_IDENTITY_BOUND',r.rows[0].id);
     await c.query('COMMIT');return upd.rows[0];
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 router.post('/public/request-access',wrap(async(req,res)=>{
   // Public request endpoint is intentionally independent of Clerk sign-in.
   const origin=req.get('origin');if(origin){let url;try{url=new URL(origin)}catch{throw err(403,'Invalid request origin')}
      const allowed=new Set([req.get('host'),new URL(process.env.PUBLIC_BASE_URL||'https://disha8-2.thenitishkr.in').host]);
      if(!allowed.has(url.host)||!['https:','http:'].includes(url.protocol))throw err(403,'Request origin not permitted');}
   const key=String(req.ip||req.socket.remoteAddress||'unknown');const ts=Date.now();
   const history=(limiter.get(key)||[]).filter(t=>ts-t<3600000);
   if(history.length>=5)throw err(429,'Too many requests. Please try again later.');
   history.push(ts);limiter.set(key,history);
   if(limiter.size>20000)limiter.clear();
   const body=req.body||{},business=safeName(body.businessName),contact=safeName(body.contactName),email=val(body.email,254).toLowerCase();
   if(business.length<3||contact.length<2||!EMAIL.test(email))throw err(400,'Valid business name, contact and email are required');
   if(JSON.stringify(body).length>7000)throw err(413,'Request too large');
   const request=id('req_');
   await pool.query("INSERT INTO disha_access_requests(id,business_name,contact_name,email,phone,category,estimated_volume,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
    [request,business,contact,email,val(body.phone,30),val(body.category,100),val(body.estimatedVolume,80),ts]);
   res.status(202).set('Cache-Control','no-store').json({success:true,message:'Access request received. Our team will review your application.',reference:request});
 }));
 router.use((req,res,next)=>{
   (async()=>{
     if(!active())throw err(503,'Platform owner access is not activated');
     const subject=getAuth(req)?.userId;
     if(!subject)throw err(401,'Sign in to your account');
     if(!await verifiedOwner(subject))throw err(403,'Platform owner permission required');
     req.ownerUserId=subject;
     await ensureOwnerTestTenant();
     next();
   })().catch(next);
 });
 router.get('/owner/me',wrap(async(req,res)=>{
   const t=await pool.query("SELECT id,business_name,is_internal_test FROM saas_merchants WHERE id=$1 AND is_internal_test=TRUE",[ownerTenantId()]);
   res.set('Cache-Control','no-store').json({success:true,role:'PLATFORM_OWNER',testTenant:t.rows[0]||null});
 }));
 router.get('/owner/overview',wrap(async(req,res)=>{
   const [merchants,requests,orders,incidents]=await Promise.all([
     pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE access_status='ACTIVE' AND is_internal_test=FALSE)::int AS active,count(*) FILTER(WHERE is_internal_test=TRUE)::int AS internal FROM saas_merchants"),
     pool.query("SELECT count(*) FILTER(WHERE status='REQUESTED')::int AS pending FROM disha_access_requests"),
     pool.query("SELECT count(*)::int AS total FROM saas_merchant_orders"),
     pool.query("SELECT count(*) FILTER(WHERE status='OPEN')::int AS open FROM disha_platform_incidents")]);
   res.set('Cache-Control','no-store').json({success:true,metrics:{tenants:merchants.rows[0],requests:requests.rows[0],orders:orders.rows[0],incidents:incidents.rows[0]}});
 }));
 router.get('/owner/requests',wrap(async(req,res)=>{
   const r=await pool.query("SELECT id,business_name,contact_name,email,phone,category,estimated_volume,status,reviewed_at,created_at,merchant_id FROM disha_access_requests ORDER BY created_at DESC LIMIT 150");
   res.set('Cache-Control','no-store').json({success:true,requests:r.rows});
 }));
 router.post('/owner/requests/:id/decision',wrap(async(req,res)=>{
   const choice=val(req.body?.decision,20).toUpperCase();
   if(!['APPROVE','REJECT'].includes(choice))throw err(400,'Choose approve or reject');
   const c=await pool.connect();let merchantId;
   try{
     await c.query('BEGIN');
     const r=await c.query('SELECT * FROM disha_access_requests WHERE id=$1 FOR UPDATE',[req.params.id]);
     if(!r.rowCount)throw err(404,'Access request not found');
     if(r.rows[0].status!=='REQUESTED')throw err(409,'Application has already been reviewed');
     const request=r.rows[0],status=choice==='APPROVE'?'APPROVED':'REJECTED';
     if(choice==='APPROVE'){
       // Invite issuance is a separate explicit action so an external API error
       // cannot roll back the local approval or create inconsistent duplicate tenants.
       const prior=await c.query('SELECT id FROM saas_merchants WHERE lower(approved_email)=lower($1)',[request.email]);
       if(prior.rowCount)throw err(409,'An approved merchant already uses this email');
       merchantId=id('mer_');
       await c.query("INSERT INTO saas_merchants(id,clerk_user_id,business_name,email,approved_email,access_status,approved_by,approved_at,created_at,updated_at) VALUES($1,NULL,$2,$3,$3,'APPROVED',$4,$5,$5,$5)",
         [merchantId,request.business_name,request.email,req.ownerUserId,Date.now()]);
     }
     await c.query("UPDATE disha_access_requests SET status=$2,reviewed_by=$3,reviewed_at=$4,updated_at=$4,merchant_id=$5 WHERE id=$1",
       [request.id,status,req.ownerUserId,Date.now(),merchantId||null]);
     await audit(c,req.ownerUserId,'ACCESS_'+status,request.id,{merchantId});
     await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
   res.json({success:true,status:choice==='APPROVE'?'APPROVED':'REJECTED',merchantId:merchantId||null});
 }));
 router.post('/owner/invite-merchant',wrap(async(req,res)=>{
   // Owner-provisioned invitation. The invited identity still needs verified
   // Clerk sign-in and cannot self-assign a tenant.
   const business=safeName(req.body?.businessName),email=val(req.body?.email,254).toLowerCase();
   if(business.length<3||!EMAIL.test(email))throw err(400,'Business name and valid invited email are required');
   const c=await pool.connect();let tenantId;
   try{
     await c.query('BEGIN');
     const existing=await c.query("SELECT id FROM saas_merchants WHERE lower(approved_email)=lower($1) FOR UPDATE",[email]);
     if(existing.rowCount)throw err(409,'This email already has an approved merchant invitation');
     tenantId=id('mer_');
     await c.query("INSERT INTO saas_merchants(id,clerk_user_id,business_name,email,approved_email,access_status,approved_by,approved_at,created_at,updated_at) "+
       "VALUES($1,NULL,$2,$3,$3,'APPROVED',$4,$5,$5,$5)",
       [tenantId,business,email,req.ownerUserId,Date.now()]);
     await audit(c,req.ownerUserId,'MERCHANT_DIRECT_APPROVAL',tenantId,{email});
     await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
   // External delivery stays an explicit second step, allowing safe retries.
   res.status(201).json({success:true,merchantId:tenantId,status:'APPROVED',next:'Send Clerk invite from Tenant Management'});
 }));
 router.post('/owner/tenants/:id/invite',wrap(async(req,res)=>{
   const target=await pool.query("SELECT id,approved_email,access_status FROM saas_merchants WHERE id=$1 AND is_internal_test=FALSE",[req.params.id]);
   if(!target.rowCount)throw err(404,'Merchant not found');
   const record=target.rows[0];
   if(!['APPROVED','INVITED'].includes(record.access_status)||!record.approved_email)throw err(409,'Merchant is not eligible for invitation');
   if(!process.env.CLERK_SECRET_KEY)throw err(503,'Clerk invitation service unavailable');
   const response=await fetch('https://api.clerk.com/v1/invitations',{method:'POST',headers:{Authorization:'Bearer '+process.env.CLERK_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({email_address:record.approved_email,ignore_existing:true}),signal:AbortSignal.timeout(10000)});
   if(!response.ok){const result=await response.text();throw err(502,'Unable to issue Clerk invitation ('+response.status+')')}
   await pool.query("UPDATE saas_merchants SET access_status='INVITED',updated_at=$2 WHERE id=$1",[record.id,Date.now()]);
   await audit(pool,req.ownerUserId,'CLERK_INVITATION_SENT',record.id);
   res.json({success:true,status:'INVITED'});
 }));
 router.get('/owner/tenants',wrap(async(req,res)=>{
   const r=await pool.query("SELECT id,business_name,email,access_status,is_internal_test,setup_completed,created_at,approved_at FROM saas_merchants ORDER BY is_internal_test DESC,created_at DESC LIMIT 200");
   res.set('Cache-Control','no-store').json({success:true,tenants:r.rows});
 }));
 router.post('/owner/tenants/:id/status',wrap(async(req,res)=>{
   const status=val(req.body?.status,20).toUpperCase();
   if(!['ACTIVE','SUSPENDED'].includes(status))throw err(400,'Invalid tenant status');
   const c=await pool.connect();
   try{await c.query('BEGIN');
     const r=await c.query("UPDATE saas_merchants SET access_status=$2,updated_at=$3 WHERE id=$1 AND is_internal_test=FALSE AND access_status IN ('ACTIVE','SUSPENDED') RETURNING id",[req.params.id,status,Date.now()]);
     if(!r.rowCount)throw err(409,'Tenant is not eligible for this status change');
     await audit(c,req.ownerUserId,'TENANT_'+status,req.params.id);
     await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
   res.json({success:true,status});
 }));
 router.get('/owner/transactions',wrap(async(req,res)=>{
   const r=await pool.query("SELECT o.id,o.merchant_id,m.business_name,o.amount_paise,o.created_at,o.expires_at,s.status,s.utr FROM saas_merchant_orders o JOIN saas_merchants m ON m.id=o.merchant_id JOIN sessions s ON s.session_id=o.session_id ORDER BY o.created_at DESC LIMIT 150");
   res.set('Cache-Control','no-store').json({success:true,transactions:r.rows});
 }));

 router.get('/owner/ledger',wrap(async(req,res)=>{
   const present=await pool.query("SELECT to_regclass('public.disha_core_journals') IS NOT NULL AS ready");
   if(!present.rows[0].ready)return res.set('Cache-Control','no-store').json({success:true,connected:false,journals:[],summary:null});
   const [records,summary]=await Promise.all([
     pool.query("SELECT j.journal_id,j.order_id,j.merchant_id,m.business_name,j.amount_paise,j.state,j.created_at,j.posted_at FROM disha_core_journals j LEFT JOIN saas_merchants m ON m.id=j.merchant_id ORDER BY j.created_at DESC LIMIT 150"),
     pool.query("SELECT count(*) FILTER(WHERE state='POSTED')::int AS posted,count(*)::int AS total,COALESCE(sum(amount_paise) FILTER(WHERE state='POSTED'),0)::text AS posted_paise FROM disha_core_journals")
   ]);
   res.set('Cache-Control','no-store').json({success:true,connected:true,journals:records.rows,summary:summary.rows[0]});
 }));
 router.get('/owner/evidence',wrap(async(req,res)=>{
   const present=await pool.query("SELECT to_regclass('public.disha_vault_evidence') IS NOT NULL AS ready");
   if(!present.rows[0].ready)return res.set('Cache-Control','no-store').json({success:true,connected:false,evidence:[]});
   const r=await pool.query("SELECT o.id AS order_id,m.business_name,v.outcome,v.utr_candidate,v.created_at,s.status "+
      "FROM saas_merchant_orders o JOIN saas_merchants m ON m.id=o.merchant_id JOIN sessions s ON s.session_id=o.session_id "+
      "JOIN LATERAL(SELECT outcome,utr_candidate,created_at FROM disha_vault_evidence WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) v ON TRUE "+
      "ORDER BY v.created_at DESC LIMIT 150");
   res.set('Cache-Control','no-store').json({success:true,connected:true,evidence:r.rows});
 }));
 router.post('/owner/incidents/:id/status',wrap(async(req,res)=>{
   const status=val(req.body?.status,20).toUpperCase();
   if(!['ACKNOWLEDGED','RESOLVED','OPEN'].includes(status))throw err(400,'Invalid incident status');
   const c=await pool.connect();
   try{await c.query('BEGIN');const update=await c.query("UPDATE disha_platform_incidents SET status=$2,updated_at=$3 WHERE id=$1 RETURNING id",[req.params.id,status,Date.now()]);
     if(!update.rowCount)throw err(404,'Incident not found');
     await audit(c,req.ownerUserId,'INCIDENT_'+status,req.params.id);
     await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
   res.json({success:true,status});
 }));

 router.get('/owner/incidents',wrap(async(req,res)=>{
   const r=await pool.query("SELECT * FROM disha_platform_incidents ORDER BY created_at DESC LIMIT 100");
   res.set('Cache-Control','no-store').json({success:true,incidents:r.rows,telemetry:{application:'NOT_CONNECTED',frontend:'NOT_CONNECTED',deployment:'NOT_CONNECTED'}});
 }));
 router.get('/owner/audit',wrap(async(req,res)=>{
   const r=await pool.query("SELECT id,actor_id,action,target_id,created_at FROM disha_platform_audit ORDER BY created_at DESC LIMIT 200");
   res.set('Cache-Control','no-store').json({success:true,events:r.rows});
 }));
 router.use((error,req,res,next)=>{if(res.headersSent)return next(error);if(!error.status||error.status>=500)console.error('[Platform Control]',error.message);res.status(error.status||500).set('Cache-Control','no-store').json({success:false,error:error.status?error.message:'Platform service unavailable'});});
 return {router,init,verifyMerchant,isOwner,active};
}
module.exports={createPlatformControl};
