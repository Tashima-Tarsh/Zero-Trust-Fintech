'use strict';
const http=require('node:http'),crypto=require('node:crypto');
function createLabServer(now=()=>Date.now()){
 const issued=new Map();
 const issue=({sessionId})=>{
  if(sessionId!=='lab-android-session')throw Error('INVALID_SESSION');
  const challenge=crypto.randomBytes(32).toString('hex');
  issued.set(sessionId,{challenge,expiresAt:now()+60000});
  return {sessionId,challenge,origin:'https://disha8-2.thenitishkr.in'};
 };
 const verify=({sessionId,challenge,publicKeySpki,signature})=>{
  const r=issued.get(sessionId);
  if(!r||r.challenge!==challenge||now()>r.expiresAt)throw Error('INVALID_OR_EXPIRED_CHALLENGE');
  if(typeof publicKeySpki!=='string'||publicKeySpki.length>300||
     typeof signature!=='string'||signature.length>300)throw Error('BAD_SIGNED_RESPONSE');
  let key;try{key=crypto.createPublicKey({key:Buffer.from(publicKeySpki,'base64'),type:'spki',format:'der'});}
  catch{throw Error('INVALID_KEY')}
  if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')
   throw Error('INVALID_KEY');
  const content=['DISHA-ANDROID-HANDSHAKE-V1',sessionId,challenge,'https://disha8-2.thenitishkr.in'].join('\n');
  if(!crypto.verify('sha256',Buffer.from(content),key,Buffer.from(signature,'base64')))
   throw Error('BAD_SIGNATURE');
  issued.delete(sessionId);
  return {success:true,deviceKeyPossession:true,paymentVerified:false,debitVerified:false,utr:null};
 };
 const handler=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||!['/lab/challenge','/lab/respond'].includes(req.url)){
   res.writeHead(404);return res.end();
  }
  let raw='';for await(const c of req){raw+=c;if(raw.length>4096){res.writeHead(413);return res.end();}}
  try{
   const input=JSON.parse(raw);
   const data=req.url==='/lab/challenge'?issue(input):verify(input);
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));
  }catch(e){res.writeHead(422,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
 });
 return {handler,issue,verify};
}
if(require.main===module)createLabServer().handler.listen(8765,'127.0.0.1',()=>console.log('LAB_READY'));
module.exports={createLabServer};
