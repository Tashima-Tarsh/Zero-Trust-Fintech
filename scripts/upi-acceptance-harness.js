'use strict';
/**
 * UPI intent differential harness: compare DISHA's generated QR payload with
 * the receiving bank's own UPI QR. No settlement or real money occurs here.
 * Use: node scripts/upi-acceptance-harness.js --kind P2M --bank "upi://pay?..." --checkout "upi://pay?..."
 */
const fs=require('node:fs');
const KEY_FIELDS=['pa','pn','am','cu','mc','tr','tid','mid','msid','mtid','mode','orgid'];
const MAX_RUPEES=100000;

function parse(uri){
 if(typeof uri!=='string'||uri.length>2048||!/^upi:\/\/pay\?/i.test(uri))
  throw new Error('NOT_UPI_PAY_URI');
 const value=new URL(uri);
 if(value.protocol!=='upi:'||value.hostname!=='pay')
  throw new Error('NOT_UPI_PAY_URI');
 for(const name of KEY_FIELDS)if(value.searchParams.getAll(name).length>1)
  throw new Error('DUPLICATE_'+name.toUpperCase());
 const field=k=>value.searchParams.get(k);
 if(!/^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/i.test(field('pa')||''))
  throw new Error('INVALID_RECEIVING_VPA');
 if(!field('pn')||field('pn').trim().length<2)throw new Error('MISSING_PAYEE_NAME');
 if(field('cu')!=='INR')throw new Error('INVALID_CURRENCY');
 const amount=field('am');
 if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(amount||'')||
    Number(amount)<=0||Number(amount)>MAX_RUPEES)throw new Error('INVALID_AMOUNT');
 if(field('mc')!==null&&!/^\d{4}$/.test(field('mc')))throw new Error('INVALID_MCC');
 if(field('tr')!==null&&!/^[A-Za-z0-9]{1,35}$/.test(field('tr')))
  throw new Error('INVALID_TRANSACTION_REFERENCE');
 if(/\border\b|order_[A-Za-z0-9_-]+/i.test(field('tn')||''))
  throw new Error('LEGACY_RECORD_WORD_IN_NOTE');
 return {pa:field('pa').toLowerCase(),pn:field('pn').trim(),amount:Number(amount).toFixed(2),
  mc:field('mc'),tr:field('tr'),cu:'INR',tn:field('tn')||'',
  mid:field('mid'),tid:field('tid'),mode:field('mode'),orgid:field('orgid')};
}
function verify({kind,checkoutUri,bankUri}){
 const problems=[];
 const account=String(kind||'').toUpperCase();
 if(!['P2P','P2M'].includes(account))problems.push('ACCOUNT_TYPE_MUST_BE_P2P_OR_P2M');
 let checkout,bank;
 try{checkout=parse(checkoutUri)}catch(error){problems.push('CHECKOUT_'+error.message)}
 if(bankUri){try{bank=parse(bankUri)}catch(error){problems.push('BANK_QR_'+error.message)}}
 if(checkout){
  if(account==='P2P'&&(checkout.mc!==null||checkout.tr!==null))
   problems.push('P2P_MUST_NOT_FABRICATE_MERCHANT_FIELDS');
  if(account==='P2M'){
   if(!checkout.mc||checkout.mc==='0000')problems.push('P2M_REAL_MCC_REQUIRED');
   if(!checkout.tr)problems.push('P2M_UNIQUE_TRANSACTION_REFERENCE_REQUIRED');
  }
  if(bank){
   if(checkout.pa!==bank.pa)problems.push('RECEIVING_VPA_DIFFERS_FROM_BANK_QR');
   if(checkout.pn.toLowerCase()!==bank.pn.toLowerCase())
    problems.push('PAYEE_NAME_DIFFERS_FROM_BANK_QR');
   if(bank.mc&&checkout.mc!==bank.mc)problems.push('MCC_DIFFERS_FROM_BANK_QR');
   for(const f of ['mid','tid','mode','orgid']){
    // Preserve bank-issued metadata when required; do not invent it.
    if(bank[f]&&checkout[f]!==bank[f])
     problems.push('BANK_'+f.toUpperCase()+'_NOT_PRESERVED');
   }
  }
 }
 return {ok:problems.length===0,problems,kind:account,
  comparedToBank:Boolean(bank),checked:checkout?
   {vpa:checkout.pa,amount:checkout.amount,hasMerchantCode:Boolean(checkout.mc),
    hasTransactionRef:Boolean(checkout.tr),purpose:checkout.tn}:null,
  bankAcceptanceTested:false};
}
if(require.main===module){
 const flags={};
 for(let i=2;i<process.argv.length;i+=2)flags[process.argv[i]]=process.argv[i+1];
 const kind=flags['--kind'],checkoutUri=flags['--checkout'],bankUri=flags['--bank'];
 if(!kind||!checkoutUri){console.error('Usage: node scripts/upi-acceptance-harness.js --kind P2P|P2M --checkout "upi://pay?..." [--bank "upi://pay?..."]');process.exitCode=2}
 else{
  const result=verify({kind,checkoutUri,bankUri});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.ok)process.exitCode=1;
 }
}
module.exports={parse,verify};
