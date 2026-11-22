'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {check,targets}=require('../scripts/audit-checkout-deployment.cjs');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file));
async function verify(){
 const lines=[];
 const source=new Map(targets.map(([route,file])=>[route,read(file)]));
 const fake=async url=>({
  ok:true,status:200,
  headers:{get:key=>key==='x-disha-edge'?'test-edge':null},
  arrayBuffer:async()=>{const b=source.get(url.pathname);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}
 });
 const success=await check({fetchImpl:fake,read,output:s=>lines.push(s)});
 assert.equal(success.passed,true);
 assert.equal(success.results.length,targets.length);
 assert.ok(lines.some(line=>line.includes('CANONICAL_CHECKOUT_ASSETS_MATCH')));
 const changed=async url=>{
  const r=await fake(url);
  if(url.pathname==='/api/runtime/checkout')return {
   ...r,arrayBuffer:async()=>new TextEncoder().encode('old Pages checkout').buffer};
  return r;
 };
 const fail=await check({fetchImpl:changed,read,output:()=>{}});
 assert.equal(fail.passed,false);
 assert.equal(fail.results.filter(v=>v.status==='STALE_CONTENT').length,1);
 assert.equal(fail.results[0].path,'/api/runtime/checkout');
 const inaccessible=await check({
  fetchImpl:async()=>{throw Error('DNS_FAILURE')},read,output:()=>{}});
 assert.equal(inaccessible.passed,false);
 assert.equal(inaccessible.results.every(r=>r.status==='UNREACHABLE'),true);
 console.log('DEPLOYMENT_FRESHNESS_AUDIT_PASS: fresh, stale and DNS failure distinguishable without payment');
}
verify().catch(e=>{console.error(e);process.exitCode=1});
