/* DISHA 8.2 — Sovereign High-Trust Checkout
   Connects to existing /api/session/new and /api/order-state/:orderId
   Maintains WebSocket real-time sync with fallback polling */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const preview = qs.get('preview') === '1';

  let session = null;
  let ws = null;
  let poller = null;
  let timer = null;
  let completed = false;

  const nf = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function toast(str) {
    const t = $('toast');
    if (!t) return;
    t.textContent = str;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 4000);
  }

  function setStatus(title, desc, type = 'idle') {
    const box = $('paymentStatus');
    if (!box) return;
    $('paymentStatusTitle').textContent = title;
    $('paymentStatusDesc').textContent = desc;
    box.dataset.state = type;
  }

  function stop() {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    if (poller) clearInterval(poller);
    if (timer) clearInterval(timer);
    poller = timer = null;
  }

  async function start(amount, description) {
    if (preview) {
      toast('Visual preview mode. To generate real UPI intent, launch without ?preview=1');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Please enter a valid amount greater than ₹0.');
      return;
    }

    stop();
    completed = false;
    setStatus('Generating Sovereign Challenge…', 'Contacting direct bank settlement service.');

    const path = '/api/session/new?' + new URLSearchParams({
      amount: String(amount),
      description: description || 'UPI Payment'
    });

    try {
      const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || d.error || 'Challenge session creation failed');

      session = d;
      render(d);
      setStatus('Waiting for payment in UPI app', 'Scan QR or select an app below. Funds settle straight to bank.', 'pending');
      watch(d);
      $('newPayment').hidden = false;
    } catch (e) {
      setStatus('Unable to create payment challenge', e.message || 'Please verify your network connection and retry.', 'expired');
      $('setupPayment').hidden = false;
      $('activePayment').hidden = true;
    }
  }

  function render(s) {
    $('checkoutMerchant').textContent = s.merchantName || 'Verified Merchant';
    $('checkoutOrder').textContent = s.orderId || '—';
    $('checkoutVpa').textContent = s.vpaAddress || '—';
    $('checkoutDescription').textContent = s.description || 'UPI Payment';
    $('checkoutAmount').textContent = nf.format(s.challengeAmount || s.baseAmount || 0);
    $('amountNote').textContent = Number(s.challengeAmount) !== Number(s.baseAmount)
      ? 'Exact amount challenge generated to eliminate fraud.'
      : 'Authorizable in any authentic UPI app.';
    $('checkoutQr').src = s.qrDataUrl || '';
    $('activePayment').hidden = false;
    $('setupPayment').hidden = true;
    countdown(s);
  }

  function countdown(s) {
    if (timer) clearInterval(timer);
    function tick() {
      let expiry = Number(s.expiresAt);
      if (!Number.isFinite(expiry)) {
        const converted = Date.parse(s.expiresAt);
        expiry = Number.isFinite(converted) ? converted : 0;
      }
      if (expiry && expiry < 1e12) expiry *= 1000;
      const delta = expiry ? Math.max(0, Math.floor((expiry - Date.now()) / 1000)) : null;

      $('checkoutTimer').textContent = delta === null
        ? 'Active'
        : `${Math.floor(delta / 60)}:${String(delta % 60).padStart(2, '0')}`;

      if (delta === 0 && !completed) {
        stop();
        setStatus('Payment challenge expired', 'Create a new request to pay with guaranteed zero commission.', 'expired');
      }
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  function watch(s) {
    if ('WebSocket' in window) {
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}/ws?orderId=${encodeURIComponent(s.orderId)}&token=${encodeURIComponent(s.sessionId)}`);
        ws.onmessage = e => {
          try {
            const d = JSON.parse(e.data);
            if (d.type === 'SUCCESS') verifySuccess(d);
          } catch {}
        };
      } catch {}
    }
    poller = setInterval(checkState, 3000);
    checkState();
  }

  async function checkState() {
    if (!session || completed) return;
    try {
      const u = `/api/order-state/${encodeURIComponent(session.orderId)}?token=${encodeURIComponent(session.sessionId)}`;
      const res = await fetch(u, {
        cache: 'no-store',
        headers: { 'X-CSRF-Token': session.sessionId }
      });
      const d = await res.json();
      if (!res.ok || !d.success) return;

      const state = String(d.state || d.status || '').toUpperCase();
      if (state === 'VERIFIED' || state === 'SUCCESS') {
        verifySuccess(d);
      } else if (state === 'EXPIRED') {
        stop();
        setStatus('Payment window expired', 'Please create a new request.', 'expired');
      } else if (state === 'VERIFY_WINDOW') {
        setStatus('Verifying bank UTR…', 'Transaction is being validated against bank records.');
      } else if (state === 'WAITING' || state === 'PENDING') {
        setStatus('Awaiting payment authorization', 'Listening for incoming bank webhook/push notification.', 'pending');
      }
    } catch {}
  }

  function verifySuccess(d) {
    if (completed) return;
    completed = true;
    stop();
    setStatus('Payment Verified & Settled Direct', '100% of funds deposited directly to merchant account. ₹0 fee deducted.', 'verified');
    $('newPayment').hidden = false;
    $('payTitle').textContent = 'Payment Completed Successfully';
    toast('Payment confirmed! Bank deposit complete.');
  }

  function openApp(which) {
    if (!session?.upiLink) {
      toast('Please generate a payment request first.');
      return;
    }
    let link = session.upiLink;
    if (which && session.appLinks) {
      const mobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      link = mobile
        ? (session.appLinks.ios?.[which] || link)
        : (session.appLinks.android?.[which] || link);
    }
    window.location.href = link;
  }

  function reset() {
    stop();
    session = null;
    completed = false;
    $('checkoutMerchant').textContent = 'Awaiting payment request';
    $('checkoutOrder').textContent = '—';
    $('checkoutVpa').textContent = '—';
    $('checkoutAmount').textContent = '—';
    $('checkoutTimer').textContent = '—';
    $('activePayment').hidden = true;
    $('setupPayment').hidden = false;
    $('newPayment').hidden = true;
    $('payTitle').textContent = 'Complete Your UPI Payment';
    setStatus('Ready to Pay', 'Enter an amount above to generate a dynamic request.');
  }

  function init() {
    // Amount preset chip click handlers
    document.querySelectorAll('.preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const amt = btn.dataset.preset;
        if (amt && $('checkoutInputAmount')) {
          $('checkoutInputAmount').value = amt;
          $('checkoutInputAmount').focus();
        }
      });
    });

    if (preview) {
      $('previewNotice').style.display = 'block';
      $('checkoutInputAmount').value = '500';
      $('checkoutAmount').textContent = '₹500.00';
      $('checkoutMerchant').textContent = 'Nitish Enterprise (Sample)';
      $('checkoutVpa').textContent = 'merchant@oksbi';
      $('checkoutOrder').textContent = 'PREVIEW-ONLY-82';
      setStatus('Design Preview', 'Real-time WebSocket and bank verification active in production mode.');
    }

    const amount = Number(qs.get('amount'));
    if (!preview && Number.isFinite(amount) && amount > 0) {
      $('checkoutInputAmount').value = String(amount);
      $('checkoutInputNote').value = qs.get('description') || '';
      start(amount, $('checkoutInputNote').value);
    }

    $('checkoutStartForm')?.addEventListener('submit', e => {
      e.preventDefault();
      start(Number($('checkoutInputAmount').value), $('checkoutInputNote').value.trim());
    });

    $('openGeneric')?.addEventListener('click', () => openApp());

    document.querySelectorAll('[data-app]').forEach(b => {
      b.addEventListener('click', () => openApp(b.dataset.app));
    });

    $('copyUpi')?.addEventListener('click', async () => {
      if (!session?.upiLink) return;
      try {
        await navigator.clipboard.writeText(session.upiLink);
        toast('UPI payment link copied to clipboard.');
      } catch {
        toast('Unable to copy automatically.');
      }
    });

    $('newPayment')?.addEventListener('click', reset);
    window.addEventListener('pagehide', stop);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
