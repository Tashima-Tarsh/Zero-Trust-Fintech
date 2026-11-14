self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname === '/handle-share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        let sharedText = '';
        if (typeof event.request.formData === 'function') {
          try {
            const formData = await event.request.formData();
            sharedText = formData.get('text') || formData.get('title') || formData.get('description') || '';
          } catch (e) {
            console.warn('[SharePay SW] formData extraction failed, trying text fallback:', e);
          }
        }
        
        if (!sharedText && typeof event.request.text === 'function') {
          try {
            const rawBody = await event.request.text();
            // Handle urlencoded body if present
            if (rawBody && rawBody.includes('=')) {
              const params = new URLSearchParams(rawBody);
              sharedText = params.get('text') || params.get('title') || rawBody;
            } else {
              sharedText = rawBody;
            }
          } catch (e) {
            console.warn('[SharePay SW] text extraction failed:', e);
          }
        }
        
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
