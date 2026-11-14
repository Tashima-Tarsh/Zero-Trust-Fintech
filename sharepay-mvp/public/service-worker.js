self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname === '/handle-share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const sharedText = formData.get('text') || formData.get('title') || '';
        
        console.log('[SharePay SW] Captured receipt text:', sharedText);
        
        // Forward to the verification endpoint with cookies attached
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ receipt: sharedText })
        });
        
        const result = await response.json();
        
        if (result.success) {
          return Response.redirect(`/success?utr=${encodeURIComponent(result.utr)}&orderId=${encodeURIComponent(result.orderId)}`, 303);
        } else {
          const reason = result.reason || 'VERIFICATION_FAILED';
          const orderId = result.orderId || '';
          return Response.redirect(`/failed?reason=${encodeURIComponent(reason)}&orderId=${encodeURIComponent(orderId)}`, 303);
        }
      } catch (error) {
        console.error('[SharePay SW] Processing error:', error);
        return Response.redirect('/failed?reason=SERVICE_WORKER_ERROR', 303);
      }
    })());
  }
});
