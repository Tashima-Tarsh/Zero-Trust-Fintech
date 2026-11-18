/**
 * DISHA 8.2 — Main Client-Side Controller
 * Connects Untouchable Canvas QR, WebSocket real-time updates,
 * Service Worker registration, and interactive Bento widgets.
 */

let activeSession = null;
let untouchableQrInstance = null;
let socket = null;

// Audio Chime (Browser Web Audio API synthesizer for instant zero-dependency sound)
function playSuccessChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';

    osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
    osc1.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.15); // G5
    osc1.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.35); // C6

    osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
    osc2.frequency.exponentialRampToValueAtTime(1318.51, audioCtx.currentTime + 0.35); // E6

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 0.65);
    osc2.stop(audioCtx.currentTime + 0.65);
  } catch (e) {
    console.warn('Audio synthesis not permitted without user gesture:', e.message);
  }
}

// 1. Initialize PWA Service Worker (TASK 7)
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      console.log('✅ [PWA] Service Worker registered with scope:', reg.scope);
    } catch (err) {
      console.warn('⚠️ [PWA] Service Worker registration failed:', err.message);
    }
  }
}

// 2. Fetch New Dynamic Session (TASK 2, 3, 4)
async function fetchNewSession(baseAmount = 100) {
  try {
    const res = await fetch(`/api/session/new?amount=${baseAmount}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to initialize session');
    }

    activeSession = data;
    updateUIWithSession(data);
    connectWebSocket(data.orderId);

    // Initialize or re-render Untouchable QR on canvas
    const canvas = document.getElementById('qrCanvas');
    if (!untouchableQrInstance) {
      untouchableQrInstance = new UntouchableQR(canvas, {
        refreshInterval: 15,
        onTick: (remaining, total) => {
          const timerEl = document.getElementById('timerSeconds');
          if (timerEl) timerEl.textContent = `${remaining}s`;
          const timerBar = document.getElementById('timerProgressBar');
          if (timerBar) {
            const pct = (remaining / total) * 100;
            timerBar.style.width = `${pct}%`;
          }
        },
        onRefresh: () => {
          console.log('🔄 [UntouchableQR] 15s timer elapsed. Fetching fresh challenge session...');
          fetchNewSession(activeSession ? activeSession.baseAmount : 100);
        }
      });
    }

    await untouchableQrInstance.render(data.qrDataUrl, data.upiLink);
  } catch (err) {
    console.error('Session error:', err);
  }
}

// 3. Connect Real-time WebSocket (TASK 11)
function connectWebSocket(orderId) {
  if (socket) {
    socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?orderId=${orderId}`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log(`🔌 [WebSocket] Connected for order: ${orderId}`);
    const statusText = document.getElementById('telemetryStatusText');
    if (statusText) statusText.textContent = 'Listening for incoming bank share...';
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('📨 [WebSocket] Message received:', msg);

      if (msg.type === 'SUCCESS') {
        handlePaymentSuccess(msg);
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  socket.onclose = () => {
    console.log('🔌 [WebSocket] Connection closed');
  };
}

// 4. Handle Payment Success
function handlePaymentSuccess(data) {
  playSuccessChime();

  if (window.navigator && typeof window.navigator.vibrate === 'function') {
    window.navigator.vibrate([100, 50, 150]);
  }

  // Redirect to success screen with comprehensive user, amount, time, and security parameters
  setTimeout(() => {
    const sender = data.senderVpa || (activeSession && activeSession.senderVpa) || 'customer@okhdfcbank';
    const vpa = data.vpaAddress || (activeSession && activeSession.vpaAddress) || 'ramesh.kirana@okhdfcbank';
    const base = data.baseAmount || (activeSession && activeSession.baseAmount) || '';
    const time = data.timestamp || Date.now();
    window.location.href = `/success.html?utr=${encodeURIComponent(data.utr)}&amount=${encodeURIComponent(data.amount)}&orderId=${encodeURIComponent(data.orderId)}&txId=${encodeURIComponent(data.txId || '')}&sender=${encodeURIComponent(sender)}&vpa=${encodeURIComponent(vpa)}&base=${encodeURIComponent(base)}&time=${encodeURIComponent(time)}`;
  }, 600);
}

// 5. Update DOM Elements
function updateUIWithSession(s) {
  const baseEl = document.getElementById('baseAmountVal');
  if (baseEl) baseEl.textContent = `₹${s.baseAmount.toFixed(2)}`;

  const chalEl = document.getElementById('challengeAmountVal');
  if (chalEl) chalEl.textContent = `₹${s.challengeAmount.toFixed(2)}`;

  const cents = Math.round((s.challengeAmount - s.baseAmount) * 100);
  const centsEl = document.getElementById('challengeCentsBadge');
  if (centsEl) centsEl.textContent = `+₹0.${cents < 10 ? '0' + cents : cents}`;

  const orderIdEl = document.getElementById('orderIdVal');
  if (orderIdEl) orderIdEl.textContent = s.orderId;

  const txnRefEl = document.getElementById('txnRefVal');
  if (txnRefEl) txnRefEl.textContent = s.txnRef;

  const vpaEl = document.getElementById('vpaAddressVal');
  if (vpaEl) vpaEl.textContent = s.vpaAddress;

  const simOrderEl = document.getElementById('simOrderIdInput');
  if (simOrderEl) simOrderEl.value = s.orderId;

  // Hide expired overlay if previously shown
  const expiredOverlay = document.getElementById('qrExpiredOverlay');
  if (expiredOverlay) expiredOverlay.style.display = 'none';

  // Update direct QR anchor link & mobile intent button
  const qrDirectLink = document.getElementById('qrDirectLink');
  if (qrDirectLink && s.upiLink) {
    qrDirectLink.href = s.upiLink;
  }

  const mobilePayBtn = document.getElementById('mobilePayButton');
  if (mobilePayBtn && s.upiLink) {
    mobilePayBtn.href = s.upiLink;
  }
}

function isMobileDevice() {
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 1);
  return isMobileUA || (isTouchDevice && window.innerWidth <= 820);
}

function getAppSpecificUri(app, baseUpi) {
  if (!baseUpi) return '';
  const query = baseUpi.includes('?') ? baseUpi.split('?')[1] : baseUpi.replace(/^upi:\/\/pay\??/, '');
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (app === 'gpay') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
    } else if (isIOS) {
      return `tez://upi/pay?${query}`;
    }
    return `upi://pay?${query}`;
  }

  if (app === 'phonepe') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=com.phonepe.app;end`;
    } else if (isIOS) {
      return `phonepe://pay?${query}`;
    }
    return `phonepe://pay?${query}`;
  }

  if (app === 'paytm') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=net.one97.paytm;end`;
    } else if (isIOS) {
      return `paytmmp://pay?${query}`;
    }
    return `paytmmp://pay?${query}`;
  }

  if (app === 'bhim') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=in.org.npci.upiapp;end`;
    }
    return `upi://pay?${query}`;
  }

  return baseUpi;
}

function dispatchUpiUri(uri) {
  if (!uri) return;
  window.__lastDispatchedUri = uri;
  try {
    const a = document.createElement('a');
    a.href = uri;
    a.target = '_top';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 120);
  } catch (_) {
    window.location.href = uri;
  }
}

window.triggerDirectUpiPay = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!activeSession || !activeSession.upiLink) {
    console.warn('Session not ready for direct UPI intent.');
    return;
  }

  if (isMobileDevice()) {
    // On mobile devices, launch the native UPI intent chooser directly
    dispatchUpiUri(activeSession.upiLink);
  } else {
    // On desktop PC/Laptop, show payment QR guidance and copy controls
    openDesktopModal();
  }
};

window.launchSpecificUpi = function(app) {
  if (!activeSession || !activeSession.upiLink) return;

  if (isMobileDevice()) {
    const targetUri = getAppSpecificUri(app, activeSession.upiLink);
    dispatchUpiUri(targetUri);
  } else {
    openDesktopModal();
  }
};

function openDesktopModal() {
  const modal = document.getElementById('desktopUpiModal');
  if (modal) modal.style.display = 'flex';
}

window.closeDesktopModal = function() {
  const modal = document.getElementById('desktopUpiModal');
  if (modal) modal.style.display = 'none';
};

window.copyUpiLink = function() {
  if (!activeSession || !activeSession.upiLink) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(activeSession.upiLink).then(() => {
      const btnText = document.getElementById('copyUpiBtnText');
      if (btnText) {
        const orig = btnText.textContent;
        btnText.textContent = '✓ Copied to Clipboard!';
        setTimeout(() => { btnText.textContent = orig; }, 2200);
      }
    }).catch(() => {
      prompt('Copy your UPI payment link:', activeSession.upiLink);
    });
  } else {
    prompt('Copy your UPI payment link:', activeSession.upiLink);
  }
};

window.fetchNewSession = fetchNewSession;

// 6. Interactive Savings Calculator (Bento Card 3)
function initSavingsCalculator() {
  const slider = document.getElementById('turnoverSlider');
  const turnoverVal = document.getElementById('calcTurnoverVal');
  const annualSavedVal = document.getElementById('calcAnnualSavedVal');
  const monthlySavedVal = document.getElementById('calcMonthlySavedVal');

  if (!slider) return;

  function updateCalc() {
    const val = parseFloat(slider.value);
    const formatted = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(val);
    if (turnoverVal) turnoverVal.textContent = `₹${formatted}/mo`;

    // 2.36% legacy gateway commission
    const monthlySaved = Math.round(val * 0.0236);
    const annualSaved = monthlySaved * 12;

    if (monthlySavedVal) monthlySavedVal.textContent = `₹${new Intl.NumberFormat('en-IN').format(monthlySaved)}`;
    if (annualSavedVal) annualSavedVal.textContent = `₹${new Intl.NumberFormat('en-IN').format(annualSaved)}`;
  }

  slider.addEventListener('input', updateCalc);
  updateCalc();
}

// 7. Interactive 7-Layer Fraud Sequential Animation (Bento Card 4)
function initFraudLayersAnimation() {
  const dots = document.querySelectorAll('.fraud-dot');
  if (dots.length === 0) return;

  let current = 0;
  setInterval(() => {
    dots.forEach((d, idx) => {
      if (idx <= current) d.classList.add('active');
      else d.classList.remove('active');
    });
    current = (current + 1) % (dots.length + 1);
  }, 1200);
}

// 9. Manual Receipt Submission Form (Fallback Testing)
window.submitManualReceipt = async function() {
  const rawText = document.getElementById('manualReceiptText').value;
  if (!rawText.trim()) return;

  const btn = document.getElementById('btnSubmitReceipt');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying with 7-Layer Engine...';
  }

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt: rawText,
        orderId: activeSession ? activeSession.orderId : null
      })
    });
    const data = await res.json();

    if (res.status === 200 && data.verified === true && data.state === 'VERIFIED') {
      handlePaymentSuccess(data);
    } else if (res.status === 202 && data.state === 'UTR_OBSERVED') {
      alert('UPI reference recorded. Bank credit has not been independently confirmed. The order remains pending.');
      if (btn) { btn.disabled = false; btn.textContent = 'Verify Receipt'; }
    } else {
      alert(`⚠️ Payment Verification Rejected:\nLayer ${data.layer || ''}: ${data.reason || data.error || ''}`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Verify Receipt';
      }
    }
  } catch (err) {
    alert(`Verification error: ${err.message}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify Receipt';
    }
  }
};

// DOM Content Loaded Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  fetchNewSession(100);
  initSavingsCalculator();
  initFraudLayersAnimation();
});
