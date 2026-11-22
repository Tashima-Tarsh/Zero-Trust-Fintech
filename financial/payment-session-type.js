'use strict';
/**
 * Immutable session payment classification. UPI bank QR/Intent (upi_uri)
 * is the surviving source for historical sessions whose payment_type was not
 * stored. Never derive merchant privileges from an untrusted display label,
 * a VPA substring or a generic /p2p URL.
 */
const normalize=value=>{
 if(value===null||value===undefined||value==='')return null;
 const type=String(value).toUpperCase();
 if(type==='PERSONAL'||type==='P2P')return 'P2P';
 if(type==='MERCHANT'||type==='P2M')return 'P2M';
 throw Error('SESSION_PAYMENT_TYPE_INVALID');
};
function fromIssuedUri(value,session) {
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||!/^upi:\/\/pay\?/i.test(value))throw Error('SESSION_UPI_URI_INVALID');
 let url;
 try{url=new URL(value)}catch(_){throw Error('SESSION_UPI_URI_INVALID')}
 if(url.protocol!=='upi:'||url.hostname.toLowerCase()!=='pay'||!url.search)
   throw Error('SESSION_UPI_URI_INVALID');
 const q=url.searchParams;
 for(const key of ['pa','am','cu']){
  if(q.getAll(key).length!==1)throw Error('SESSION_UPI_URI_INVALID');
 }
 for(const key of ['mc','tr'])if(q.getAll(key).length>1)throw Error('SESSION_UPI_URI_INVALID');
 const pa=q.get('pa');
 const am=q.get('am');
 if(!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(pa||'')||
    q.get('cu')!=='INR'||!/^\d+(?:\.\d{1,2})?$/.test(am||''))
   throw Error('SESSION_UPI_URI_INVALID');
 // A saved session cannot be reinterpreted as paying a different UPI VPA
 // or amount even if somebody changes a VPA's classification afterwards.
 if(session?.vpaAddress&&pa.toLowerCase()!==String(session.vpaAddress).toLowerCase())
   throw Error('SESSION_PAYEE_URI_CONFLICT');
 if(session?.challengeAmount!==undefined&&session.challengeAmount!==null){
  const expected=Number(session.challengeAmount),actual=Number(am);
  if(!Number.isFinite(expected)||!Number.isFinite(actual)||
     Math.abs(expected*100-Math.round(expected*100))>1e-7||
     Math.abs(actual*100-Math.round(actual*100))>1e-7||
     Math.round(expected*100)!==Math.round(actual*100))
   throw Error('SESSION_AMOUNT_URI_CONFLICT');
 }
 const mc=q.get('mc'),tr=q.get('tr');
 // Official UPI QR may encode 0000 for a personal payee; DISHA's own
 // P2P builder omits mc and tr, and never manufactures a merchant identity.
 if((mc===null&&tr===null)||(mc==='0000'&&tr===null))return 'P2P';
 if(!/^\d{4}$/.test(mc||'')||mc==='0000'||!/^[A-Za-z0-9]{1,35}$/.test(tr||''))
   throw Error('SESSION_MERCHANT_URI_INCOMPLETE');
 return 'P2M';
}
function resolvePaymentType(session){
 if(!session||typeof session!=='object')throw TypeError('Session required');
 const declared=normalize(session.paymentType??session.payment_type??session.merchantType);
 const issued=fromIssuedUri(session.upiUri??session.upi_uri,{vpaAddress:session.vpaAddress??session.vpa_address,
  challengeAmount:session.challengeAmount??session.challenge_amount});
 if(declared&&issued&&declared!==issued)throw Error('SESSION_PAYMENT_TYPE_URI_CONFLICT');
 return issued||declared;
}
module.exports={normalize,fromIssuedUri,resolvePaymentType};
