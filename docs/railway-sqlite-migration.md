# Railway SQLite migration — preserve existing checkout data

**Current state**: the Railway service already mounts a persistent volume at `/data`, but `db.js` still opens `/app/disha82.db`. That file is on the ephemeral container filesystem.

Do not merge the persistent-storage PR before creating a consistent backup inside the currently running container. Old container files are not reliably transferred into the next deployment. If historical data was lost in an earlier deployment, the migration cannot recover it.

## 1. Pause live checkout activity

Use a maintenance window and ensure no new sessions or payment updates occur between backup and deploying the new revision.

## 2. Connect to the current running production container

From a terminal with the Railway CLI installed and authenticated:

```powershell
railway ssh --project 62335465-abaa-4269-ba72-e87ddbba908c --service a487c30e-0424-4bc9-af3a-0ccc9943cf70 --environment production
```

Once in the **remote Linux shell**, paste this *entire line* to take a concurrency-safe SQLite backup; it will not overwrite any existing volume database:

```bash
node -e 'const {DatabaseSync,backup}=require("node:sqlite");const fs=require("node:fs");(async()=>{const source="/app/disha82.db",target="/data/disha82.db";if(!fs.existsSync(source))throw Error("SOURCE_MISSING");if(!fs.existsSync("/data"))throw Error("VOLUME_NOT_MOUNTED");if(fs.existsSync(target))throw Error("TARGET_ALREADY_EXISTS: do not overwrite");const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,target)}finally{db.close()}const check=new DatabaseSync(target,{readOnly:true});try{const integrity=check.prepare("PRAGMA integrity_check").get();if(integrity.integrity_check!=="ok")throw Error("INTEGRITY_CHECK_FAILED");for(const table of ["sessions","passkeys","transactions"]){try{console.log(table,check.prepare("SELECT COUNT(*) AS total FROM "+table).get().total)}catch(e){console.log(table,"table not present")}}console.log("BACKUP_OK",target)}finally{check.close()}})().catch(e=>{console.error("BACKUP_FAILED:",e.message);process.exitCode=1})'
```

Expected output: `BACKUP_OK /data/disha82.db` and counts. If `TARGET_ALREADY_EXISTS` or `SOURCE_MISSING` appears, stop and investigate before merging. Do not delete or overwrite either file.

An additional encrypted off-Railway backup is strongly recommended.

## 3. Merge after a successful backup

Merge the GitHub PR that points `db.js` at the mounted `/data/disha82.db`. The code fails closed in production when the existing file is absent, unless a deliberately new environment explicitly sets `SQLITE_BOOTSTRAP_NEW_DB=true`.

## 4. Check post-deploy logs and continuity

Expected log: `Initialized Native SQLite Store at /data/disha82.db`. Confirm `/health`, historical session availability, and a non-payment end-to-end checkout page flow.

Keep `SQLITE_BOOTSTRAP_NEW_DB` unset or false in production. Do not delete the original or backup until data continuity is independently verified.
