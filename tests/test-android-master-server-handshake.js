'use strict';
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createLabServer}=require('../android/credential-holder-fixture/lab-server');
let now=Date.now();const lab=createLabServer(()=>now);
const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const start=()=>lab.issue({sessionId:'lab-android-session'});
const a=start();
const sign=data=>crypto.sign('sha256',Buffer.from(['DISHA-ANDROID-HANDSHAKE-V1',data.sessionId,
data.challenge,'https://disha8-2.thenitishkr.in'].join('\n')),pair.privateKey).toString('base64');
const body={sessionId:a.sessionId,challenge:a.challenge,
 publicKeySpki:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),signature:sign(a)};
assert.throws(()=>lab.verify({...body,challenge:'a'.repeat(64)}),/CHALLENGE/);
assert.throws(()=>lab.verify({...body,signature:sign({...a,challenge:'b'.repeat(64)})}),/BAD_SIGNATURE/);
const result=lab.verify(body);assert.equal(result.deviceKeyPossession,true);
assert.equal(result.paymentVerified,false);assert.equal(result.utr,null);
assert.throws(()=>lab.verify(body),/CHALLENGE/);
const b=start();now+=70000;
assert.throws(()=>lab.verify({...body,challenge:b.challenge,signature:sign(b)}),/CHALLENGE/);
lab.handler.close();
console.log('ANDROID_MASTER_SERVER_HANDSHAKE_PASS');
