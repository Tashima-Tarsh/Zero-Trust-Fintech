/**
 * Device-signed client action claim. The signing callback must use an
 * enrolled device-held Ed25519 key via a native secure signing module.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const o = {};
    Object.keys(value).sort().forEach(k => { o[k] = canonical(value[k]); });
    return o;
  }
  return value;
}
export function canonicalAttestationPayload(payload) {
  const { client_signature, ...signed } = payload;
  return JSON.stringify(canonical(signed));
}
export async function postClientAttestation({
  apiUrl, session_id, user_id, device_id, utr, amount, integrity, signBase64
}) {
  if (typeof signBase64 !== 'function') throw new Error('Native secure signer required');
  if (!/^https:\/\//.test(apiUrl)) throw new Error('HTTPS is required');
  if (!/^(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$/.test(amount)) throw new Error('Invalid amount');
  const payload = {
    session_id, user_id, device_id, utr, amount,
    timestamp: new Date().toISOString(), integrity
  };
  const client_signature = await signBase64(canonicalAttestationPayload(payload));
  if (!client_signature) throw new Error('Device signature unavailable');
  const response = await fetch(apiUrl.replace(/\/$/, '') + '/v1/client/attest-payment', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...payload, client_signature})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result.detail || 'Attestation rejected'));
  return result;
}
