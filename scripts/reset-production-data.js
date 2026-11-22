#!/usr/bin/env node
'use strict';
/**
 * DISHA 8.2: controlled financial + merchant data reset.
 * Never called by server startup, migrations, CI or health checks.
 *
 * DRY RUN: node scripts/reset-production-data.js
 * APPLY requires all of:
 *   --apply
 *   DISHA_RESET_CONFIRM=ERASE_DISHA_PRODUCTION_RECORDS
 *   DISHA_RESET_BACKUP_VERIFIED=<nonempty backup reference>
 *   DISHA_MAINTENANCE_MODE=true
 *
 * An independently verified Railway Postgres volume backup is a prerequisite.
 * The script intentionally does not claim to create or verify that backup.
 * Keeps chart-of-account definitions, migration-control state and owner profile;
 * owner personal/company tenants are re-provisioned by Platform Control startup.
 */
const {Pool}=require('pg');
const targets=[
 'api_access_log','blacklist_utrs','blocked_ip_attempts',
 'disha_access_requests','disha_core_journals','disha_core_postings',
 'disha_platform_audit','disha_platform_incidents',
 'disha_reconciliation_inbox','disha_vault_authorizations','disha_vault_evidence',
 'gaming_companies','image_hashes','ip_whitelist','ledger_entries','passkeys',
 'saas_merchant_ips','saas_merchant_notifications','saas_merchant_orders',
 'saas_merchant_vpas','saas_merchants','session_cooldowns','sessions',
 'transactions','utr_order_bindings','vpa_health_events','vpa_hourly_txns',
 'vpa_pool','vpa_sender_tracking','vpa_usage_log'
];
const preserved=[
 'accounts','disha_core_accounts','disha_migration_control','disha_owner_profile'
];
function fail(message){throw Error('RESET_REFUSED: '+message)}
async function main(){
 const apply=process.argv.includes('--apply');
 if(apply){
   if(process.env.DISHA_RESET_CONFIRM!=='ERASE_DISHA_PRODUCTION_RECORDS')
     fail('Explicit one-time reset confirmation missing');
   if(!process.env.DISHA_RESET_BACKUP_VERIFIED?.trim())
     fail('Verified backup reference missing. Take and verify a Railway PostgreSQL volume backup first');
   if(process.env.DISHA_MAINTENANCE_MODE!=='true')
     fail('Maintenance mode is required; live payment requests must be stopped');
 }
 if(!process.env.DATABASE_URL)fail('DATABASE_URL missing');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,max:1});
 const client=await pool.connect();
 try{
   await client.query('BEGIN');
   await client.query("SET LOCAL lock_timeout='10s'");
   await client.query("SET LOCAL statement_timeout='120s'");
   const actual=(await client.query(
     "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename"
   )).rows.map(x=>x.tablename);
   const unknown=actual.filter(x=>!targets.includes(x)&&!preserved.includes(x));
   if(unknown.length)fail('Unknown production tables need manual classification: '+unknown.join(', '));
   const found=targets.filter(x=>actual.includes(x));
   const counts={};
   for(const table of found){
     const row=(await client.query('SELECT count(*)::text AS n FROM public."'+table+'"')).rows[0];
     counts[table]=Number(row.n);
   }
   const total=Object.values(counts).reduce((a,b)=>a+b,0);
   console.log('DISHA_RESET_INVENTORY',JSON.stringify({
     mode:apply?'APPLY':'DRY_RUN',
     targetTableCount:found.length,rowCount:total,counts,
     preservedTables:preserved.filter(x=>actual.includes(x)),
     missingTables:targets.filter(x=>!actual.includes(x))
   }));
   if(!apply){
     await client.query('ROLLBACK');
     console.log('DISHA_RESET_DRY_RUN_ONLY: no rows modified');
     return;
   }
   if(found.length===0)fail('No recognized DISHA production tables present');
   // TRUNCATE respects FK table ownership. RESTRICT is deliberate: if any other
   // table references these records, the reset fails rather than cascading
   // unexpectedly into unknown data. All target tables are one atomic change.
   await client.query('TRUNCATE TABLE '+found.map(x=>'public."'+x+'"').join(', ')+' RESTART IDENTITY RESTRICT');
   for(const name of found){
     const n=(await client.query('SELECT count(*)::text AS n FROM public."'+name+'"')).rows[0].n;
     if(n!=='0')fail('Verification failed: '+name+' still has rows');
   }
   const marker=(await client.query("SELECT to_regclass('public.disha_migration_control') AS marker")).rows[0]?.marker;
   if(!marker)fail('Postgres migration control marker missing; refuse destructive operation');
   await client.query('COMMIT');
   console.log('DISHA_RESET_COMMITTED',JSON.stringify({
     deletedRows:total,clearedTables:found.length,
     backupReference:process.env.DISHA_RESET_BACKUP_VERIFIED,
     next:'Restart the production app to re-provision only the owner and paused company tenant'
   }));
 }catch(error){
   try{await client.query('ROLLBACK')}catch{}
   throw error;
 }finally{
   client.release();
   await pool.end();
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
