'use strict';
// Exercise the real SQLite store in an isolated child process: configured
// account only, legacy built-in example rows paused, and immutable UPI URI.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'disha-upi-snapshot-'));
const inner=`
'use strict';
const assert=require('node:assert/strict'),db=require('./db');
(async()=>{
 await db.initDb();
 const configured='verified-payee@oksbi';
 const active=()=>db.sqliteDb.prepare("SELECT vpa_address FROM vpa_pool WHERE status='ACTIVE'").all().map(x=>x.vpa_address);
 assert.deepEqual(active(),[configured],'Only the explicitly configured VPA may be auto-provisioned');
 const now=Date.now();
 db.sqliteDb.prepare(
  "INSERT INTO vpa_pool (id,vpa_address,holder_name,bank_name,status,health_score,merchant_id,created_at) "+
  "VALUES (?,?,?,'Bank','ACTIVE',99,'mer_default',?)"
 ).run('vpa_axis_01','disha82@okaxis','Old Demo',now);
 db.sqliteDb.close();
 await db.initDb();
 assert.deepEqual(active(),[configured],'Restart must quarantine known demo accounts');
 assert.equal(db.sqliteDb.prepare("SELECT status FROM vpa_pool WHERE id='vpa_axis_01'").get().status,'PAUSED');
 const token='a'.repeat(32),uri='upi://pay?pa=verified-payee@oksbi&pn=Verified%20Payee&am=1.00&cu=INR&tn=Medical&tr=PAYABCDEF12345&mc=8099';
 const payment={sessionId:token,orderId:'PAY_TEST_12345',challengeAmount:1,
  baseAmount:1,txnRef:'PAYABCDEF12345',vpaAddress:configured,upiUri:uri,
  status:'PENDING',state:'WAITING',createdAt:now,expiresAt:now+180000,qrRefreshAt:now+15000};
 db.saveSession(payment);
 assert.equal(db.findSessionByOrderId(payment.orderId).upiUri,uri,'QR must survive session reload');
 assert.equal(db.findSessionByOrderId(payment.orderId).merchantType,'P2M','Merchant classification survives SQLite reload');
 assert.equal(db.findSessionByTxnRef(payment.txnRef).merchantType,'P2M','Txn ref lookup preserves merchant classification');
 assert.equal(db.findSessionByTxnRef(payment.txnRef).upiUri,uri,'Evidence matching must see exact original QR');
 db.saveSession({...payment,upiUri:uri.replace('mc=8099','mc=5812')});
 assert.equal(db.findSessionByOrderId(payment.orderId).upiUri,uri,
  'Existing payment URI is write-once, not editable after issuance');
 // Public personal checkout must not be rejected after save/reload.
 const personalUri='upi://pay?pa=verified-payee@oksbi&pn=Verified%20Payee&am=1.00&cu=INR&tn=Personal';
 const personal={...payment,sessionId:'b'.repeat(32),orderId:'PAY_P2P_12345',
  txnRef:'PAYP2P12345',upiUri:personalUri,merchantType:'PERSONAL'};
 db.saveSession(personal);
 assert.equal(db.findSessionByOrderId(personal.orderId).merchantType,'P2P',
   'SQLite personal payment type survives database reload');
 assert.equal(db.findSessionByOrderId(personal.orderId).upiUri,personalUri,
   'P2P QR must not gain a merchant MCC or TR');
 assert.equal(db.findSessionByTxnRef(personal.txnRef).merchantType,'P2P');
 const stored=db.sqliteDb.prepare('SELECT payment_type,upi_uri FROM sessions WHERE order_id=?').get(personal.orderId);
 assert.equal(stored.payment_type,'P2P','Persist the personal classification');
 db.sqliteDb.prepare('UPDATE sessions SET payment_type=NULL WHERE order_id=?').run(personal.orderId);
 assert.equal(db.findSessionByOrderId(personal.orderId).merchantType,'P2P',
   'Legacy P2P must be recovered from its immutable QR');
 assert.throws(()=>db.saveSession({...personal,merchantType:'MERCHANT'}),
  /SESSION_PAYMENT_TYPE_URI_CONFLICT/,'Personal URI cannot be upgraded to merchant');
 assert.throws(()=>db.saveSession({...personal,vpaAddress:'attacker@upi'}),
  /SESSION_PAYEE_URI_CONFLICT/,'Payee switch forbidden');
 assert.throws(()=>db.saveSession({...personal,challengeAmount:5}),
  /SESSION_AMOUNT_URI_CONFLICT/,'Amount switch forbidden');

 console.log('UPI_SQLITE_SNAPSHOT_PASS: configured VPA only, fake rows paused, QR bytes survive reload');
 db.sqliteDb.close();
})().catch(err=>{console.error(err);process.exitCode=1});
`;
try{
 const out=execFileSync(process.execPath,['-e',inner],{
  cwd:path.join(__dirname,'..'),encoding:'utf8',
  env:{...process.env,DB_BACKEND:'sqlite',DATABASE_URL:'',
   NODE_ENV:'test',DATA_DIR:directory,MERCHANT_UPI_ID:'verified-payee@oksbi',
   MERCHANT_NAME:'Verified Payee'},timeout:25000
 });
 assert.match(out,/UPI_SQLITE_SNAPSHOT_PASS/);
 process.stdout.write(out);
}finally{fs.rmSync(directory,{recursive:true,force:true})}
