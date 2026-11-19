'use strict';
/* Opt-in mobile UPI checkout diagnostics. Not UPI or financial evidence.
 * No PIN, passkey assertion, raw error string, UPI payload, IP, or UA storage. */
const express=require('express');
const crypto=require('node:crypto');
const EVENTS=new Set([
 'ORDER_READY','VAULT_ENV','VAULT_BEGIN','VAULT_AUTH_API',
 'VAULT_REGISTER_NEEDED','VAULT_REGISTER_PROMPT','VAULT_AUTH_PROMPT',
 'VAULT_AUTHORIZED','VAULT_ERROR','APP_SELECTED','APP_DISPATCH',
 'APP_ERROR','BROWSER_HIDDEN','BROWSER_RETURN','NO_BACKGROUND',
 'QR_OPEN','EVIDENCE_SUBMIT','EVIDENCE_ACK','EVIDENCE_ERROR',
 'LEDGER_CONFIRMED','SESSION_EXPIRED'
]);
const CODES=new Set([
 'OK','UNKNOWN','NO_WEB_AUTHN','INSECURE_CONTEXT','SDK_MISSING',
 'NOT_ALLOWED_OR_TIMEOUT','SECURITY_ERROR','NOT_SUPPORTED','INVALID_STATE',
 'ABORTED','NETWORK_ERROR','BACKEND_400','BACKEND_401','BACKEND_403',
 'BACKEND_404','BACKEND_409','BACKEND_429','BACKEND_500','BACKEND_503',
 'BACKEND_OTHER','APP_TARGETED','APP_GENERIC','APP_NAVIGATION_ERROR',
 'RETURN_FAST','RETURN_NORMAL','NO_BACKGROUND','NO_RETURN_PARAMS',
 'HAS_RETURN_PARAMS','NO_OBSERVATION','EVIDENCE_UNVERIFIED','EVIDENCE_CONFLICT'
]);
const APPS=new Set(['none','gpay','phonepe','paytm','bhim','cred','generic']);
const DEVICES=new Set(['android','ios','desktop','other']);
function validEvent(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 if(Object.keys(body).some(k=>!['orderId','token','event','code','app','device'].includes(k)))return null;
 if(typeof body.orderId!=='string'||!/^[A-Za-z0-9_-]{6,150}$/.test(body.orderId))return null;
 if(!EVENTS.has(body.event)||!CODES.has(body.code||'OK'))return null;
 if(!APPS.has(body.app||'none')||!DEVICES.has(body.device||'other'))return null;
 if(typeof body.token!=='string'||!/^[a-f0-9]{24,64}$/i.test(body.token))return null;
 return {orderId:body.orderId,token:body.token,event:body.event,
  code:body.code||'OK',app:body.app||'none',device:body.device||'other'};
}
function equalToken(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function createCheckoutDiagnostics({db}){
 const router=express.Router();
 async function init(){
  const pg=db.pgPool;
  if(!pg)return;
  await pg.query(
   'CREATE TABLE IF NOT EXISTS disha_checkout_diagnostics ('+
   'id BIGSERIAL PRIMARY KEY,order_id TEXT NOT NULL,event TEXT NOT NULL,'+
   'code TEXT NOT NULL,app TEXT NOT NULL,device TEXT NOT NULL,'+
   'created_at TIMESTAMPTZ NOT NULL DEFAULT now());'+
   'CREATE INDEX IF NOT EXISTS idx_disha_checkout_diag_order '+
   'ON disha_checkout_diagnostics(order_id,created_at DESC);'+
   'CREATE INDEX IF NOT EXISTS idx_disha_checkout_diag_recent '+
   'ON disha_checkout_diagnostics(created_at DESC);'+
   "DELETE FROM disha_checkout_diagnostics WHERE created_at<now()-interval '7 days'"
  );
 }
 router.post('/trace',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const b=validEvent(req.body);
   if(!b||JSON.stringify(req.body).length>650)
    return res.status(400).json({success:false,error:'INVALID_TRACE_EVENT'});
   // Validate the same order-scoped bearer used by checkout. A browser cannot
   // submit telemetry for someone else's payment without its checkout token.
   if(!equalToken(req.get('x-csrf-token'),b.token))
    return res.status(403).json({success:false,error:'CHECKOUT_PROOF_REQUIRED'});
   const s=await db.findSessionByOrderId(b.orderId);
   if(!s||!equalToken(s.sessionId,b.token))
    return res.status(404).json({success:false,error:'ORDER_NOT_FOUND'});
   if(!Number.isFinite(Number(s.expiresAt))||Date.now()>Number(s.expiresAt)+900000)
    return res.status(410).json({success:false,error:'TRACE_WINDOW_CLOSED'});
   const pg=db.pgPool;
   if(!pg)return res.status(503).json({success:false,error:'TRACE_STORE_UNAVAILABLE'});
   // Maximum 60 events per order for a seven-day retention window.
   const recorded=await pg.query(
    'INSERT INTO disha_checkout_diagnostics(order_id,event,code,app,device) '+
    'SELECT $1,$2,$3,$4,$5 WHERE '+
    '(SELECT count(*) FROM disha_checkout_diagnostics WHERE order_id=$1)<60 RETURNING id',
    [b.orderId,b.event,b.code,b.app,b.device]);
   return res.status(202).json({success:true,recorded:recorded.rowCount>0});
  }catch(error){
   console.warn('[Checkout Trace] storage unavailable:',error.code||error.name||'UNKNOWN');
   return res.status(503).json({success:false,error:'TRACE_STORE_UNAVAILABLE'});
  }
 });
 return {router,init};
}
module.exports={createCheckoutDiagnostics,validEvent,equalToken,EVENTS,CODES};
