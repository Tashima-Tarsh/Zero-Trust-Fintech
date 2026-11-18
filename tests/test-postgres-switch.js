'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))throw Error('Local PostgreSQL only');
 process.env.DB_BACKEND='postgres';
 process.env.DATABASE_URL=url;
 const db=require('../db');
 await db.initDb();
 assert.equal(db.isPostgres,true);
 assert.equal(db.sqliteDb,null,'PostgreSQL-only mode must never open a shadow SQLite database');
 assert.ok(db.pgPool);
 const marker=await db.pgPool.query("SELECT payload FROM disha_migration_control WHERE name='sqlite_to_postgres_verified'");
 assert.equal(marker.rowCount,1);
 const id='pg_switch_'+Date.now();
 await db.saveSession({sessionId:id,orderId:id,challengeAmount:'15.01',baseAmount:'15.01',txnRef:id+'_utr',
 vpaAddress:'testing@upi',status:'PENDING',state:'WAITING',
 createdAt:Date.now(),expiresAt:Date.now()+180000,qrRefreshAt:Date.now()+15000});
 const read=await db.findSessionByOrderId(id);
 assert.equal(read.orderId,id);
 console.log('PostgreSQL-only switch and migration marker: PASS');
 await db.pgPool.end();
})().catch(e=>{console.error(e);process.exitCode=1;});
