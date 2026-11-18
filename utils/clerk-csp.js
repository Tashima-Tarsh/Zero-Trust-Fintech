'use strict';

/**
 * Content Security Policy for the browser-facing DISHA checkout and merchant
 * SaaS. Clerk serves its browser bundles, API and challenges from the FAPI
 * host encoded in the PUBLIC publishable key; it need not be the custom domain.
 * Never use the secret key, arbitrary query parameters, or wildcard script hosts.
 */
function clerkFrontendApiOrigin(publishableKey) {
  if (typeof publishableKey !== 'string') return null;
  const match = /^pk_(?:test|live)_([A-Za-z0-9_-]+)$/.exec(publishableKey.trim());
  if (!match) return null;
  let host;
  try {
    host = Buffer.from(match[1], 'base64url').toString('utf8').replace(/(?:\$|\0+)$/, '').toLowerCase();
  } catch (_) {
    return null;
  }
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) ||
      host.includes('..') || host.startsWith('.') || host.endsWith('.') ||
      !host.includes('.') || host.split('.').some(label =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    return null;
  }
  return 'https://' + host;
}

function buildContentSecurityPolicy(publishableKey) {
  const frontendOrigin = clerkFrontendApiOrigin(publishableKey);
  const fapi = frontendOrigin ? ' ' + frontendOrigin : '';
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com" +
      fapi + ' https://challenges.cloudflare.com https://*.protect.clerk.com',
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://lh4.googleusercontent.com https://img.clerk.com https://assets.science.nasa.gov https://astro4edu.org https://eoimages.gsfc.nasa.gov https://svs.gsfc.nasa.gov",
    "connect-src 'self' ws: wss:" + fapi +
      ' https://*.protect.clerk.com:* https://clerk-telemetry.com https://*.clerk-telemetry.com',
    "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
    "worker-src 'self' blob:",
    "form-action 'self'"
  ].join('; ');
}

module.exports = {clerkFrontendApiOrigin, buildContentSecurityPolicy};
