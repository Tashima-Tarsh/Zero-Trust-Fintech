/**
 * DISHA 8.2 — Enterprise Sovereign Fintech Interaction, Audio & Motion Engine
 * Features:
 * 1. Floating Toast HUD Notification System
 * 2. Sovereign Audio Engine (Web Audio Synthesizer + Multi-lingual SpeechSynthesis)
 * 3. Ambient Particle Background Canvas (Looped Flow)
 * 4. 3D Perspective Card Tilt Physics
 * 5. Magnetic Buttons Physics
 * 6. Interactive QR Scanner Simulation
 * 7. Smart VPA Routing Simulator (Weighted Scoring & Pattern Masking)
 * 8. Realtime Double-Entry Ledger Journal Generator
 * 9. Sovereign P&L Calculator & Formatted Audit Generator
 * 10. Physical Hardware Soundbox Simulator (Multi-lingual Voice)
 * 11. Full-Bleed Navigation & Mobile Drawer Controls
 */

// ==========================================
// 1. FLOATING TOAST HUD SYSTEM
// ==========================================
function showDishaToast(message, duration = 3000) {
  const toast = document.getElementById('dishaToast');
  if (!toast) return;
  const msgEl = toast.querySelector('.toast-msg');
  if (msgEl) msgEl.textContent = message;
  toast.classList.add('active');
  clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.remove('active');
  }, duration);
}

// ==========================================
// 2. SOVEREIGN AUDIO & MULTI-LINGUAL VOICE ENGINE
// ==========================================
class SovereignAudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.currentLanguage = 'en-IN'; // 'en-IN', 'hi-IN', 'mr-IN'
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.init();
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  setLanguage(lang) {
    this.currentLanguage = lang;
  }

  // Harmonic Verification Chime
  playChime() {
    if (this.isMuted || !this.ctx) return;
    const freqs = [523.25, 659.25, 783.99, 1046.50];
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, this.ctx.currentTime + i * 0.07);
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.07 + 0.8);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + i * 0.07);
      osc.stop(this.ctx.currentTime + i * 0.07 + 0.9);
    });
  }

  // Routing Beep
  playRoutingBeep() {
    if (this.isMuted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.setValueAtTime(1320, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.28);
  }

  // Multi-lingual Voice Synthesizer
  speakPayment(amount) {
    if (this.isMuted) return;
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    let text = `Payment of ${amount} rupees received on DISHA rail.`;
    if (this.currentLanguage === 'hi-IN') {
      text = `दिशा पर ${amount} रुपये प्राप्त हुए।`;
    } else if (this.currentLanguage === 'mr-IN') {
      text = `दिशावर ${amount} रुपये जमा झाले आहेत.`;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.lang = this.currentLanguage;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find(v => v.lang === this.currentLanguage || v.lang.startsWith(this.currentLanguage.slice(0, 2)));
    if (matchedVoice) utter.voice = matchedVoice;

    window.speechSynthesis.speak(utter);
  }
}

const audio = new SovereignAudioEngine();

// ==========================================
// 3. AMBIENT PARTICLES CANVAS
// ==========================================
function initAmbientCanvas() {
  const canvas = document.getElementById('ambientCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const particles = Array.from({ length: 35 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.4 + 0.1,
    color: Math.random() > 0.5 ? '20, 184, 166' : '99, 102, 241'
  }));

  function animate() {
    ctx.clearRect(0, 0, width, height);
    for (let p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(animate);
  }
  animate();
}

// ==========================================
// 4. SMART VPA ROUTING ENGINE INTERACTION
// ==========================================
const vpaPoolData = [
  { id: 'vpaCard007', vpa: 'merchant007@ybl', health: 95, tx: 12, vol: 18400, limitTx: 30, limitVol: 50000, cooldownMins: 0, status: 'HEALTHY' },
  { id: 'vpaCard008', vpa: 'merchant008@oksbi', health: 88, tx: 28, vol: 46200, limitTx: 30, limitVol: 50000, cooldownMins: 2, status: 'NEAR LIMIT' },
  { id: 'vpaCard009', vpa: 'merchant009@ibl', health: 72, tx: 5, vol: 8900, limitTx: 30, limitVol: 50000, cooldownMins: 0, status: 'HEALTHY' },
  { id: 'vpaCard010', vpa: 'merchant010@paytm', health: 45, tx: 0, vol: 0, limitTx: 30, limitVol: 50000, cooldownMins: 999, status: 'PAUSED' }
];

let transactionCounter = 124;

function initVpaRoutingSimulator() {
  const btn = document.getElementById('btnSimulateOrder');
  const logBody = document.getElementById('algoLogBody');
  if (!btn || !logBody) return;

  btn.addEventListener('click', () => {
    audio.init();
    audio.playRoutingBeep();

    // 1. Filter healthy candidates
    const eligible = vpaPoolData.filter(v => v.health >= 70 && v.tx < v.limitTx && v.cooldownMins === 0);
    if (eligible.length === 0) {
      showDishaToast('Warning: No eligible VPAs in pool! Cooldown in progress.');
      return;
    }

    // 2. Calculate weighted score: (health * 0.4) + (cooldown * 0.3) + (random * 0.3)
    const scored = eligible.map(v => {
      const healthFactor = v.health / 100;
      const cooldownFactor = 1.0;
      const randomFactor = Math.random();
      const score = (healthFactor * 0.4) + (cooldownFactor * 0.3) + (randomFactor * 0.3);
      return { ...v, score: score * 100 };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0];

    // Update internal state
    const target = vpaPoolData.find(v => v.vpa === selected.vpa);
    if (target) {
      target.tx += 1;
      target.vol += 1249.37;
    }

    transactionCounter++;
    const utr = `311400000${transactionCounter}`;

    // Highlight card visually
    document.querySelectorAll('.vpa-status-card').forEach(c => c.classList.remove('active-card'));
    const activeEl = document.getElementById(selected.id);
    if (activeEl) {
      activeEl.classList.add('active-card');
      const txNumEl = activeEl.querySelector('.s-num');
      if (txNumEl && target) txNumEl.textContent = `${target.tx} / 30`;
    }

    // Append to decision log
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const logItem = document.createElement('div');
    logItem.className = 'log-line text-teal';
    logItem.innerHTML = `<strong>[${timeStr}] TX-${utr}:</strong> Matched <code>${selected.vpa}</code> (Score: ${selected.score.toFixed(1)}/100) · Dispatched ₹1,249.37`;
    
    logBody.prepend(logItem);
    if (logBody.children.length > 6) {
      logBody.removeChild(logBody.lastChild);
    }

    // Also update Double-Entry Ledger dynamically!
    appendLedgerTransaction(utr, 1249.37, selected.vpa);

    audio.playChime();
    audio.speakPayment(1249);
    showDishaToast(`Payment Routed to ${selected.vpa} · UTR: ${utr}`);
  });
}

// ==========================================
// 5. DOUBLE-ENTRY LEDGER DYNAMIC INSERTER
// ==========================================
function appendLedgerTransaction(utr, amount, vpa) {
  const tableBody = document.getElementById('ledgerTableBody');
  const totalDrEl = document.getElementById('totalDebitsVal');
  const totalCrEl = document.getElementById('totalCreditsVal');
  if (!tableBody) return;

  const now = new Date();
  const timeStr = `${now.toTimeString().split(' ')[0]} IST`;

  // Entry 1: Debit to Asset
  const rowDr = document.createElement('div');
  rowDr.className = 'ledger-row entry-dr';
  rowDr.innerHTML = `
    <div class="col-time font-mono">${timeStr}</div>
    <div class="col-utr font-mono">UTR ${utr}</div>
    <div class="col-account"><strong>1001</strong> · HDFC Current Bank A/C (Asset)</div>
    <div class="col-type"><span class="badge-debit">DEBIT</span></div>
    <div class="col-debit font-mono text-teal">₹${amount.toFixed(2)}</div>
    <div class="col-credit font-mono">—</div>
    <div class="col-status"><span class="chip-verified">✓ BALANCED</span></div>
  `;

  // Entry 2: Credit to Revenue
  const rowCr = document.createElement('div');
  rowCr.className = 'ledger-row entry-cr';
  rowCr.innerHTML = `
    <div class="col-time font-mono">${timeStr}</div>
    <div class="col-utr font-mono">UTR ${utr}</div>
    <div class="col-account"><strong>4001</strong> · Sales Revenue (Income)</div>
    <div class="col-type"><span class="badge-credit">CREDIT</span></div>
    <div class="col-debit font-mono">—</div>
    <div class="col-credit font-mono text-gold">₹${amount.toFixed(2)}</div>
    <div class="col-status"><span class="chip-verified">✓ BALANCED</span></div>
  `;

  tableBody.prepend(rowCr);
  tableBody.prepend(rowDr);

  // Update totals
  window._totalLedger = (window._totalLedger || 47320.00) + amount;
  const formatted = `₹${window._totalLedger.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (totalDrEl) totalDrEl.textContent = formatted;
  if (totalCrEl) totalCrEl.textContent = formatted;
}

// ==========================================
// 6. SOVEREIGN P&L ROI CALCULATOR
// ==========================================
function initRoiCalculator() {
  const slider = document.getElementById('monthlyTurnover');
  const turnoverDisplay = document.getElementById('turnoverDisplay');
  const lossDisplay = document.getElementById('annualLossDisplay');
  const savingsDisplay = document.getElementById('annualSavingsDisplay');

  if (!slider || !turnoverDisplay) return;

  function update() {
    const monthlyTurnover = parseFloat(slider.value);
    turnoverDisplay.textContent = `₹${monthlyTurnover.toLocaleString('en-IN')}`;

    // Aggregator 1.8% MDR + 18% GST on MDR = 2.124% + ₹150 soundbox fee/mo
    const monthlyMdr = monthlyTurnover * 0.018;
    const monthlyGst = monthlyMdr * 0.18;
    const monthlySoundbox = 150;
    const monthlyLoss = monthlyMdr + monthlyGst + monthlySoundbox;
    const annualLoss = Math.round(monthlyLoss * 12);

    if (lossDisplay) lossDisplay.textContent = `₹${annualLoss.toLocaleString('en-IN')}`;
    if (savingsDisplay) savingsDisplay.textContent = `+₹${annualLoss.toLocaleString('en-IN')}`;
  }

  slider.addEventListener('input', update);
  update();
}

// ==========================================
// 7. HARDWARE SOUNDBOX CONTROLS
// ==========================================
function initSoundboxHardware() {
  const langSelect = document.getElementById('soundboxLangSelect');
  const ledText = document.getElementById('soundboxLedText');
  const buttons = document.querySelectorAll('.btn-voice-test');

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      audio.setLanguage(e.target.value);
      showDishaToast(`Soundbox Voice Language: ${e.target.selectedOptions[0].text}`);
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = parseInt(btn.getAttribute('data-amt'), 10);
      audio.init();
      audio.playChime();
      audio.speakPayment(amt);

      if (ledText) {
        ledText.textContent = `PAID: ₹${amt.toLocaleString('en-IN')}`;
        setTimeout(() => {
          ledText.textContent = 'DISHA 8.2 · READY';
        }, 3500);
      }
      showDishaToast(`Acoustic Confirmation: ₹${amt} verified on Interbank Rail`);
    });
  });
}

// ==========================================
// 8. INTERACTIVE QR SCANNER SIMULATION
// ==========================================
function initQrScannerSimulation() {
  const qrBox = document.getElementById('demoQrBox');
  const laser = document.getElementById('scannerLaser');
  const promptText = document.getElementById('scanPromptText');

  if (!qrBox) return;

  qrBox.addEventListener('click', () => {
    audio.init();
    audio.playRoutingBeep();

    if (laser) laser.classList.add('success');
    if (promptText) {
      promptText.textContent = '✓ UPI INTENT VERIFIED · ₹1,000.00 PAID';
      promptText.style.color = '#10B981';
    }

    setTimeout(() => {
      audio.playChime();
      audio.speakPayment(1000);
      showDishaToast('Ramesh Kirana · ₹1,000 Received via UPI (0% MDR)');
    }, 300);

    setTimeout(() => {
      if (laser) laser.classList.remove('success');
      if (promptText) {
        promptText.textContent = '⚡ Click QR code to simulate customer scan';
        promptText.style.color = 'var(--gold-warm)';
      }
    }, 4500);
  });
}

// ==========================================
// 9. NAVIGATION SCROLLSPY & MOBILE MENU
// ==========================================
function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.story-scene');
  const progressLine = document.getElementById('scrollProgressLine');
  const audioBtn = document.getElementById('audioSynthBtn');
  const mobileToggle = document.getElementById('mobileNavToggle');
  const mobileDrawer = document.getElementById('mobileDrawer');

  // Scroll Progress
  window.addEventListener('scroll', () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const progress = (window.scrollY / total) * 100;
    if (progressLine) progressLine.style.width = `${progress}%`;

    // Active Section Detection
    let currentId = '';
    sections.forEach(sec => {
      const top = sec.offsetTop - 120;
      if (window.scrollY >= top) {
        currentId = sec.getAttribute('id');
      }
    });

    if (currentId) {
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('data-act') === currentId);
      });
    }
  });

  // Audio Toggle
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      const muted = audio.toggleMute();
      audioBtn.classList.toggle('active', !muted);
      showDishaToast(muted ? 'Audio Telemetry Muted' : 'Audio Telemetry Active');
    });
  }

  // Mobile Drawer Toggle
  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      mobileDrawer.classList.toggle('active');
    });

    mobileDrawer.querySelectorAll('.mobile-link').forEach(link => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('active');
      });
    });
  }
}

// ==========================================
// 10. CARD TILT PHYSICS (Subtle 3D)
// ==========================================
function initTiltPhysics() {
  const cards = document.querySelectorAll('.tilt-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      const rotX = -(y / rect.height) * 8;
      const rotY = (x / rect.width) * 8;
      card.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-2px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)';
    });
  });
}

// ==========================================
// INITIALIZATION ON DOM READY
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initAmbientCanvas();
  initVpaRoutingSimulator();
  initRoiCalculator();
  initSoundboxHardware();
  initQrScannerSimulation();
  initNavigation();
  initTiltPhysics();
});
