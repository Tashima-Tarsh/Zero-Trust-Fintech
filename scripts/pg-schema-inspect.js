'use strict';
// Safe metadata-only diagnostic; no schema or payment records are modified.
const {Pool}=require('pg');
(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try{
    const r=await pool.query(
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns " +
      "WHERE table_schema='public' AND table_name IN ('sessions','vpa_pool','accounts','transactions','ledger_entries'," +
      "'passkeys','utr_order_bindings','vpa_hourly_txns','session_cooldowns','gaming_companies','ip_whitelist') " +
      "ORDER BY table_name,ordinal_position"
    );
    const grouped={};
    for(const x of r.rows)(grouped[x.table_name]||=[]).push(x.column_name+':'+x.data_type);
    console.log('PG_SCHEMA_METADATA_ONLY',JSON.stringify(grouped));
  }finally {await pool.end();}
})().catch(err=>{console.error('PG_SCHEMA_INSPECTION_FAILED',err.message);process.exitCode=1;});
