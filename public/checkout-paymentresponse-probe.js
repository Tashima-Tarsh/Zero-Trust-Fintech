/* Main merchant checkout experiment: observe a real browser PaymentResponse only.
 * No DISHA APIs, ledger mutation, local persistence, SMS, RRN assertion or auto-pay.
 * Only UPI URIs with server-issued 4-digit merchant MCC and txn reference qualify.
 */
(function(root){'use strict';
function mount(order){
  if(!order||document.body.dataset.checkout!=='merchant')return;
  const host=document.getElementById('paymentTrackingStatus');
  if(!host||!root.DISHAPaymentResponseLab)return;
  const params=new URLSearchParams(String(order.upiUri||'').split('?')[1]||'');
  const pa=params.get('pa'),pn=params.get('pn'),mc=params.get('mc'),tr=params.get('tr');
  if(!pa||!pn||!mc||!tr||!/^\d{4}$/.test(mc)||mc==='0000')return;
  const active=()=>order.expiresAt&&Date.now()<Number(order.expiresAt)&&document.body.dataset.checkout==='merchant';
  const section=document.createElement('section');section.id='checkoutPaymentResponseProbe';section.className='glass-panel';
  section.style.cssText='padding:14px;margin:12px 0';
  const label=document.createElement('strong');label.textContent='Automatic payment-app response research (P2M only)';
  const note=document.createElement('p');note.className='inline-note';note.textContent='Runs on this actual checkout. No manual reference, no DISHA app. The payment app must support Chrome PaymentRequest. An app response is not bank debit proof.';
  const probe=document.createElement('button');probe.type='button';probe.className='glass-btn';probe.textContent='Check payment-app response support';
  const pay=document.createElement('button');pay.type='button';pay.className='glass-btn';pay.textContent='Pay via supported app (may debit real money)';pay.disabled=true;
  const outcome=document.createElement('p');outcome.className='inline-note';outcome.role='status';outcome.setAttribute('aria-live','polite');outcome.textContent='Not tested';
  section.append(label,note,probe,pay,outcome);host.after(section);
  const lib=root.DISHAPaymentResponseLab;let request=null,expected=null;
  function report(t){outcome.textContent=t;}
  probe.addEventListener('click',async()=>{
    request=null;pay.disabled=true;
    if(!active()){report('Checkout expired; no payment request started.');return;}
    if(!root.isSecureContext||typeof root.PaymentRequest!=='function'){report('Chrome PaymentRequest unavailable on this device.');return;}
    try{
      expected={payeeVpa:pa,payeeName:pn,mcc:mc,amount:Number(order.amount).toFixed(2),transactionRef:tr,orderUrl:root.location.origin+root.location.pathname};
      const d=lib.requestData(expected);request=new PaymentRequest(d.methods,d.details);
      const capable=await request.canMakePayment();
      if(!active()){request=null;report('Checkout expired during capability check.');return;}
      pay.disabled=!capable;
      report(capable?'Supported app detected. Payment only starts with your separate click.':'No supported payment method available for this merchant checkout.');
    }catch(e){request=null;report('PaymentRequest probe unavailable ('+(e.name||'Error')+').');}
  });
  pay.addEventListener('click',async()=>{
    if(!request||!expected||!active()){report('No live payment request. Probe this order again.');return;}
    const req=request;request=null;pay.disabled=true;
    try{
      const response=await req.show();
      const o=lib.inspectResponse(response,expected);
      if(!active()){report('Late app response: checkout expired. No session evidence accepted.');}
      else if(o.result==='TEZ_RESPONSE_OBSERVED'){
        report('App response: '+o.status+' · Transaction ID present: '+(o.transactionIdPresent?'yes':'no')+
         ' · Amount match: '+(o.amountMatches?'yes':'no')+' · Payee match: '+(o.payeeMatches?'yes':'no')+
         ' · Session reference match: '+(o.merchantReferenceEchoed?'yes':'no')+
         ' · Bank debit/RRN NOT VERIFIED.');
      }else report('Payment app did not return usable transaction evidence ('+o.result+').');
      try{await response.complete('unknown');}catch(_){}
    }catch(e){report('Payment request cancelled or failed ('+(e.name||'Error')+'). No debit verdict.');}
  });
}
root.DISHACheckoutPaymentResponseProbe=Object.freeze({mount});
})(window);
