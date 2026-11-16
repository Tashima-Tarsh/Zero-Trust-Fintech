/**
 * DISHA 8.2 — Premium Interaction Engine
 * Sticky header, mega-menu, mobile drawer, pricing calculator, toast.
 */

(function () {
  'use strict';

  // ---------- Currency formatter ----------
  function formatINR(val) {
    if (isNaN(val) || val < 0) val = 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(val);
  }

  // ---------- Toast ----------
  const siteToast = document.getElementById('siteToast');
  let toastTimer = null;
  function showToast(message) {
    if (!siteToast) return;
    siteToast.textContent = message;
    siteToast.hidden = false;
    siteToast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      siteToast.classList.remove('show');
      siteToast.hidden = true;
    }, 3200);
  }

  // ---------- Sticky header ----------
  const siteHeader = document.getElementById('siteHeader');
  if (siteHeader) {
    const onScroll = () => {
      siteHeader.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Mega menu ----------
  const megaMenu = document.getElementById('megaMenu');
  const navTriggers = document.querySelectorAll('.nav-menu-trigger');
  const megaPanels = document.querySelectorAll('.mega-inner');
  let hoverTimer = null;

  function openPanel(menuType, triggerBtn) {
    if (hoverTimer) clearTimeout(hoverTimer);
    navTriggers.forEach((btn) => {
      const isActive = btn === triggerBtn;
      btn.setAttribute('aria-expanded', isActive ? 'true' : 'false');
      btn.classList.toggle('active', isActive);
    });
    if (megaMenu) {
      megaMenu.hidden = false;
      megaPanels.forEach((panel) => {
        panel.hidden = panel.getAttribute('data-mega-content') !== menuType;
      });
    }
  }

  function closeMenu() {
    if (!megaMenu) return;
    megaMenu.hidden = true;
    navTriggers.forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('active');
    });
  }

  navTriggers.forEach((btn) => {
    const type = btn.getAttribute('data-menu');
    btn.addEventListener('mouseenter', () => openPanel(type, btn));
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeMenu();
      else openPanel(type, btn);
    });
  });

  if (megaMenu) {
    megaMenu.addEventListener('mouseenter', () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      navTriggers.forEach((b) => b.setAttribute('aria-expanded', 'true'));
    });
    megaMenu.addEventListener('mouseleave', () => {
      hoverTimer = setTimeout(() => closeMenu(), 150);
    });
  }

  // ---------- Mobile drawer ----------
  const mobileBtn = document.getElementById('mobileMenuButton');
  const mobileDrawer = document.getElementById('mobileDrawer');
  if (mobileBtn && mobileDrawer) {
    mobileBtn.addEventListener('click', () => {
      const open = mobileDrawer.hasAttribute('hidden');
      mobileDrawer.toggleAttribute('hidden', !open);
      mobileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mobileDrawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileDrawer.setAttribute('hidden', '');
        mobileBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---------- Smooth scroll for nav links ----------
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        closeMenu();
        if (mobileDrawer) mobileDrawer.setAttribute('hidden', '');
      }
    });
  });

  // ---------- Pricing calculator ----------
  const feeVolume = document.getElementById('feeVolume');
  const feeVolumeOut = document.getElementById('feeVolumeOut');
  const avoidableRate = document.getElementById('avoidableRate');
  const avoidableRateOut = document.getElementById('avoidableRateOut');
  const removedFixed = document.getElementById('removedFixed');
  const newOperating = document.getElementById('newOperating');
  const monthlySavings = document.getElementById('monthlySavings');
  const oneTimePrice = document.getElementById('oneTimePrice');
  const firstYearBenefit = document.getElementById('firstYearBenefit');
  const calculatorWarning = document.getElementById('calculatorWarning');

  function updateCalculator() {
    if (!feeVolume) return;
    const volume = parseFloat(feeVolume.value) || 0;
    const rate = parseFloat(avoidableRate.value) || 0;
    const fixed = parseFloat(removedFixed.value) || 0;
    const operating = parseFloat(newOperating.value) || 0;

    if (feeVolumeOut) feeVolumeOut.textContent = formatINR(volume);
    if (avoidableRateOut) avoidableRateOut.textContent = rate.toFixed(1) + '%';

    const monthlyMdr = volume * (rate / 100);
    const monthlyNetSavings = monthlyMdr + fixed - operating;
    const oneTime = Math.max(monthlyNetSavings * 4, 0);
    const firstYear = Math.max(monthlyNetSavings * 12 - oneTime, 0);

    if (monthlySavings) monthlySavings.textContent = formatINR(Math.max(monthlyNetSavings, 0));
    if (oneTimePrice) oneTimePrice.textContent = formatINR(oneTime);
    if (firstYearBenefit) firstYearBenefit.textContent = formatINR(firstYear);

    if (calculatorWarning) {
      calculatorWarning.hidden = monthlyNetSavings > 0;
    }
  }

  [feeVolume, avoidableRate, removedFixed, newOperating].forEach((el) => {
    if (el) el.addEventListener('input', updateCalculator);
  });
  if (feeVolume) updateCalculator();

  // ---------- Copy quote ----------
  const copyQuote = document.getElementById('copyQuote');
  if (copyQuote) {
    copyQuote.addEventListener('click', () => {
      const lines = [
        'DISHA 8.2 — One-Time Price Estimate',
        'Monthly Volume: ' + (feeVolumeOut ? feeVolumeOut.textContent : '₹0'),
        'Avoidable Rate: ' + (avoidableRateOut ? avoidableRateOut.textContent : '0%'),
        'Monthly Net Savings: ' + (monthlySavings ? monthlySavings.textContent : '₹0'),
        'One-Time Price: ' + (oneTimePrice ? oneTimePrice.textContent : '₹0'),
        'First-Year Net Benefit: ' + (firstYearBenefit ? firstYearBenefit.textContent : '₹0'),
      ].join('\n');
      navigator.clipboard.writeText(lines).then(() => showToast('Estimate copied to clipboard'));
    });
  }

})();
