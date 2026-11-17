/* DISHA 8.2 — High-Trust Sovereign UPI Checkout
   Auto-initializes live payment challenge with zero empty states
   WebSocket + fallback polling for 0s direct bank confirmation */
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
  let currentAmount = 500;

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
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
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
    if (!Number.isFinite(amount) || amount <= 0) {
      amount = 500;
    }
    currentAmount = amount;

    stop();
    completed = false;
    setStatus('Generating Sovereign Challenge…', 'Contacting direct bank settlement service.');

    const path = '/api/session/new?' + new URLSearchParams({
      amount: String(amount),
      description: description || 'UPI Sovereign Settlement'
    });

    try {
      const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || d.error || 'Challenge session creation failed');

      session = d;
      render(d);
      setStatus('Awaiting Payment', 'Scan QR or select an app below. Funds settle straight to bank.', 'pending');
      watch(d);
    } catch (e) {
      setStatus('Could not start payment', 'Unable to create a payment session. Please try again.', 'error');
    }
  }

  function render(s) {
    if ($('checkoutMerchant')) $('checkoutMerchant').textContent = s.merchantName || 'Nitish Enterprise';
    if ($('checkoutOrder')) $('checkoutOrder').textContent = s.orderId || 'ORD-LIVE';
    if ($('checkoutVpa')) $('checkoutVpa').textContent = s.vpaAddress || '';
    if ($('checkoutDescription')) $('checkoutDescription').textContent = s.description || 'UPI Sovereign Settlement';
    if ($('checkoutAmount')) $('checkoutAmount').textContent = nf.format(s.challengeAmount || s.baseAmount || currentAmount);
    if ($('amountNote')) $('amountNote').textContent = 'Exact challenge amount · 100% direct bank deposit';
    if ($('checkoutQr') && s.qrDataUrl) $('checkoutQr').src = s.qrDataUrl;
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

      if ($('checkoutTimer')) {
        $('checkoutTimer').textContent = delta === null
          ? '03:00'
          : `${Math.floor(delta / 60).toString().padStart(2, '0')}:${String(delta % 60).padStart(2, '0')}`;
      }

      if (delta === 0 && !completed) {
        stop();
        setStatus('Challenge Window Expired', 'Click below to regenerate a fresh session.', 'expired');
      }
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  function watch(s) {
    if ('WebSocket' in window && s.sessionId) {
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
        setStatus('Payment window expired', 'Please regenerate challenge.', 'expired');
      } else if (state === 'VERIFY_WINDOW') {
        setStatus('Validating bank UTR…', 'Transaction received, verifying cryptographically.');
      }
    } catch {}
  }

  function verifySuccess(d) {
    if (completed) return;
    completed = true;
    stop();
    setStatus('Payment Verified & Settled Direct', '100% of funds deposited to bank. ₹0 fee deducted.', 'verified');
    if ($('payTitle')) $('payTitle').textContent = 'Payment Completed Successfully';
    toast('Payment confirmed! Bank deposit complete.');
  }

  function openApp(which) {
    if (!session?.upiLink) {
      toast('Generating request… please wait.');
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

  function init() {
    // Quick preset buttons to switch amount immediately
    document.querySelectorAll('.chip-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const amt = Number(btn.dataset.preset);
        if ($('customAmtBox')) $('customAmtBox').style.display = 'none';
        start(amt, 'UPI Sovereign Settlement');
      });
    });

    // Custom Amount Toggle
    const customChip = $('customChipBtn');
    const customBox = $('customAmtBox');
    if (customChip && customBox) {
      customChip.addEventListener('click', () => {
        document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        customChip.classList.add('active');
        customBox.style.display = customBox.style.display === 'none' ? 'block' : 'none';
        $('customAmountInput')?.focus();
      });
    }

    $('checkoutCustomForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const val = Number($('customAmountInput')?.value);
      if (val > 0) {
        start(val, 'UPI Sovereign Settlement');
      }
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

    $('newPayment')?.addEventListener('click', () => {
      start(currentAmount, 'UPI Sovereign Settlement');
    });

    window.addEventListener('pagehide', stop);

    // AUTO-START ON LOAD: Never leave user in a blank or empty state!
    const queryAmount = Number(qs.get('amount'));
    const initialAmount = (Number.isFinite(queryAmount) && queryAmount > 0) ? queryAmount : 500;
    start(initialAmount, qs.get('description') || 'UPI Sovereign Settlement');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
