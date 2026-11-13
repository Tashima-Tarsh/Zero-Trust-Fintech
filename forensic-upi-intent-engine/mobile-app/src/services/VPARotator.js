/**
 * Rotation MUST happen atomically on the server; the client only displays the lease.
 * This helper never chooses or modifies a payee address.
 */
export async function retrieveAssignedVPA({ merchantProxyUrl, publicSessionToken }) {
  if (!/^https:\/\//.test(merchantProxyUrl)) throw new Error('HTTPS merchant proxy required');
  const response = await fetch(
    merchantProxyUrl.replace(/\/$/, '') + '/public/payment-session',
    { headers: { Authorization: 'Bearer ' + publicSessionToken } }
  );
  if (!response.ok) throw new Error('Unable to retrieve assigned merchant VPA');
  const session = await response.json();
  if (session.status !== 'PENDING') throw new Error('Session no longer accepts payment initiation');
  if (new Date(session.expires_at).getTime() <= Date.now()) throw new Error('Session expired');
  return { vpa: session.vpa, amount_paise: session.amount_paise, id: session.id, expires_at: session.expires_at };
}
