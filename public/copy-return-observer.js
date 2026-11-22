/* DISHA 8.2 copy-and-return checkout observation, financial state always read-only. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISHACopyReturnObserver=api})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
 function create({clock=()=>Date.now(),onObservation=()=>{},onState=()=>{}}={}){
  let state=null;
  function valid(s){return s&&typeof s.orderId==='string'&&typeof s.token==='string'&&
   Number.isFinite(Number(s.expiresAt))&&clock()<Number(s.expiresAt)}
  function markCopied(s){
   if(!valid(s))return false;
   state={session:s,started:clock(),hidden:false,completed:false};
   onState('COPY_READY');return true;
  }
  function background(){
   if(!state||state.completed||!valid(state.session))return false;
   state.hidden=true;onState('BROWSER_HIDDEN');return true;
  }
  function foreground(){
   if(!state||state.completed||!state.hidden||!valid(state.session))return false;
   if(clock()-state.started>180000){state.completed=true;return false}
   state.completed=true;
   onState('BROWSER_RETURN');
   onObservation(state.session);
   return true;
  }
  function snapshot(){return {state:state?state.completed?'RETURN_OBSERVED':state.hidden?'AWAY_FROM_CHECKOUT':'COPY_READY':'IDLE',
   debitVerified:false,paymentVerified:false}}
  return Object.freeze({markCopied,background,foreground,snapshot});
 }
 return Object.freeze({create});
});