'use strict';
const out=document.getElementById('out');
const probe=document.getElementById('probe');
const launch=document.getElementById('launch');
let fixture;
const report=(result)=>{out.textContent=JSON.stringify(result); console.info('DISHA_FIXTURE',out.textContent)};
const request=()=>new PaymentRequest([{supportedMethods:fixture.method}],{
  id:fixture.requestId,total:{label:'Synthetic transport',amount:{currency:'INR',value:'0.00'}}
});
probe.disabled=launch.disabled=true;
fetch('/issue',{method:'POST'}).then(r=>r.json()).then(value=>{
  fixture=value;
  probe.disabled=false;
  if(location.search==='?probe=1') probe.click();
}).catch(error=>report({stage:'issue',error:error.name}));
probe.onclick=async()=>{
  try{
    const eligible=await request().canMakePayment();
    launch.disabled=!eligible;
    report({stage:'probe',secureContext:isSecureContext,paymentRequest:typeof PaymentRequest,eligible});
    void fetch('/probe/'+(eligible?'eligible':'unavailable'),{method:'POST'}).catch(()=>{});
  }catch(error){
    report({stage:'probe',error:error.name});
    void fetch('/probe/error',{method:'POST'}).catch(()=>{});
  }
};
launch.onclick=async()=>{
  launch.disabled=true;
  try{
    const response=await request().show();
    const {requestId,methodName,details}=response;
    await response.complete('unknown');
    const reply=await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({requestId,methodName,details})});
    report({stage:'response',requestId,methodName,details,serverStatus:reply.status,debitVerified:false});
  }catch(error){report({stage:'show',error:error.name,debitVerified:false})}
};
