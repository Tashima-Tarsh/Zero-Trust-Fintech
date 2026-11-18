'use strict';
const assert=require('node:assert/strict');
const {createPlatformControl}=require('../platform-control');
(async()=>{
 const database={pgPool:null};
 let queries=0;
 const pool={query:async()=>{queries++;return {rows:[],rowCount:0}}};
 const control=createPlatformControl({db:database,getAuth:()=>({userId:null})});
 database.pgPool=pool; // mimics asynchronous db.initDb() after construction
 await control.init();
 assert.ok(queries>=1,'PostgreSQL initialization must use the pool assigned after router construction');
 console.log('PLATFORM_POOL_LATE_INIT_PASS: owner control uses the live PostgreSQL connection');
})().catch(err=>{console.error(err);process.exitCode=1});
