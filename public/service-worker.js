/**
 * DISHA 8.2 — Service Worker & Web Share Target Receiver
 * Intercepts incoming Android Share Sheet receipts from PhonePe, GPay, Paytm, etc.
 * Extracts 12-digit Bank UTR and challenge amount, and submits for 7-layer verification.
 */

const CACHE_NAME = 'disha-8.2-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/success.html',
  '/failed.html',
  '/styles.css',
  '/app.js',
  '/qr.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// TASK 7: Web Share Target Interceptor
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if this is the Web Share Target action
  if (event.request.method === 'POST' && url.pathname === '/handle-share') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const sharedTitle = formData.get('title') || '';
          const sharedText = formData.get('text') || '';
          const rawReceipt = `${sharedTitle}\n${sharedText}`.trim();

          console.log('[ServiceWorker] Intercepted shared receipt text:\n', rawReceipt);

          // 2. Extract 12-digit UTR
          const utrMatch = rawReceipt.match(/\b\d{12}\b/);
          const utr = utrMatch ? utrMatch[0] : null;

          // 3. Extract Amount
          const amtMatch = rawReceipt.match(/[₹Rs\.]?\s*(\d+(?:\.\d{2})?)/i);
          const amount = amtMatch ? parseFloat(amtMatch[1]) : null;

          // Extract optional order ID if present in note
          const orderMatch = rawReceipt.match(/Order_[A-Z0-9]+/i);
          const orderId = orderMatch ? orderMatch[0] : null;

          if (!utr || !amount) {
            return Response.redirect(
              `/failed.html?reason=${encodeURIComponent('Could not detect 12-digit NPCI UTR or amount from receipt text')}`,
              303
            );
          }

          // 4. POST to /api/verify
          const verifyResponse = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              utr,
              amount,
              receipt: rawReceipt,
              orderId
            })
          });

          const verifyData = await verifyResponse.json();

          // 5. Redirect based on verification outcome
          if (verifyData.success) {
            return Response.redirect(
              `/success.html?utr=${encodeURIComponent(utr)}&amount=${encodeURIComponent(amount)}&orderId=${encodeURIComponent(verifyData.orderId || '')}`,
              303
            );
          } else {
            return Response.redirect(
              `/failed.html?reason=${encodeURIComponent(verifyData.reason || 'Verification rejected by 7-layer engine')}&layer=${encodeURIComponent(verifyData.layer || 'Fraud Check')}`,
              303
            );
          }
        } catch (err) {
          console.error('[ServiceWorker] Share handling error:', err);
          return Response.redirect(`/failed.html?reason=${encodeURIComponent(err.message)}`, 303);
        }
      })()
    );
    return;
  }

  // Standard Network-First caching strategy
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
