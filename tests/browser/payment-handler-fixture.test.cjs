'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {createFixture}=require('./payment-handler-fixture.cjs');
const fixture=createFixture('https://localhost:18767','');
const id=fixture.issue();
const response={requestId:id,methodName:fixture.method,
  details:{requestId:id,synthetic:true,outcome:'TRANSPORT_OK'}};
assert.equal(fixture.accept({...response,requestId:'unknown'}),false);
assert.equal(fixture.accept({...response,methodName:'https://example.invalid/pay'}),false);
assert.equal(fixture.accept({...response,details:'malformed'}),false);
assert.equal(fixture.accept({...response,details:{...response.details,requestId:'wrong'}}),false);
assert.equal(fixture.accept({...response,details:{...response.details,synthetic:false}}),false);
assert.equal(fixture.accept({...response,details:{...response.details,debitVerified:true}}),false);
assert.equal(fixture.accept(response),true);
assert.equal(fixture.accept(response),false);
console.log('PASS: eight synthetic correlation, malformed response and replay checks');

(async()=>{
  const server=http.createServer(fixture.handler);
  try {
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const page=await fetch(base);
    assert.match(await page.text(),/Run synthetic transport/);
    const {requestId}=await (await fetch(base+'/issue',{method:'POST'})).json();
    const send=body=>fetch(base+'/result',{method:'POST',body});
    assert.equal((await send('{')).status,400);
    const valid=JSON.stringify({...response,requestId,details:{...response.details,requestId}});
    const accepted=await send(valid);
    assert.equal(accepted.status,200);
    assert.deepEqual(await accepted.json(),{syntheticTransport:true,debitVerified:false});
    assert.equal((await send(valid)).status,422);
    console.log('PASS: HTTP issue, malformed rejection, synthetic result and replay rejection');
  } finally {server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
