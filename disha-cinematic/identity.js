function createIdentityService({ client, store, origin, notify = async () => {} }) {
  const appOrigin = new URL(origin).origin;
  return {
    async authenticate(req) {
      const target = new URL(req.url, appOrigin);
      if (target.origin !== appOrigin) return null;
      const headers = new Headers();
      for (const name of ['authorization', 'cookie']) {
        if (req.headers[name]) headers.set(name, req.headers[name]);
      }
      let state;
      try {
        state = await client.authenticateRequest(new Request(target, { headers }), {
          authorizedParties: [appOrigin], acceptsToken: 'session_token',
        });
      } catch (_) { return null; }
      if (!state.isSignedIn) return null;
      const { userId } = state.toAuth();
      if (!userId) return null;
      let merchant = store.find(userId);
      if (!merchant) {
        const user = await client.users.getUser(userId);
        const email = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId);
        if (!email || email.verification?.status !== 'verified') return null;
        merchant = store.resolve(userId, email.emailAddress.toLowerCase().trim());
      }
      if (merchant) void notify(userId, merchant).catch(() => console.error('Welcome email delivery pending'));
      return merchant;
    },
  };
}

let runtime;
function getIdentityService() {
  if (!process.env.CLERK_PUBLISHABLE_KEY && !process.env.CLERK_SECRET_KEY) return null;
  if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY || !process.env.APP_URL) {
    throw new Error('Clerk requires publishable key, secret key and APP_URL');
  }
  if (!runtime) {
    const { createClerkClient } = require('@clerk/backend');
    const store = require('./identity-store');
    runtime = createIdentityService({
      client: createClerkClient({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY, secretKey: process.env.CLERK_SECRET_KEY }),
      store, origin: process.env.APP_URL, notify: store.sendWelcome,
    });
  }
  return runtime;
}
module.exports = { createIdentityService, getIdentityService };
