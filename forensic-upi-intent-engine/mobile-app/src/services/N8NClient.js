/**
 * Never put n8n worker credentials or raw n8n webhook URLs into mobile bundles.
 * Call a scoped HTTPS merchant proxy that owns the n8n credentials.
 */
export async function postMerchantAction({ merchantProxyUrl, publicSessionToken, action, payload }) {
  if (!/^https:\/\//.test(merchantProxyUrl)) throw new Error('HTTPS merchant proxy required');
  if (!['session-status', 'consented-risk-signal'].includes(action)) throw new Error('Action not allowed');
  if (!publicSessionToken) throw new Error('Missing scoped token');
  const response = await fetch(
    merchantProxyUrl.replace(/\/$/, '') + '/public/' + action,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + publicSessionToken
      },
      body: JSON.stringify(payload ?? {})
    }
  );
  if (!response.ok) throw new Error('Merchant action failed');
  return response.json();
}
