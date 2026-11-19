(function(){
 'use strict';
 const form=document.getElementById('tryCheckoutForm');
 if(!form)return;
 const params=new URLSearchParams(location.search);
 const amount=document.getElementById('tryAmount'),vpa=document.getElementById('tryVpa');
 const error=document.getElementById('tryError'),status=document.getElementById('modeDescription');
 const button=form.querySelector('[type="submit"]'),modes=[...form.querySelectorAll('[data-payment-mode]')];
 let mode='P2P';
 function selectMode(next){
  mode=next==='P2M'?'P2M':'P2P';
  modes.forEach(el=>{const active=el.dataset.paymentMode===mode;el.setAttribute('aria-pressed',String(active));el.classList.toggle('active',active)});
  status.textContent=mode==='P2M'
   ?'P2M requires an active bank-registered merchant UPI account and its real MCC. Sign in to issue the order.'
   :'P2P uses your configured personal receiving UPI account. Unknown payees cannot be substituted.';
  error.hidden=true;
 }
 modes.forEach(el=>el.addEventListener('click',()=>selectMode(el.dataset.paymentMode)));
 selectMode(params.get('mode'));
 function fail(message){error.hidden=false;error.textContent=message;button.disabled=false;button.textContent='Continue to UPI ↗'}
 form.addEventListener('submit',async event=>{
  event.preventDefault();error.hidden=true;
  const raw=String(amount.value||'').trim(),payee=String(vpa.value||'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||!(Number(raw)>=0.01&&Number(raw)<=100000)){
   fail('Enter an amount between ₹0.01 and ₹1,00,000, with up to two decimal places.');return;
  }
  if(!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(payee)){
   fail('Enter a valid receiving UPI ID, for example youraccount@bank.');return;
  }
  const value=Number(raw).toFixed(2);
  button.disabled=true;button.textContent='Preparing payment…';
  if(mode==='P2M'){
   try{sessionStorage.setItem('disha82:merchant-prefill',JSON.stringify({amount:value,vpa:payee,mode,savedAt:Date.now()}))}
   catch(_){fail('Browser storage is unavailable. Please enable it to continue with merchant sign-in.');return}
   location.assign('/login?mode=P2M');return;
  }
  try{
   const search=new URLSearchParams({amount:value,vpa:payee,description:'Direct UPI payment'});
   const response=await fetch('/api/session/new?'+search.toString(),{credentials:'same-origin',cache:'no-store'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok){
    if(result.error==='UNAUTHORIZED_PAYEE_VPA'||result.error==='P2P_RECEIVER_ACCOUNT_TYPE_MISMATCH')
     throw Error('This UPI ID is not an approved personal receiving account. Use the configured account or sign in for P2M.');
    throw Error(response.status===429?'Too many requests. Try again shortly.':
     'Unable to create your payment. Check the receiving account and retry.');
   }
   if(!result.success||!/^[A-Za-z0-9_-]{6,150}$/.test(result.orderId||'')||
      !/^[a-f0-9]{24,64}$/i.test(result.sessionId||''))throw Error('Payment session was incomplete. Please try again.');
   const checkout=new URL('/p2p',location.origin);
   checkout.searchParams.set('orderId',result.orderId);checkout.searchParams.set('token',result.sessionId);
   checkout.searchParams.set('qs','1');
   location.assign(checkout.pathname+checkout.search);
  }catch(e){fail(e.message||'Payment request unavailable. Please try again.')}
 });
})();