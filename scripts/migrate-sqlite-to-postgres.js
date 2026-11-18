#!/usr/bin/env node
'use strict';
// Controlled, fail-closed migration. Defaults to read-only inventory.
// A write freeze and off-service backup are required before --apply.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const {Pool}=require('pg');
const source=process.env.SQLITE_SOURCE_PATH||'/data/disha82.db';
const names=['accounts','vpa_pool','vpa_usage_log','vpa_health_events',
'vpa_sender_tracking','sessions','passkeys','transactions','ledger_entries',
'blacklist_utrs','utr_order_bindings','vpa_hourly_txns','session_cooldowns',
'image_hashes','gaming_companies','ip_whitelist','api_access_log','blocked_ip_attempts'];
const keys={sessions:['session_id'],passkeys:['id'],blacklist_utrs:['utr'],
utr_order_bindings:['utr'],vpa_hourly_txns:['vpa_address','hour_bucket'],
session_cooldowns:['order_id']};
const q=s=>'"'+s.replace(/"/g,'""')+'"';
const sql=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const rows=(db,t)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
 ?db.prepare('SELECT * FROM '+q(t)).all():[];
const normalize=v=>v===null||v===undefined?null:
 typeof v==='boolean'?(v?'1':'0'):
 typeof v==='number'?v.toString():
 typeof v==='string'&&/^-?[0-9]+(\.[0-9]+)?$/.test(v)
 ?String(Number(v)):String(v);
async function main(){
 if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw Error('SOURCE_NOT_FOUND');
 const db=new DatabaseSync(source,{readOnly:true});
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SOURCE_CORRUPT');
  const counts=Object.fromEntries(names.map(t=>[t,rows(db,t).length]));
  console.log('SQLITE_INTEGRITY_OK',JSON.stringify(counts));
  if(!process.argv.includes('--apply')){console.log('DRY_RUN_ONLY');return;}
  if(process.env.MIGRATION_ACK!=='BACKUP_VERIFIED'||!process.env.DATABASE_URL)
   throw Error('Requires backup, frozen writes, MIGRATION_ACK and DATABASE_URL');
  const copy=path.join(path.dirname(source),'disha82-pre-postgres-'+Date.now()+'.db');
  await backup(db,copy);
  const snapshot=new DatabaseSync(copy,{readOnly:true});
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  try{
   if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SNAPSHOT_CORRUPT');
   const client=await pool.connect();let tx=false;
   try{
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');tx=true;
    for(const filename of ['schema.sql','migrations/001_financial_core.sql','migrations/002_postgres_checkout.sql'])
     await client.query(sql(filename));
    for(const table of names){
     const primary=keys[table]||['id'];
     for(const row of rows(snapshot,table)){
      const cols=Object.keys(row);
      const vals=cols.map(c=>table==='ip_whitelist'&&c==='is_active'?Boolean(row[c]):row[c]);
      const where=primary.map((k,i)=>q(k)+'=$'+(i+1)).join(' AND ');
      const present=await client.query('SELECT * FROM '+q(table)+' WHERE '+where,primary.map(k=>row[k]));
      if(present.rowCount&&['accounts','vpa_pool'].includes(table)&&
         String(present.rows[0].created_at)==='1700000000000'){
       const fields=cols.filter(c=>!primary.includes(c));
       const sets=fields.map((c,i)=>q(c)+'=$'+(i+1)).join(',');
       await client.query('UPDATE '+q(table)+' SET '+sets+' WHERE '+
         primary.map((k,i)=>q(k)+'=$'+(fields.length+i+1)).join(' AND '),
         fields.map(c=>row[c]).concat(primary.map(k=>row[k])));
      }else{
       await client.query('INSERT INTO '+q(table)+' ('+cols.map(q).join(',')+') VALUES ('+
         cols.map((_,i)=>'$'+(i+1)).join(',')+') ON CONFLICT DO NOTHING',vals);
      }
      const check=await client.query('SELECT * FROM '+q(table)+' WHERE '+where,primary.map(k=>row[k]));
      if(check.rowCount!==1)throw Error('ROW_MISSING:'+table);
      for(const col of cols){
       if(normalize(row[col])!==normalize(check.rows[0][col]))
        throw Error('DATA_MISMATCH:'+table+':'+col);
      }
     }
    }
    await client.query('COMMIT');tx=false;
    console.log('POSTGRES_MIGRATION_VERIFIED',JSON.stringify(counts));
    console.log('SQLITE_SNAPSHOT_PRESERVED',copy);
   }catch(e){if(tx)try{await client.query('ROLLBACK');}catch(_){}throw e;}
   finally{client.release();}
  }finally{snapshot.close();await pool.end();}
 }finally{db.close();}
}
main().catch(e=>{console.error('MIGRATION_ABORTED',e.message);process.exitCode=1;});
