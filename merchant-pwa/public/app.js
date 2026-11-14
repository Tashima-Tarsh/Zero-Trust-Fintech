// Configuration & Persistence
const DEFAULT_CONFIG = {
  API_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000/api/v1'
    : `${window.location.origin}/api/v1`,
  WS_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'ws://localhost:8000/ws'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
  MERCHANT_ID: 'merchant_001',
  MERCHANT_VPA: 'yourstore@upi'
};

function getConfig() {
  const saved = localStorage.getItem('sharepay_config');
  if (saved) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Failed parsing saved config:', e);
    }
  }
  return { ...DEFAULT_CONFIG };
}

let CONFIG = getConfig();

// Application State
let ws = null;
let currentChallenge = null;
let challengeTimer = null;
let payments = [];
let totalAmount = 0;

// DOM Elements
const paymentForm = document.getElementById('paymentForm');
const qrSection = document.getElementById('qrSection');
const paymentsList = document.getElementById('paymentsList');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');

// Lifecycle Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadSavedPayments();
  connectWebSocket();
  registerServiceWorker();
  
  paymentForm.addEventListener('submit', handlePaymentRequest);
  document.getElementById('copyLink').addEventListener('click', copyPaymentLink);
  
  // Populate settings fields
  document.getElementById('merchantVPA').textContent = CONFIG.MERCHANT_VPA;
});

// PWA Service Worker Registration
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker registered with scope:', reg.scope);
    } catch (error) {
      console.warn('Service Worker registration skipped:', error);
    }
  }
}

// WebSocket Connection & Real-Time Settlement Broadcast
function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  const wsUrl = `${CONFIG.WS_URL}/${encodeURIComponent(CONFIG.MERCHANT_ID)}`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  statusText.textContent = 'Connecting...';
  connectionStatus.className = 'status-dot';

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connectionStatus.className = 'status-dot connected';
      statusText.textContent = `Live (${CONFIG.MERCHANT_ID})`;
      console.log('✅ WebSocket connected to Zero-Trust Backend');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'payment_confirmed') {
          handlePaymentConfirmation(data);
        } else if (data.type === 'pong') {
          // Heartbeat ack
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      connectionStatus.className = 'status-dot';
      statusText.textContent = 'Disconnected';
      console.warn('WebSocket disconnected. Reconnecting in 4 seconds...');
      setTimeout(connectWebSocket, 4000);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
    };
  } catch (err) {
    console.error('WebSocket initialization failure:', err);
    setTimeout(connectWebSocket, 5000);
  }

  // Periodic heartbeat keep-alive (every 25 seconds)
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send('ping'); } catch (e) {}
    }
  }, 25000);
}

// Handle Payment Request & Dynamic Challenge Generation
async function handlePaymentRequest(event) {
  event.preventDefault();

  const amount = parseFloat(document.getElementById('amount').value);
  const orderId = document.getElementById('orderId').value.trim() || `ORD_${Date.now().toString(36).toUpperCase()}`;

  if (isNaN(amount) || amount <= 0) {
    showToast('Please enter a valid amount');
    return;
  }

  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;
  generateBtn.textContent = '⏳ Generating Challenge...';

  try {
    const res = await fetch(`${CONFIG.API_URL}/challenge/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: CONFIG.MERCHANT_ID,
        amount: amount
      })
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.status === 'success' || data.challenge_id) {
      const challengeId = data.challenge_id;
      const expiresIn = data.expires_in || 300;

      currentChallenge = {
        id: challengeId,
        amount: amount,
        orderId: orderId,
        expiresAt: Date.now() + (expiresIn * 1000)
      };

      displayQRCode(amount, challengeId, orderId);
      startChallengeCountdown(currentChallenge.expiresAt);
      showToast('Payment QR Code generated!');
    } else {
      throw new Error(data.message || 'Challenge generation failed');
    }
  } catch (err) {
    console.error('Challenge generation error:', err);
    // Offline local challenge fallback for demonstration
    const fallbackChallenge = `offline_${Math.random().toString(36).substring(2, 10)}`;
    currentChallenge = {
      id: fallbackChallenge,
      amount: amount,
      orderId: orderId,
      expiresAt: Date.now() + 300000
    };
    displayQRCode(amount, fallbackChallenge, orderId);
    startChallengeCountdown(currentChallenge.expiresAt);
    showToast('Generated QR with local fallback challenge');
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = '<span>⚡ Generate Challenge QR</span>';
  }
}

// Display Dynamic UPI QR Code
function displayQRCode(amount, challengeId, orderId) {
  const qrContainer = document.getElementById('qrcode');
  qrContainer.innerHTML = '';

  const note = `Ref:${orderId}|Ch:${challengeId.substring(0, 12)}`;
  const upiString = `upi://pay?pa=${encodeURIComponent(CONFIG.MERCHANT_VPA)}&pn=SharePay&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

  if (typeof QRCode !== 'undefined') {
    new QRCode(qrContainer, {
      text: upiString,
      width: 230,
      height: 230,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    // Fallback QR code render via SVG or reliable image API
    const qrImg = document.createElement('img');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=230x230&data=${encodeURIComponent(upiString)}`;
    qrImg.alt = 'UPI QR Code';
    qrImg.style.width = '230px';
    qrImg.style.height = '230px';
    qrContainer.appendChild(qrImg);
  }

  document.getElementById('displayAmount').textContent = amount.toFixed(2);
  document.getElementById('challengeId').textContent = challengeId.substring(0, 20) + '...';
  document.getElementById('merchantVPA').textContent = CONFIG.MERCHANT_VPA;

  qrSection.style.display = 'block';
  qrSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Countdown Timer for Challenge Expiration
function startChallengeCountdown(expiresAt) {
  if (challengeTimer) clearInterval(challengeTimer);

  function update() {
    const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
    const secs = String(remaining % 60).padStart(2, '0');
    document.getElementById('timerDisplay').textContent = `${mins}:${secs}`;

    if (remaining <= 0) {
      clearInterval(challengeTimer);
      showToast('Challenge expired. Please generate a new QR.');
      cancelActivePayment();
    }
  }

  update();
  challengeTimer = setInterval(update, 1000);
}

// Cancel Current Active Payment
function cancelActivePayment() {
  if (challengeTimer) clearInterval(challengeTimer);
  currentChallenge = null;
  qrSection.style.display = 'none';
}

// Handle Instant Payment Confirmation via WebSocket
function handlePaymentConfirmation(data) {
  playPaymentSound();

  // Vibration feedback
  if ('vibrate' in navigator) {
    navigator.vibrate([150, 75, 150]);
  }

  // Construct confirmed payment item
  const payment = {
    amount: parseFloat(data.amount) || 0,
    utr: data.utr || 'N/A',
    blockHash: data.block_hash || '',
    fraudScore: data.fraud_score !== undefined ? data.fraud_score : 100,
    timestamp: data.timestamp ? Math.floor(data.timestamp) : Math.floor(Date.now() / 1000)
  };

  payments.unshift(payment);
  totalAmount += payment.amount;

  updatePaymentsList();
  updateStats();

  // Close QR code if it matches active challenge
  if (currentChallenge) {
    cancelActivePayment();
  }

  showToast(`✅ ₹${payment.amount.toFixed(2)} received! UTR: ${payment.utr}`);

  // System Push Notification if permission granted
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Payment Received! 💰', {
      body: `₹${payment.amount.toFixed(2)} settled via UPI (UTR: ${payment.utr})`,
      icon: '/icons/icon-192.png'
    });
  }
}

// Play Sound Chime with Web Audio API Fallback
function playPaymentSound() {
  try {
    const audio = document.getElementById('paymentSound');
    if (audio && audio.src && audio.src !== window.location.href) {
      audio.play().catch(() => playSynthesizedChime());
    } else {
      playSynthesizedChime();
    }
  } catch (e) {
    playSynthesizedChime();
  }
}

// Web Audio API Synthesizer (pleasant dual-frequency chime)
function playSynthesizedChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Notes: C5 (523.25 Hz) -> E5 (659.25 Hz) -> G5 (783.99 Hz)
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);

      gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.1);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + idx * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + idx * 0.1);
      osc.stop(ctx.currentTime + idx * 0.1 + 0.36);
    });
  } catch (e) {
    console.warn('Audio synthesis not supported or blocked:', e);
  }
}

// Render Recent Payments List
function updatePaymentsList() {
  if (payments.length === 0) {
    paymentsList.innerHTML = '<p class="empty-state">No payments received yet in this session</p>';
    return;
  }

  paymentsList.innerHTML = payments.slice(0, 15).map(payment => `
    <div class="payment-item">
      <div class="amount">₹${payment.amount.toFixed(2)}</div>
      <div class="details">
        <div class="utr">UTR: ${payment.utr}</div>
        <div class="time">${formatTime(payment.timestamp)}</div>
      </div>
      <div class="score">Safety: ${payment.fraudScore}/100</div>
    </div>
  `).join('');
}

// Update Today's Aggregate Statistics
function updateStats() {
  document.getElementById('totalAmount').textContent = `₹${totalAmount.toFixed(2)}`;
  document.getElementById('totalTransactions').textContent = payments.length;

  const avgScore = payments.length > 0
    ? Math.round(payments.reduce((sum, p) => sum + p.fraudScore, 0) / payments.length)
    : 100;
  document.getElementById('avgScore').textContent = `${avgScore}/100`;
}

// Copy Direct UPI Intent Link
function copyPaymentLink() {
  if (!currentChallenge) return;

  const note = `Ref:${currentChallenge.orderId}|Ch:${currentChallenge.id.substring(0, 12)}`;
  const upiString = `upi://pay?pa=${encodeURIComponent(CONFIG.MERCHANT_VPA)}&pn=SharePay&am=${currentChallenge.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

  navigator.clipboard.writeText(upiString).then(() => {
    showToast('UPI Payment Link copied to clipboard!');
  }).catch(() => {
    showToast('Failed to copy link');
  });
}

// Quick Amount Setter Chips
function setQuickAmount(val) {
  document.getElementById('amount').value = val.toFixed(2);
}

// Load and Persist Payments in LocalStorage
function loadSavedPayments() {
  const saved = localStorage.getItem('sharepay_payments');
  if (saved) {
    try {
      payments = JSON.parse(saved);
      totalAmount = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      updatePaymentsList();
      updateStats();
    } catch (e) {
      console.warn('Failed to parse saved payments:', e);
    }
  }

  // Periodic autosave
  setInterval(() => {
    try {
      localStorage.setItem('sharepay_payments', JSON.stringify(payments.slice(0, 50)));
    } catch (e) {}
  }, 5000);
}

// Toast Alert Helper
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// Timestamp Formatter (IST)
function formatTime(timestamp) {
  const d = new Date(timestamp > 1e11 ? timestamp : timestamp * 1000);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// Settings Modal Controls
function openSettingsModal() {
  document.getElementById('cfgMerchantId').value = CONFIG.MERCHANT_ID;
  document.getElementById('cfgMerchantVpa').value = CONFIG.MERCHANT_VPA;
  document.getElementById('cfgApiUrl').value = CONFIG.API_URL;
  document.getElementById('cfgWsUrl').value = CONFIG.WS_URL;
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('open');
}

function saveSettings(event) {
  event.preventDefault();
  CONFIG.MERCHANT_ID = document.getElementById('cfgMerchantId').value.trim();
  CONFIG.MERCHANT_VPA = document.getElementById('cfgMerchantVpa').value.trim();
  CONFIG.API_URL = document.getElementById('cfgApiUrl').value.trim();
  CONFIG.WS_URL = document.getElementById('cfgWsUrl').value.trim();

  localStorage.setItem('sharepay_config', JSON.stringify(CONFIG));
  document.getElementById('merchantVPA').textContent = CONFIG.MERCHANT_VPA;
  closeSettingsModal();
  showToast('Settings saved! Reconnecting WebSocket...');
  connectWebSocket();
}

// Notification Permissions Prompt
if ('Notification' in window && Notification.permission === 'default') {
  setTimeout(() => {
    Notification.requestPermission();
  }, 2000);
}
