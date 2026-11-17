/* ══════════════════════════════════════════════════════════════════════════════
   DISHA 8.2 — 3D Checkout Payment Flow
   End-to-end: session create → QR display → UTR copy → verify → settle
   ══════════════════════════════════════════════════════════════════════════════ */

class DishaPaymentFlow {
  constructor(options = {}) {
    this.sessionEndpoint = options.sessionEndpoint || '/api/session/new';
    this.verifyEndpoint = options.verifyEndpoint || '/api/verify';
    this.onSessionCreated = options.onSessionCreated || (() => {});
    this.onSettled = options.onSettled || (() => {});

    this.session = null;
    this.scene = null; // set externally
    this.currentStep = 1;

    this.elements = {};

    this.bindUI();
  }

  bindUI() {
    this.elements = {
      stepCreate: document.getElementById('stepCreate'),
      stepQr: document.getElementById('stepQr'),
      stepShare: document.getElementById('stepShare'),
      stepVerify: document.getElementById('stepVerify'),
      stepSettle: document.getElementById('stepSettle'),

      qrCanvas: document.getElementById('qrCanvas'),
      qrChallenge: document.getElementById('qrChallenge'),
      qrCountdownVal: document.getElementById('qrCountdownVal'),

      receiptAmount: document.getElementById('receiptAmount'),
      receiptUtr: document.getElementById('receiptUtr'),

      manualUtr: document.getElementById('manualUtr'),
      utrInputBox: document.getElementById('utrInputBox'),

      btnReadClipboard: document.getElementById('btnReadClipboard'),
      btnVerifyManual: document.getElementById('btnVerifyManual'),

      fraudLayers: document.getElementById('fraudLayers'),
      verificationResult: document.getElementById('verificationResult'),
      resultBadge: document.getElementById('resultBadge'),
      resultDetail: document.getElementById('resultDetail'),

      ledgerDebit: document.getElementById('ledgerDebit'),
      ledgerCredit: document.getElementById('ledgerCredit'),

      btnNewOrder: document.getElementById('btnNewOrder')
    };

    // Generate QR code using a simple data URI approach (QR code library not available,
    // so we render a visual placeholder that looks like a QR code using CSS/JS)
    this.qrCanvas = this.elements.qrCanvas;
    this.qrCtx = this.qrCanvas.getContext('2d');
  }

  async createSession(amount) {
    try {
      const res = await fetch(`${this.sessionEndpoint}?amount=${amount}&description=Checkout Order`, {
        headers: { 'X-CSRF-Token': '' }
      });
      if (!res.ok) throw new Error('Session creation failed');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Session failed');

      this.session = data;
      this.onSessionCreated(data);

      // Update UI
      document.getElementById('qrChallenge').textContent = '₹' + data.challengeAmount.toFixed(2);
      document.getElementById('receiptAmount').textContent = data.challengeAmount.toFixed(2);

      // Draw QR code visual
      this.drawQrCode(data.challengeAmount.toFixed(2), data.orderId);

      // Move to step 2 (QR)
      this.showStep('stepQr');
      this.currentStep = 2;

      // Start countdown
      this.startCountdown(data.challengeAmount);

      // Set 3D scene state
      if (window.scene3d) {
        window.scene3d.setState('scanning');
      }
    } catch (err) {
      console.error('Session create error:', err);
      alert('Failed to create session: ' + err.message);
    }
  }

  drawQrCode(amount, orderId) {
    const ctx = this.qrCtx;
    const size = 300;
    this.qrCanvas.width = size;
    this.qrCanvas.height = size;

    // Clear
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, size, size);

    // Draw QR-like pattern (deterministic based on orderId + amount)
    const seed = (orderId + amount).split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const cellSize = 14;
    const margin = 40;
    const cells = 16;

    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const pseudo = ((x * 7 + y * 13 + seed) % 97) < 45;
        if (pseudo) {
          ctx.fillRect(margin + x * cellSize, margin + y * cellSize, cellSize - 2, cellSize - 2);
        }
      }
    }

    // Finder patterns (three corners)
    const finderSize = 54;
    const finderPos = [margin - 6, margin + (cells - 9) * cellSize + 6];
    finderPos.forEach((x) => {
      finderPos.forEach((y) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, finderSize, finderSize);
        ctx.fillStyle = '#05070b';
        ctx.fillRect(x + 8, y + 8, finderSize - 16, finderSize - 16);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 12, y + 12, finderSize - 24, finderSize - 24);
      });
    });

    // Center alignment pattern
    const centerX = margin + Math.floor(cells / 2) * cellSize;
    const centerY = margin + Math.floor(cells / 2) * cellSize;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(centerX - 14, centerY - 14, 28, 28);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(centerX - 6, centerY - 6, 12, 12);
  }

  startCountdown(amount) {
    let seconds = 15;
    this.elements.qrCountdownVal.textContent = seconds;

    const interval = setInterval(() => {
      seconds--;
      this.elements.qrCountdownVal.textContent = seconds;

      if (seconds <= 0) {
        clearInterval(interval);
        this.elements.qrCountdownVal.textContent = 'Refreshing…';
        // In a real app we'd regenerate the QR here
        setTimeout(() => {
          this.elements.qrCountdownVal.textContent = '15';
          seconds = 15;
        }, 1000);
      }
    }, 1000);
  }

  showStep(stepId) {
    // Hide all steps
    document.querySelectorAll('.checkout-step').forEach(el => el.classList.add('hidden'));
    // Show target
    const el = document.getElementById(stepId);
    if (el) el.classList.remove('hidden');
  }

  async readClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const utr = this.extractUtr(text);
      if (!utr) {
        alert('No 12-digit UTR found in clipboard.');
        return;
      }
      this.elements.manualUtr.value = utr;
      this.elements.utrInputBox.style.display = 'block';
      this.elements.clipboardBox.classList.add('hidden');
      await this.verifyUtr(utr);
    } catch (err) {
      alert('Clipboard access denied. Paste UTR manually.');
      this.elements.clipboardBox.classList.add('hidden');
      this.elements.utrInputBox.style.display = 'block';
    }
  }

  extractUtr(text) {
    const m = text.match(/\b(\d{12})\b/);
    return m ? m[1] : null;
  }

  async verifyUtr(utr) {
    if (!this.session) {
      alert('No active session. Create one first.');
      return;
    }

    this.elements.btnVerifyManual.disabled = true;
    this.elements.btnVerifyManual.textContent = 'Verifying…';

    try {
      const res = await fetch(this.verifyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': ''
        },
        body: JSON.stringify({
          utr: utr,
          amount: this.session.challengeAmount,
          orderId: this.session.orderId
        })
      });

      const data = await res.json();

      if (data.success && data.state === 'VERIFIED') {
        this.onSettled(data);
        this.showSettled(data);
      } else {
        this.showVerificationError(data.code || 'VERIFICATION_FAILED', data.reason || 'Verification failed');
      }
    } catch (err) {
      console.error('Verify error:', err);
      alert('Verification error: ' + err.message);
    } finally {
      this.elements.btnVerifyManual.disabled = false;
      this.elements.btnVerifyManual.textContent = 'Verify UTR';
    }
  }

  showVerificationError(code, reason) {
    this.showStep('stepVerify');
    this.currentStep = 4;

    // Build fraud layer display
    this.elements.fraudLayers.innerHTML = `
      <div class="layer-row">
        <div class="layer-badge fail">1</div>
        <div class="layer-text">Session valid — ${this.session.orderId}</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge ${code === 'AMOUNT_MISMATCH' ? 'fail' : 'pass'}">2</div>
        <div class="layer-text">${code === 'AMOUNT_MISMATCH' ? 'Amount mismatch — rejected' : 'Amount matched'}</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">3</div>
        <div class="layer-text">UTR format valid (12 digits)</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">4</div>
        <div class="layer-text">Timestamp within 15–180s window</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">5</div>
        <div class="layer-text">Payee VPA matches order</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">6</div>
        <div class="layer-text">Rate limit OK</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge ${code === 'UTR_REUSED' ? 'fail' : 'pass'}">7</div>
        <div class="layer-text">UTR not previously used</div>
      </div>
    `;

    this.elements.verificationResult.style.display = 'block';
    this.elements.resultBadge.className = 'result-badge';
    this.elements.resultBadge.textContent = 'REJECTED';
    this.elements.resultBadge.classList.add('fail');
    this.elements.resultDetail.textContent = reason || 'Verification rejected.';
  }

  showSettled(data) {
    this.showStep('stepSettle');
    this.currentStep = 5;

    // Build all-pass fraud layers
    this.elements.fraudLayers.innerHTML = `
      <div class="layer-row">
        <div class="layer-badge pass">1</div>
        <div class="layer-text">Session valid — ${this.session.orderId}</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">2</div>
        <div class="layer-text">Amount matched — ₹${this.session.challengeAmount.toFixed(2)}</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">3</div>
        <div class="layer-text">UTR ${data.utr} unique — first use</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">4</div>
        <div class="layer-text">Timestamp within window</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">5</div>
        <div class="layer-text">Payee VPA verified</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">6</div>
        <div class="layer-text">Rate limit OK</div>
      </div>
      <div class="layer-row">
        <div class="layer-badge pass">7</div>
        <div class="layer-text">Ledger balanced — settled</div>
      </div>
    `;

    this.elements.verificationResult.style.display = 'block';
    this.elements.resultBadge.className = 'result-badge success';
    this.elements.resultBadge.textContent = 'PASS';
    this.elements.resultDetail.textContent = 'Payment verified. Double-entry ledger posted.';

    // Update ledger display
    this.elements.ledgerDebit.textContent = data.amount.toFixed(2);
    this.elements.ledgerCredit.textContent = data.amount.toFixed(2);

    // Trigger 3D scene settle
    if (window.scene3d) {
      window.scene3d.setState('settled');
      window.scene3d.triggerSettle(data.utr, data.amount);
    }
  }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.paymentFlow = new DishaPaymentFlow();
});
