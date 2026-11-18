'use strict';
/* Resolve verified identity server-side, not from a browser-controlled header. */
async function getClerkVerifiedEmail(userId){
 const secret=process.env.CLERK_SECRET_KEY;
 if(!secret||!userId||!/^user_[a-zA-Z0-9]+$/.test(userId))return null;
 const response=await fetch('https://api.clerk.com/v1/users/'+encodeURIComponent(userId),{
  headers:{Authorization:'Bearer '+secret,Accept:'application/json'},signal:AbortSignal.timeout(7000)});
 if(!response.ok)return null;
 const user=await response.json();
 const primary=user.email_addresses?.find(e=>e.id===user.primary_email_address_id&&e.verification?.status==='verified');
 return primary?.email_address?.trim().toLowerCase()||null;
}
module.exports={getClerkVerifiedEmail};
