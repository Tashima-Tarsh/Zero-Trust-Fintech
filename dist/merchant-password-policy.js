/* Merchant signup password UX policy. Clerk remains the identity authority. */
(function(root){
'use strict';
const MIN_PASSWORD_LENGTH=10;
function isAllowedPassword(password){
 return typeof password==='string'&&Array.from(password).length>=MIN_PASSWORD_LENGTH;
}
function attach(container){
 if(!container||!root.document)return;
 const hint=root.document.getElementById('password-guidance');
 function validate(input,announce){
  const valid=isAllowedPassword(input.value);
  if(input.value&& !valid){
   input.setCustomValidity('Use at least 10 characters for your password.');
  }else input.setCustomValidity('');
  if(hint&&announce){
   hint.classList.toggle('invalid',Boolean(input.value)&&!valid);
   hint.classList.toggle('valid',Boolean(input.value)&&valid);
   hint.textContent=!input.value?'For password signup, use at least 10 characters.':
     valid?'Password length meets the 10-character requirement.':
     'Use at least 10 characters ('+Array.from(input.value).length+'/'+MIN_PASSWORD_LENGTH+').';
  }
  return valid;
 }
 function scan(){
  container.querySelectorAll('input[type="password"]').forEach(input=>{
   if(input.dataset.dishaPasswordPolicy==='1')return;
   input.dataset.dishaPasswordPolicy='1';
   input.setAttribute('minlength',String(MIN_PASSWORD_LENGTH));
   input.addEventListener('input',()=>validate(input,true));
   input.addEventListener('blur',()=>validate(input,true));
  });
 }
 container.addEventListener('submit',event=>{
  const input=container.querySelector('input[type="password"]');
  if(input && input.value && !validate(input,true)){
   event.preventDefault();
   event.stopImmediatePropagation();
   input.focus();
   input.reportValidity?.();
  }
 },true);
 scan();
 if(typeof root.MutationObserver==='function'){
  const observer=new root.MutationObserver(scan);
  observer.observe(container,{childList:true,subtree:true});
 }
}
const api=Object.freeze({MIN_PASSWORD_LENGTH,isAllowedPassword,attach});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.DISHAAuthPasswordPolicy=api;
})(typeof window!=='undefined'?window:globalThis);
