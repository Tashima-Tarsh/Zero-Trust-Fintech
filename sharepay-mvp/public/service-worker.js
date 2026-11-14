self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname === '/handle-share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const sharedText = formData.get('text') || '';
        
        console.log('Captured:', sharedText);
        
        // Extract UTR (12 digits)
        const utrMatch = sharedText.match(/\b\d{12}\b/);
        // Extract amount (₹100 or Rs.100.37)
        const amountMatch = sharedText.match(/[₹Rs\.]?\s*(\d+(?:\.\d{2})?)/i);
        
        if (utrMatch && amountMatch) {
          const utr = utrMatch[0];
          const amount = parseFloat(amountMatch[1]);
          
          // Send to backend
          const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ utr, amount, receipt: sharedText })
          });
          
          const result = await response.json();
          
          if (result.success) {
            return Response.redirect('/success?utr=' + utr, 303);
          } else {
            return Response.redirect('/failed?reason=' + result.error, 303);
          }
        } else {
          return Response.redirect('/failed?reason=PARSE_ERROR', 303);
        }
      } catch (error) {
        console.error(error);
        return Response.redirect('/failed?reason=ERROR', 303);
      }
    })());
  }
});
