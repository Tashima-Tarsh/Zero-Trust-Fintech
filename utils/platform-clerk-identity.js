'use strict';
/* Clerk's verified PRIMARY email is the only accepted owner identity.
 * Service failures are never recast as proof of a wrong user account. */
function unavailable(){
 return Object.assign(new Error('Clerk identity verification is temporarily unavailable'),
  {status:503,code:'CLERK_IDENTITY_UNAVAILABLE'});
}
async function getClerkVerifiedEmail(userId){
 if(!userId||!/^user_[a-zA-Z0-9]+$/.test(userId))return null;
 const secret=process.env.CLERK_SECRET_KEY;
 if(!secret)throw unavailable();
 let response;
 try{
  response=await fetch('https://api.clerk.com/v1/users/'+encodeURIComponent(userId),{
   headers:{Authorization:'Bearer '+secret,Accept:'application/json'},
   signal:AbortSignal.timeout(7000)
  });
 }catch(_){throw unavailable()}
 if([401,403,429].includes(response.status)||response.status>=500)throw unavailable();
 if(!response.ok)return null;
 let user;
 try{user=await response.json()}catch(_){throw unavailable()}
 const primary=user.email_addresses?.find(e=>
  e.id===user.primary_email_address_id&&e.verification?.status==='verified');
 return primary?.email_address?.trim().toLowerCase()||null;
}
module.exports={getClerkVerifiedEmail};
