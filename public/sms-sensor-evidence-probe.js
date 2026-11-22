/* DISHA experimental, consent-driven Android SMS + motion evidence collector.
 * Browser does NOT have permission to read the SMS inbox. User can paste/share a bank SMS.
 * Motion is context only, NEVER payment authentication. No network or ledger writes.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISHASmsSensorProbe=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
function money(s){if(typeof s!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(s))return null;const a=s.split('.');return Number(a[0])*100+Number((a[1]||'').padEnd(2,'0'))}
function parseSms(raw){
 if(typeof raw!=='string'||raw.length>2000)return {state:'INVALID_SMS'};
 const sms=raw.replace(/\s+/g,' ').trim();
 const debit=/\b(debited|debit|spent|paid|sent|transferred)\b/i.test(sms);
 const reversal=/\b(reversed|refunded|failed|declined|unsuccessful|credited|credit)\b/i.test(sms);
 const amount=sms.match(/(?:INR|Rs\.?|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
 const vpa=sms.match(/\b([a-z0-9._-]{2,100}@[a-z0-9._-]{2,40})\b/i);
 const utr=sms.match(/\b(?:UTR|RRN|UPI\s*(?:Ref|Reference)|Reference\s*(?:No|Number)?)[\s:.-]*([0-9]{12})\b/i);
 return {state:debit&&!reversal?'DEBIT_WORDS_OBSERVED':'NO_UNAMBIGUOUS_DEBIT_WORDS',
  amountPaise:amount?money(amount[1]):null,vpa:vpa?vpa[1].toLowerCase():null,
  reference:utr?utr[1]:null,containsReversal:reversal};
}
function assess(session,sms,motion){
 const amount=money(String(session?.amount??''));
 const paid=parseSms(sms);
 const expiry=Number(session?.expiresAt);
 const live=Number.isFinite(expiry)&&Date.now()<expiry;
 const expectedVpa=typeof session?.payeeVpa==='string'?session.payeeVpa.toLowerCase():'';
 const amountMatch=amount!==null&&paid.amountPaise!==null&&amount===paid.amountPaise;
 const payeeMatch=!!expectedVpa&&paid.vpa===expectedVpa;
 const motionSamples=Number.isSafeInteger(motion?.samples)?Math.max(0,Math.min(300,motion.samples)):0;
 const correlated=live&&paid.state==='DEBIT_WORDS_OBSERVED'&&amountMatch&&payeeMatch;
 return Object.freeze({state:!live?'SESSION_EXPIRED':correlated?'USER_SUPPLIED_SMS_FIELDS_MATCH':'INSUFFICIENT_SMS_CORRELATION',
  smsSource:'USER_SUPPLIED_UNAUTHENTICATED',amountMatch,payeeMatch,referenceCandidatePresent:!!paid.reference,
  sensorContextObserved:motionSamples>0,motionSamples,
  signatureVerified:false,smsOriginVerified:false,debitVerified:false,paymentVerified:false,settlementVerified:false});
}
function attach(session,env){
 const win=env?.window,doc=env?.document;
 if(!win||!doc||new URLSearchParams(win.location?.search||'').get('smsSensor')!=='1')return false;
 if(!session||!['P2P','PERSONAL'].includes(String(session.paymentType||'').toUpperCase()))return false;
 if(!session.orderId||!Number.isFinite(Number(session.expiresAt)))return false;
 const parent=doc.getElementById('payerDebitCheckPanel');
 if(!parent)return false;
 if(doc.getElementById('dishaSmsSensorExperiment'))return false;
 const panel=doc.createElement('section');panel.id='dishaSmsSensorExperiment';
 panel.setAttribute('aria-label','Optional SMS and sensor research');panel.className='glass-panel';
 const title=doc.createElement('strong');title.textContent='Consented SMS + motion correlation experiment';
 const note=doc.createElement('p');note.textContent='Paste an SMS manually; motion sensor is optional. Neither is independently authenticated bank debit evidence.';
 const consent=doc.createElement('input');consent.type='checkbox';consent.id='dishaSmsSensorConsent';
 const label=doc.createElement('label');label.textContent=' I consent to local SMS analysis and optional motion sampling';label.prepend(consent);
 const input=doc.createElement('textarea');input.placeholder='Paste a bank debit SMS here (stays on device)';input.maxLength=2000;input.rows=3;
 const button=doc.createElement('button');button.type='button';button.textContent='Analyze SMS + sensor';button.disabled=true;
 const stop=doc.createElement('button');stop.type='button';stop.textContent='Clear and revoke';
 const result=doc.createElement('p');result.setAttribute('role','status');
 panel.append(title,note,label,input,button,stop,result);parent.after(panel);
 let motionSamples=0,listening=false;
 const motion=event=>{if(!consent.checked)return;if(event?.accelerationIncludingGravity&&motionSamples<300)motionSamples++};
 const remove=()=>{if(listening&&win.removeEventListener)win.removeEventListener('devicemotion',motion);listening=false};
 const revoke=()=>{remove();motionSamples=0;input.value='';button.disabled=true;result.textContent='CONSENT_REVOKED';};
 consent.addEventListener('change',()=>{if(!consent.checked)revoke();else button.disabled=false});
 button.addEventListener('click',async()=>{
  if(!consent.checked)return;
  if(Date.now()>=Number(session.expiresAt)){result.textContent='SESSION_EXPIRED';return}
  // Android motion access requires a user gesture and, on some devices, permission.
  if(!listening&&typeof win.addEventListener==='function'){
   try{
    const Motion=win.DeviceMotionEvent;
    if(Motion&&typeof Motion.requestPermission==='function'){
     const choice=await Motion.requestPermission();if(choice!=='granted')throw Error('NOT_GRANTED');
    }
    if(!consent.checked)return;
    win.addEventListener('devicemotion',motion);listening=true;
   }catch(_){result.textContent='SENSOR_PERMISSION_UNAVAILABLE_SMS_ONLY';}
  }
  result.textContent=JSON.stringify(assess(session,input.value,{samples:motionSamples}));
 });
 stop.addEventListener('click',()=>{consent.checked=false;revoke()});
 win.addEventListener?.('pagehide',revoke);
 result.textContent='READY_REQUIRES_CONSENT';
 return true;
}
return Object.freeze({money,parseSms,assess,attach});
});
