(() => {
  const nativeFetch = window.fetch.bind(window);
  let provider = 'legacy';
  const auth = window.dishaAuth = {
    token: async () => { await auth.ready; return provider === 'clerk' ? window.Clerk.session?.getToken() : sessionStorage.getItem('disha_token'); },
    signOut: async () => {
      await auth.ready;
      sessionStorage.removeItem('disha_token');
      sessionStorage.removeItem('disha_merchant');
      if (provider === 'clerk') return window.Clerk.signOut({ redirectUrl: '/login' });
      await nativeFetch('/api/auth/logout', { method: 'POST' });
      location.assign('/login');
    },
  };
  function loadScript(src, publishableKey) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      if (publishableKey) script.dataset.clerkPublishableKey = publishableKey;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Secure sign-in could not load. Please retry.'));
      document.head.appendChild(script);
    });
  }
  auth.ready = (async () => {
    const response = await nativeFetch('/api/auth/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in configuration is unavailable');
    const config = await response.json();
    provider = config.provider;
    if (provider !== 'clerk') return;
    sessionStorage.removeItem('disha_token');
    const domain = atob(config.publishableKey.split('_')[2]).replace(/\$$/, '');
    if (!/^[a-zA-Z0-9.-]+$/.test(domain)) throw new Error('Invalid sign-in configuration');
    await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await loadScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, config.publishableKey);
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  })();
  // Every merchant request receives a fresh short-lived Clerk token.
  window.fetch = async (input, init = {}) => {
    const target = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (target.origin !== location.origin || !/^\/api\/(auth|merchant)(\/|$)/.test(target.pathname)) return nativeFetch(input, init);
    await auth.ready;
    if (provider !== 'clerk') return nativeFetch(input, init);
    const token = await window.Clerk.session?.getToken();
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete('Authorization');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return nativeFetch(input, { ...init, headers });
  };
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await auth.ready;
      if (provider !== 'clerk') return;
      const login = document.getElementById('clerk-login');
      if (login) {
        const legacy = document.querySelector('.auth-card');
        if (legacy) legacy.style.display = 'none';
        login.hidden = false;
        login.style.display = 'grid';
        if (window.Clerk.session) { location.replace('/dashboard'); return; }
        window.Clerk.mountSignIn(login, { routing: 'hash', forceRedirectUrl: '/dashboard', signUpForceRedirectUrl: '/setup' });
      } else if (window.Clerk.session) {
        const account = document.getElementById('disha-account');
        if (account) window.Clerk.mountUserButton(account, { afterSignOutUrl: '/login' });
      }
    } catch (error) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = error.message;
      document.body.prepend(message);
    }
  });
})();
