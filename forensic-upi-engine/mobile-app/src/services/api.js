// Only call your authenticated merchant proxy. Never expose n8n or worker API keys to apps.
export async function fetchSession({ merchantProxyUrl, publicSessionToken }) {
  if (!/^https:\/\//.test(merchantProxyUrl)) {
    throw new Error('HTTPS merchant proxy required');
  }
  const result = await fetch(
    merchantProxyUrl.replace(/\/$/, '') + '/public/payment-session',
    { headers: { Authorization: 'Bearer ' + publicSessionToken } }
  );
  if (!result.ok) throw new Error('Unable to fetch payment session');
  return await result.json();
}
