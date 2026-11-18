'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {Pool}=require('pg');

(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))throw Error('Local disposable PostgreSQL only');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'disha-pg-migration-'));
 const sqlitePath=path.join(root,'disha82.db');
 const sessionId='sess_'+crypto.randomUUID().replace(/-/g,'');
 const orderId='order_'+crypto.randomUUID().replace(/-/g,'');
 const pkId='pk_'+crypto.randomUUID().replace(/-/g,'');
 const db=new DatabaseSync(sqlitePath);
 db.exec('CREATE TABLE sessions (session_id TEXT PRIMARY KEY,order_id TEXT,challenge_amount REAL,base_amount REAL,txn_ref TEXT,vpa_address TEXT,status TEXT,state TEXT,customer_id TEXT,utr TEXT,created_at INTEGER,expires_at INTEGER,qr_refresh_at INTEGER)');
 db.exec('CREATE TABLE passkeys (id TEXT PRIMARY KEY,user_id TEXT,credential_id TEXT,public_key TEXT,counter INTEGER,device_type TEXT,backed_up INTEGER,transports TEXT,created_at INTEGER,sign_count INTEGER)');
 const now=Date.now();
 db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sessionId,orderId,501.02,501.02,
  'ref_'+orderId,'testing@upi','PENDING','WAITING',null,null,now,now+180000,now+15000);
 db.prepare('INSERT INTO passkeys VALUES (?,?,?,?,?,?,?,?,?,?)').run(pkId,'user_'+orderId,
  'cred_'+orderId,'cHVibGlj',0,'singleDevice',0,'internal',now,0);
 db.close();
 const script=path.join(__dirname,'..','scripts','migrate-sqlite-to-postgres.js');
 const env={...process.env,DATABASE_URL:url,SQLITE_SOURCE_PATH:sqlitePath,MIGRATION_ACK:'BACKUP_VERIFIED'};
 const pool=new Pool({connectionString:url});
 try {
  const before=execFileSync(process.execPath,[script],{env,encoding:'utf8'});
  assert.match(before,/DRY RUN/);
  let r=await pool.query('SELECT 1 FROM sessions WHERE order_id=$1',[orderId]).catch(()=>({rows:[]}));
  assert.equal(r.rows.length,0,'Dry-run must not import data');
  const output=execFileSync(process.execPath,[script,'--apply'],{env,encoding:'utf8'});
  assert.match(output,/POSTGRES_MIGRATION_VERIFIED/);
  r=await pool.query('SELECT * FROM sessions WHERE order_id=$1',[orderId]);
  assert.equal(r.rows.length,1);
  assert.equal(r.rows[0].challenge_amount,'501.02');
  const pk=await pool.query('SELECT * FROM passkeys WHERE id=$1',[pkId]);
  assert.equal(pk.rows.length,1);
  assert.equal(pk.rows[0].credential_id,'cred_'+orderId);
  assert.equal(fs.existsSync(sqlitePath),true,'Source SQLite file must remain untouched');
  assert.equal(fs.readdirSync(root).some(x=>x.startsWith('disha82-pre-postgres-')),true,
    'Consistent preserved snapshot must exist');
  console.log('Postgres migration dry-run, snapshot, source parity and atomic import PASS');
 }finally{await pool.end();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
