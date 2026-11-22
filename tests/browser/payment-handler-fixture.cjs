'use strict';
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const http=require('node:http');
const https=require('node:https');
const path=require('node:path');

function createFixture(origin, fingerprint) {
  const method=new URL('/pay',origin).href;
  const pending=new Set();
  function issue() {
    if(pending.size>=64) pending.delete(pending.values().next().value);
    const id=randomUUID();
    pending.add(id);
    return id;
  }
  function accept(response) {
    if(response?.methodName!==method || !pending.has(response.requestId)) return false;
    const d=response.details;
    if(!d || typeof d!=='object' || Array.isArray(d) || Object.keys(d).length!==3 ||
        d.requestId!==response.requestId || d.synthetic!==true || d.outcome!=='TRANSPORT_OK') return false;
    return pending.delete(response.requestId);
  }
  return {method,issue,accept,handler:async(req,res)=>{
    const send=(status,type,body)=>res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
    if(req.method==='GET' && req.url==='/pay'){
      res.setHeader('Link','</method-manifest.json>; rel="payment-method-manifest"');
      return send(200,'text/plain','DISHA synthetic payment method');
    }
    if(req.method==='GET' && req.url==='/method-manifest.json')
      return send(200,'application/json',JSON.stringify({default_applications:[new URL('/app-manifest.json',origin).href]}));
    if(req.method==='GET' && req.url==='/app-manifest.json')
      return send(200,'application/json',JSON.stringify({prefer_related_applications:true,related_applications:[
        {platform:'play',id:'ai.disha.testupi.paymentfixture',min_version:'1',fingerprints:[{type:'sha256_cert',value:fingerprint}]}
      ]}));
    if(req.method==='GET' && req.url==='/fixture.js')
      return send(200,'text/javascript',fs.readFileSync(path.join(__dirname,'payment-handler-fixture.js')));
    if(req.method==='GET' && (req.url==='/' || req.url==='/?probe=1')){
      const html=fs.readFileSync(path.join(__dirname,'paymentresponse-lab.html'),'utf8');
      return send(200,'text/html',html.replace(/<label>Merchant\/payee[\s\S]+?<\/html>/,
        '<p>DISHA-owned synthetic method. No money moves.</p><button id="probe">Probe</button> '+
        '<button id="launch">Run synthetic transport</button><pre id="out"></pre>'+
        '<script src="/fixture.js"></script></html>'));
    }
    if(req.method==='POST' && req.url==='/issue')
      return send(200,'application/json',JSON.stringify({method,requestId:issue()}));
    if(req.method==='POST' && ['/probe/eligible','/probe/unavailable','/probe/error'].includes(req.url)){
      console.log('DISHA_FIXTURE',req.url);
      return send(204,'text/plain','');
    }
    if(req.method==='POST' && req.url==='/result'){
      let raw='';
      for await (const chunk of req){
        raw+=chunk;
        if(raw.length>4096) return send(413,'text/plain','Oversize');
      }
      let response;
      try{response=JSON.parse(raw)}catch{return send(400,'text/plain','Malformed JSON')}
      if(!accept(response)) return send(422,'text/plain','Rejected');
      console.log(JSON.stringify({event:'SYNTHETIC_TRANSPORT_OK',...response}));
      return send(200,'application/json','{"syntheticTransport":true,"debitVerified":false}');
    }
    return send(404,'text/plain','Not found');
  }};
}

if(require.main===module){
  const origin=process.env.DISHA_FIXTURE_ORIGIN||'https://localhost:18767';
  const url=new URL(origin);
  const fingerprint=process.env.DISHA_FIXTURE_FINGERPRINT||'';
  if(url.protocol!=='https:' || url.origin!==origin || !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(fingerprint))
    throw new Error('Set a valid HTTPS DISHA_FIXTURE_ORIGIN and APK SHA-256 DISHA_FIXTURE_FINGERPRINT');
  const fixture=createFixture(origin,fingerprint);
  const server=process.env.DISHA_FIXTURE_HTTP_CONTROL==='1'
    ?http.createServer(fixture.handler)
    :https.createServer({cert:fs.readFileSync(process.env.DISHA_FIXTURE_CERT),key:fs.readFileSync(process.env.DISHA_FIXTURE_KEY)},fixture.handler);
  server.listen(Number(process.env.DISHA_FIXTURE_PORT||18767),'127.0.0.1',()=>console.log('DISHA_FIXTURE_READY',fixture.method));
}
module.exports={createFixture};
