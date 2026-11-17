/**
 * DISHA 8.2 — High-Performance Landing Page Scripts
 * Interactive Savings Engine, Mobile Menu & Live Telemetry Ticker
 */
(() => {
  'use strict';

  // Navigation Mobile Menu
  const btn = document.querySelector('#menuButton');
  const menu = document.querySelector('#mobileMenu');
  if (btn && menu) {
    btn.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Dynamic Year
  const yr = document.querySelector('#copyrightYear');
  if (yr) yr.textContent = new Date().getFullYear();

  // Number Formatter (Indian Rupee)
  const nf = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'INR'
  });

  // Interactive Revenue Retention Calculator
  const slider = document.getElementById('volumeSlider');
  const volumeDisplay = document.getElementById('calcVolumeDisplay');
  const gatewayLossDisplay = document.getElementById('gatewayLossDisplay');
  const monthlySavedDisplay = document.getElementById('monthlySavedDisplay');
  const annualSavedDisplay = document.getElementById('annualSavedDisplay');
  const copyBtn = document.getElementById('copyCalcBtn');

  function updateCalculator() {
    if (!slider) return;
    const volume = Number(slider.value) || 2500000;
    // Standard Indian Aggregator fee: 2.0% MDR + 18% GST on MDR = 2.36% total
    const gatewayRate = 0.0236;
    const monthlyLoss = Math.round(volume * gatewayRate);
    const annualLoss = monthlyLoss * 12;

    if (volumeDisplay) volumeDisplay.textContent = nf.format(volume);
    if (gatewayLossDisplay) gatewayLossDisplay.textContent = nf.format(monthlyLoss);
    if (monthlySavedDisplay) monthlySavedDisplay.textContent = nf.format(monthlyLoss);
    if (annualSavedDisplay) annualSavedDisplay.textContent = nf.format(annualLoss);
  }

  if (slider) {
    slider.addEventListener('input', updateCalculator);
    updateCalculator();
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const vol = Number(slider?.value) || 2500000;
      const saved = Math.round(vol * 0.0236);
      const text = `DISHA 8.2 Savings Summary:\nMonthly Turnover: ${nf.format(vol)}\nAvoided Aggregator Fees (2% + GST): ${nf.format(saved)}/month\nAnnual Working Capital Preserved: ${nf.format(saved * 12)}/year\n\nDirect Bank UPI with 0% platform commission.`;
      try {
        await navigator.clipboard.writeText(text);
        showToast('Calculation copied to clipboard.');
      } catch {
        showToast('Clipboard access unavailable.');
      }
    });
  }

  // Toast Functionality
  function showToast(msg) {
    let el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  // Subtle Live Telemetry Feed Simulation in Hero Terminal
  const heroFeed = document.getElementById('heroFeed');
  if (heroFeed) {
    const sampleAmounts = [1499, 299, 4500, 890, 1250, 6800, 340, 999];
    let counter = 432190887125;

    setInterval(() => {
      const amt = sampleAmounts[Math.floor(Math.random() * sampleAmounts.length)];
      counter += Math.floor(Math.random() * 5) + 1;
      const row = document.createElement('div');
      row.className = 'feed-item';
      row.style.animation = 'fadeIn 0.3s ease';
      row.innerHTML = `
        <div>
          <span class="amount">₹${amt.toLocaleString('en-IN')}.00</span>
          <span style="color:var(--muted);margin-left:8px;">UTR: ${counter}</span>
        </div>
        <span class="tag">DIRECT TO BANK · 0s</span>
      `;
      heroFeed.insertBefore(row, heroFeed.firstChild);
      if (heroFeed.children.length > 4) {
        heroFeed.removeChild(heroFeed.lastChild);
      }
    }, 4500);
  }
})();
