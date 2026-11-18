#!/usr/bin/env node
'use strict';
/**
 * Controlled SQLite -> PostgreSQL checkout migration.
 *
 * Default: preflight ONLY. No database writes.
 * Apply: MIGRATION_ACK=BACKUP_VERIFIED node scripts/migrate-sqlite-to-postgres.js --apply
 *
 * Run against the EXISTING mounted SQLite volume during a write freeze.
 * This script never overwrites or deletes SQLite. The PostgreSQL import runs
 * as one transaction and is rolled back if any record fails verification.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const {Pool}=require('pg');

const source=process.env.SQLITE_SOURCE_PATH || '/data/disha82.db';
const apply=process.argv.includes('--apply');
const tables=[
  'accounts','vpa_pool','vpa_usage_log','vpa_health_events','vpa_sender_tracking',
  'sessions','passkeys','transactions','ledger_entries','blacklist_utrs',
  'utr_order_bindings','vpa_hourly_txns','session_cooldowns','image_hashes',
  'gaming_companies','ip_whitelist','api_access_log','blocked_ip_attempts'
];
const booleanCols={ip_whitelist:['is_active']};
const quote=id=>'"'+id.replace(/"/g,'""')+'"';
const keyFor={
  accounts:['id'],vpa_pool:['id'],vpa_usage_log:['id'],vpa_health_events:['id'],
  vpa_sender_tracking:['id'],sessions:['session_id'],passkeys:['id'],
  transactions:['id'],ledger_entries:['id'],blacklist_utrs:['utr'],
  utr_order_bindings:['utr'],vpa_hourly_txns:['vpa_address','hour_bucket'],
  session_cooldowns:['order_id'],image_hashes:['id'],gaming_companies:['id'],
  ip_whitelist:['id'],api_access_log:['id'],blocked_ip_attempts:['id']
};

function readSql(name){return fs.readFileSync(path.join(__dirname,'..',name),'utf8');}
function sourceTableExists(db,name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function sourceRows(db,name) {
  return sourceTableExists(db,name)?db.prepare('SELECT * FROM '+quote(name)).all():[];
}
function normalize(value,kind) {
  if(value==null)return null;
  if(kind==='boolean')return value===true||value===1||value==='1'?'true':'false';
  if(typeof value==='number')return String(value);
  if(typeof value==='bigint')return value.toString();
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='string' && /^-?\d+(\.\d+)?$/.test(value)) {
    // Stable canonical numeric comparison for PostgreSQL NUMERIC and SQLite REAL.
    const [whole, frac='']=value.split('.');
    return BigInt(whole).toString()+(frac.replace(/0+$/,'') ? '.'+frac.replace(/0+$/,''):'');
  }
  return String(value);
}

async function main() {
  if(!fs.existsSync(source))throw Error('SQLite source missing: '+source);
  const stat=fs.statSync(source);
  if(!stat.isFile())throw Error('SQLite source is not a file: '+source);
  const sqlite=new DatabaseSync(source,{readOnly:true});
  try {
    const integrity=sqlite.prepare('PRAGMA integrity_check').get();
    if(integrity.integrity_check!=='ok')throw Error('SQLite integrity check failed');
    const inventory={};
    for(const t of tables)inventory[t]=sourceRows(sqlite,t).length;
    console.log('SQLite source integrity: OK');
    console.log('SQLite inventory (row counts only):',JSON.stringify(inventory));
    console.log('Total rows:',Object.values(inventory).reduce((a,b)=>a+b,0));
    if(!apply) {
      console.log('DRY RUN: no migration performed. Freeze checkout writes, take an independent backup, then run with --apply.');
      return;
    }
    if(process.env.MIGRATION_ACK!=='BACKUP_VERIFIED') {
      throw Error('Migration requires MIGRATION_ACK=BACKUP_VERIFIED after independent backup and write freeze');
    }
    if(!process.env.DATABASE_URL)throw Error('DATABASE_URL not supplied');
    const target=path.join(path.dirname(source),'disha82-pre-postgres-'+Date.now()+'.db');
    // Online SQLite backup API includes WAL content in a consistent snapshot.
    await backup(sqlite,target);
    const snapshot=new DatabaseSync(target,{readOnly:true});
    try {
      if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite snapshot invalid');
    }finally {snapshot.close();}
    console.log('Preservation snapshot created:',target);
    const pg=new Pool({connectionString:process.env.DATABASE_URL,max:1});
    const client=await pg.connect();
    let begun=false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      begun=true;
      await client.query(readSql('schema.sql'));
      await client.query(readSql('migrations/001_financial_core.sql'));
      await client.query(readSql('migrations/002_postgres_checkout.sql'));
      const totals={};
      // Insert from a single coherent snapshot (not the active SQLite file).
      const snap=new DatabaseSync(target,{readOnly:true});
      try {
        for(const table of tables) {
          const rows=sourceRows(snap,table);
          for(const row of rows) {
            const columns=Object.keys(row);
            const values=columns.map(col=> {
              const v=row[col];
              if(booleanCols[table]?.includes(col))return v===1||v===true;
              return v;
            });
            const keys=keyFor[table];
            const where=keys.map((col,i)=>quote(col)+'=
          }
          // Verify every source primary key has exactly one target row AND
          // all common fields match. Abort on divergent existing data.
          const keys=keyFor[table];
          for(const row of rows) {
            const where=keys.map((col,i)=>quote(col)+'=$'+(i+1)).join(' AND ');
            const result=await client.query('SELECT * FROM '+quote(table)+' WHERE '+where,
              keys.map(k=>row[k]));
            if(result.rowCount!==1)throw Error('Row missing/colliding: '+table);
            const dest=result.rows[0];
            for(const [col,value] of Object.entries(row)) {
              const expected=normalize(value,booleanCols[table]?.includes(col)?'boolean':'');
              const actual=normalize(dest[col],booleanCols[table]?.includes(col)?'boolean':'');
              if(expected!==actual)throw Error('Data mismatch in table '+table+' column '+col);
            }
          }
          totals[table]=rows.length;
        }
      } finally {snap.close();}
      // All source objects accounted for before a single commit.
      await client.query('COMMIT');
      begun=false;
      console.log('POSTGRES_MIGRATION_VERIFIED',JSON.stringify(totals));
      console.log('Keep SQLITE_SOURCE_PATH and snapshot for rollback. Only then enable DB_BACKEND=postgres.');
    } catch(e) {
      if(begun)try{await client.query('ROLLBACK');}catch(_){}
      throw e;
    } finally {client.release();await pg.end();}
  } finally {sqlite.close();}
}
main().catch(e=>{console.error('MIGRATION_ABORTED:',e.message);process.exitCode=1;});
+(i+1)).join(' AND ');
            const existing=await client.query(
              'SELECT * FROM '+quote(table)+' WHERE '+where,keys.map(col=>row[col]));
            if(existing.rowCount>0 && ['accounts','vpa_pool'].includes(table) &&
                String(existing.rows[0].created_at)==='1700000000000') {
              // Only replace known built-in placeholder seeds. Never overwrite
              // merchant-maintained PostgreSQL records or previously imported data.
              const fields=columns.filter(col=>!keys.includes(col));
              await client.query(
                'UPDATE '+quote(table)+' SET '+
                fields.map((col,i)=>quote(col)+'=
          }
          // Verify every source primary key has exactly one target row AND
          // all common fields match. Abort on divergent existing data.
          const keys=keyFor[table];
          for(const row of rows) {
            const where=keys.map((col,i)=>quote(col)+'=$'+(i+1)).join(' AND ');
            const result=await client.query('SELECT * FROM '+quote(table)+' WHERE '+where,
              keys.map(k=>row[k]));
            if(result.rowCount!==1)throw Error('Row missing/colliding: '+table);
            const dest=result.rows[0];
            for(const [col,value] of Object.entries(row)) {
              const expected=normalize(value,booleanCols[table]?.includes(col)?'boolean':'');
              const actual=normalize(dest[col],booleanCols[table]?.includes(col)?'boolean':'');
              if(expected!==actual)throw Error('Data mismatch in table '+table+' column '+col);
            }
          }
          totals[table]=rows.length;
        }
      } finally {snap.close();}
      // All source objects accounted for before a single commit.
      await client.query('COMMIT');
      begun=false;
      console.log('POSTGRES_MIGRATION_VERIFIED',JSON.stringify(totals));
      console.log('Keep SQLITE_SOURCE_PATH and snapshot for rollback. Only then enable DB_BACKEND=postgres.');
    } catch(e) {
      if(begun)try{await client.query('ROLLBACK');}catch(_){}
      throw e;
    } finally {client.release();await pg.end();}
  } finally {sqlite.close();}
}
main().catch(e=>{console.error('MIGRATION_ABORTED:',e.message);process.exitCode=1;});
+(i+1)).join(',')+
                ' WHERE '+keys.map((col,i)=>quote(col)+'=
          }
          // Verify every source primary key has exactly one target row AND
          // all common fields match. Abort on divergent existing data.
          const keys=keyFor[table];
          for(const row of rows) {
            const where=keys.map((col,i)=>quote(col)+'=$'+(i+1)).join(' AND ');
            const result=await client.query('SELECT * FROM '+quote(table)+' WHERE '+where,
              keys.map(k=>row[k]));
            if(result.rowCount!==1)throw Error('Row missing/colliding: '+table);
            const dest=result.rows[0];
            for(const [col,value] of Object.entries(row)) {
              const expected=normalize(value,booleanCols[table]?.includes(col)?'boolean':'');
              const actual=normalize(dest[col],booleanCols[table]?.includes(col)?'boolean':'');
              if(expected!==actual)throw Error('Data mismatch in table '+table+' column '+col);
            }
          }
          totals[table]=rows.length;
        }
      } finally {snap.close();}
      // All source objects accounted for before a single commit.
      await client.query('COMMIT');
      begun=false;
      console.log('POSTGRES_MIGRATION_VERIFIED',JSON.stringify(totals));
      console.log('Keep SQLITE_SOURCE_PATH and snapshot for rollback. Only then enable DB_BACKEND=postgres.');
    } catch(e) {
      if(begun)try{await client.query('ROLLBACK');}catch(_){}
      throw e;
    } finally {client.release();await pg.end();}
  } finally {sqlite.close();}
}
main().catch(e=>{console.error('MIGRATION_ABORTED:',e.message);process.exitCode=1;});
+(fields.length+i+1)).join(' AND '),
                fields.map(col=> {
                  const v=row[col];
                  return booleanCols[table]?.includes(col)?(v===1||v===true):v;
                }).concat(keys.map(col=>row[col]))
              );
            } else {
              const sql='INSERT INTO '+quote(table)+' ('+columns.map(quote).join(',')+') VALUES ('+
                columns.map((_,i)=>'
          }
          // Verify every source primary key has exactly one target row AND
          // all common fields match. Abort on divergent existing data.
          const keys=keyFor[table];
          for(const row of rows) {
            const where=keys.map((col,i)=>quote(col)+'=$'+(i+1)).join(' AND ');
            const result=await client.query('SELECT * FROM '+quote(table)+' WHERE '+where,
              keys.map(k=>row[k]));
            if(result.rowCount!==1)throw Error('Row missing/colliding: '+table);
            const dest=result.rows[0];
            for(const [col,value] of Object.entries(row)) {
              const expected=normalize(value,booleanCols[table]?.includes(col)?'boolean':'');
              const actual=normalize(dest[col],booleanCols[table]?.includes(col)?'boolean':'');
              if(expected!==actual)throw Error('Data mismatch in table '+table+' column '+col);
            }
          }
          totals[table]=rows.length;
        }
      } finally {snap.close();}
      // All source objects accounted for before a single commit.
      await client.query('COMMIT');
      begun=false;
      console.log('POSTGRES_MIGRATION_VERIFIED',JSON.stringify(totals));
      console.log('Keep SQLITE_SOURCE_PATH and snapshot for rollback. Only then enable DB_BACKEND=postgres.');
    } catch(e) {
      if(begun)try{await client.query('ROLLBACK');}catch(_){}
      throw e;
    } finally {client.release();await pg.end();}
  } finally {sqlite.close();}
}
main().catch(e=>{console.error('MIGRATION_ABORTED:',e.message);process.exitCode=1;});
+(i+1)).join(',')+') ON CONFLICT DO NOTHING';
              await client.query(sql,values);
            }
          }
          // Verify every source primary key has exactly one target row AND
          // all common fields match. Abort on divergent existing data.
          const keys=keyFor[table];
          for(const row of rows) {
            const where=keys.map((col,i)=>quote(col)+'=$'+(i+1)).join(' AND ');
            const result=await client.query('SELECT * FROM '+quote(table)+' WHERE '+where,
              keys.map(k=>row[k]));
            if(result.rowCount!==1)throw Error('Row missing/colliding: '+table);
            const dest=result.rows[0];
            for(const [col,value] of Object.entries(row)) {
              const expected=normalize(value,booleanCols[table]?.includes(col)?'boolean':'');
              const actual=normalize(dest[col],booleanCols[table]?.includes(col)?'boolean':'');
              if(expected!==actual)throw Error('Data mismatch in table '+table+' column '+col);
            }
          }
          totals[table]=rows.length;
        }
      } finally {snap.close();}
      // All source objects accounted for before a single commit.
      await client.query('COMMIT');
      begun=false;
      console.log('POSTGRES_MIGRATION_VERIFIED',JSON.stringify(totals));
      console.log('Keep SQLITE_SOURCE_PATH and snapshot for rollback. Only then enable DB_BACKEND=postgres.');
    } catch(e) {
      if(begun)try{await client.query('ROLLBACK');}catch(_){}
      throw e;
    } finally {client.release();await pg.end();}
  } finally {sqlite.close();}
}
main().catch(e=>{console.error('MIGRATION_ABORTED:',e.message);process.exitCode=1;});
