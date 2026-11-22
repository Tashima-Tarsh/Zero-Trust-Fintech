(function(){
 'use strict';
 const params=new URLSearchParams(location.search);
 const buttons=[...document.querySelectorAll('[data-payment-mode]')];
 const status=document.getElementById('tryStatus'),error=document.getElementById('tryError');
 if(!buttons.length)return;
 let busy=false;
 function fail(message){
  busy=false;buttons.forEach(b=>b.disabled=false);
  error.hidden=false;error.textContent=message;
  status.textContent='';
 }
 async function choose(mode){
  if(busy)return;
  busy=true;error.hidden=true;
  buttons.forEach(b=>b.disabled=true);
  status.textContent='Preparing secure payment session…';
  if(mode==='P2M'){
   // Merchant classification and amount require an authenticated issued order.
   // No public P2P session is created for a merchant payment.
   location.assign('/login?mode=P2M');return;
  }
  const raw=params.get('amount')||'1';
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||!(Number(raw)>=0.01&&Number(raw)<=100000)){
   fail('Invalid payment amount in link. Request a new payment link.');return;
  }
  try{
   // The backend selects the authorized receiving account; never accept a
   // payer-typed or URL-supplied destination VPA in this customer flow.
   const qs=new URLSearchParams({amount:Number(raw).toFixed(2),description:'Quantum Fusion payment'});
   const response=await fetch('/api/session/new?'+qs,{credentials:'same-origin',cache:'no-store'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.success!==true)throw Error('Payment request unavailable. Please retry.');
   if(!/^[A-Za-z0-9_-]{6,150}$/.test(result.orderId||'')||
      !/^[a-f0-9]{24,64}$/i.test(result.sessionId||'')||result.paymentType!=='P2P')
    throw Error('Payment session validation failed.');
   const checkout=new URL('/p2p',location.origin);
   checkout.searchParams.set('orderId',result.orderId);
   checkout.searchParams.set('token',result.sessionId);
   checkout.searchParams.set('proofbridge','1');
   // PR #140's signed-return path must be reachable from the actual P2P chooser.
   // Eligibility is checked after the existing payer authentication succeeds.
   checkout.searchParams.set('timedprovider','1');
   location.assign(checkout.pathname+checkout.search);
  }catch(e){fail(e.message||'Payment request unavailable.')}
 }
 buttons.forEach(b=>b.addEventListener('click',()=>{void choose(b.dataset.paymentMode)}));
})();