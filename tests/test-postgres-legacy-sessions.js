'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url || !['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))throw Error('CI local postgres only');
 const pool=new Pool({connectionString:url});
 const c=await pool.connect(),schema='legacy_'+crypto.randomBytes(6).toString('hex');
 let active=false;
 try{
  await c.query('BEGIN');active=true;
  await c.query('CREATE SCHEMA '+schema);
  await c.query('SET LOCAL search_path TO '+schema);
  await c.query('CREATE TABLE sessions (session_id TEXT PRIMARY KEY,order_id TEXT,challenge_amount NUMERIC,base_amount NUMERIC,txn_ref TEXT,vpa_address TEXT,status TEXT,utr TEXT,created_at BIGINT,expires_at BIGINT,qr_refresh_at BIGINT)');
  await c.query('CREATE TABLE vpa_pool (id TEXT PRIMARY KEY,vpa_address TEXT)');
  await c.query('CREATE TABLE disha_core_accounts (account_id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,account_type TEXT NOT NULL)');
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations','002_postgres_checkout.sql'),'utf8');
  await c.query(sql);
  await c.query(sql); // Must remain idempotent.
  const r=await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='sessions'",[schema]);
  const cols=new Set(r.rows.map(x=>x.column_name));
  assert.ok(cols.has('state') && cols.has('customer_id') && cols.has('upi_uri'));
  await c.query("INSERT INTO sessions(session_id,order_id,challenge_amount,base_amount,txn_ref,vpa_address,status,created_at,expires_at,qr_refresh_at) VALUES('legacy','order',100,100,'tr','test@upi','PENDING',0,1000,0)");
  const row=await c.query("SELECT state,customer_id,upi_uri FROM sessions WHERE session_id='legacy'");
  assert.equal(row.rows[0].state,'WAITING');
  assert.equal(row.rows[0].customer_id,null);
  assert.equal(row.rows[0].upi_uri,null,'Legacy records are preserved without fabricated QR snapshots');
  console.log('Legacy production sessions migration: two-pass idempotence and default state PASS');
 }finally{
  if(active)try{await c.query('ROLLBACK');}catch(_){}
  c.release();await pool.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
