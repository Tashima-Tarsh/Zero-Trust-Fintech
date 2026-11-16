const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdentityService } = require('../disha-cinematic/identity');

test('unsigned requests cannot resolve an existing merchant', async () => {
  const service = createIdentityService({ client: { authenticateRequest: async () => ({ isSignedIn: false }) }, store: { resolve: () => { throw Error('must not resolve'); } }, origin: 'https://example.com' });
  assert.equal(await service.authenticate({ url: '/api/auth/me', headers: {} }), null);
});
test('a verified Clerk session maps its stable subject to a merchant', async () => {
  let subject;
  const service = createIdentityService({ client: { authenticateRequest: async () => ({ isSignedIn: true, toAuth: () => ({ userId: 'user_1' }) }), users: { getUser: async () => ({ primaryEmailAddressId: 'email_1', emailAddresses: [{ id: 'email_1', emailAddress: 'Owner@example.com', verification: { status: 'verified' } }] }) } }, store: { find: () => null, resolve: (id, email) => { subject = [id,email]; return { id: 'merchant_1' }; } }, origin: 'https://example.com' });
  assert.deepEqual(await service.authenticate({ url: '/api/auth/me', headers: {} }), {id:'merchant_1'});
  assert.deepEqual(subject, ['user_1','owner@example.com']);
});
test('unverified primary email never provisions or links a merchant', async () => {
  const service = createIdentityService({ client: { authenticateRequest: async () => ({ isSignedIn:true,toAuth:()=>({userId:'user_1'}) }), users:{getUser:async()=>({primaryEmailAddressId:'e',emailAddresses:[{id:'e',emailAddress:'owner@example.com',verification:{status:'unverified'}}]})} }, store:{find:()=>null,resolve:()=>{throw Error('must not resolve');}},origin:'https://example.com'});
  assert.equal(await service.authenticate({url:'/api/auth/me',headers:{}}),null);
});
test('an existing subject retains merchant ownership without email relinking', async () => {
  const service = createIdentityService({client:{authenticateRequest:async()=>({isSignedIn:true,toAuth:()=>({userId:'user_1'})})},store:{find:id=>({id:'merchant_1'}),resolve:()=>{throw Error('must not relink');}},origin:'https://example.com'});
  assert.deepEqual(await service.authenticate({url:'/api/auth/me',headers:{}}),{id:'merchant_1'});
});
