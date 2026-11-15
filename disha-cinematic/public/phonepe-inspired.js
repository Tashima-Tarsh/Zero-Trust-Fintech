/**
 * DISHA 8.2 — PhonePe-Inspired Interaction Engine
 * Implements navigation, mega-menus, hero carousel, interactive pricing calculator,
 * clipboard export, toast notifications, and responsive controls.
 */

(function () {
  'use strict';

  // --- Utility: Indian Currency Formatter ---
  function formatINR(val) {
    if (isNaN(val) || val < 0) val = 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(val);
  }

  // --- Toast Notification ---
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

  // --- 1. Sticky Header Shadow on Scroll ---
  const siteHeader = document.getElementById('siteHeader');
  if (siteHeader) {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        siteHeader.classList.add('scrolled');
      } else {
        siteHeader.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  // --- 2. Mega Menu Navigation ---
  const megaMenu = document.getElementById('megaMenu');
  const navTriggers = document.querySelectorAll('.nav-menu-trigger');
  const megaPanels = document.querySelectorAll('.mega-inner');

  function closeMegaMenu() {
    if (!megaMenu) return;
    megaMenu.hidden = true;
    navTriggers.forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
  }

  navTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuType = trigger.getAttribute('data-menu');
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';

      if (isExpanded) {
        closeMegaMenu();
      } else {
        // Close others and open this
        navTriggers.forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
        trigger.setAttribute('aria-expanded', 'true');

        if (megaMenu) {
          megaMenu.hidden = false;
          megaPanels.forEach((panel) => {
            if (panel.getAttribute('data-mega-content') === menuType) {
              panel.hidden = false;
            } else {
              panel.hidden = true;
            }
          });
        }
      }
    });
  });

  // Close mega menu on outside click
  document.addEventListener('click', (e) => {
    if (siteHeader && !siteHeader.contains(e.target)) {
      closeMegaMenu();
    }
  });

  // Close mega menu on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMegaMenu();
      closeMobileDrawer();
    }
  });

  // --- 3. Mobile Menu Drawer ---
  const mobileMenuButton = document.getElementById('mobileMenuButton');
  const mobileDrawer = document.getElementById('mobileDrawer');

  function closeMobileDrawer() {
    if (!mobileDrawer || !mobileMenuButton) return;
    mobileDrawer.hidden = true;
    mobileMenuButton.setAttribute('aria-expanded', 'false');
  }

  if (mobileMenuButton && mobileDrawer) {
    mobileMenuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = mobileMenuButton.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        closeMobileDrawer();
      } else {
        mobileDrawer.hidden = false;
        mobileMenuButton.setAttribute('aria-expanded', 'true');
      }
    });

    // Close drawer when clicking a link inside it
    mobileDrawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        closeMobileDrawer();
      });
    });
  }

  // --- 4. Hero Carousel (3 Slides with Dots & Arrows) ---
  const heroSection = document.getElementById('home');
  const heroSlides = document.querySelectorAll('.hero-slide');
  const heroDots = document.querySelectorAll('.hero-dot');
  const prevBtn = document.getElementById('previousSlide');
  const nextBtn = document.getElementById('nextSlide');

  let currentSlide = 0;
  const totalSlides = heroSlides.length || 3;
  let carouselInterval = null;
  const AUTO_INTERVAL_MS = 6500;

  function goToSlide(index) {
    if (totalSlides === 0) return;
    currentSlide = (index + totalSlides) % totalSlides;

    heroSlides.forEach((slide, idx) => {
      if (idx === currentSlide) {
        slide.classList.add('active');
        slide.removeAttribute('hidden');
      } else {
        slide.classList.remove('active');
      }
    });

    heroDots.forEach((dot, idx) => {
      if (idx === currentSlide) {
        dot.classList.add('active');
        dot.setAttribute('aria-current', 'true');
      } else {
        dot.classList.remove('active');
        dot.removeAttribute('aria-current');
      }
    });
  }

  function nextSlide() {
    goToSlide(currentSlide + 1);
  }

  function prevSlide() {
    goToSlide(currentSlide - 1);
  }

  function startCarousel() {
    stopCarousel();
    carouselInterval = setInterval(nextSlide, AUTO_INTERVAL_MS);
  }

  function stopCarousel() {
    if (carouselInterval) {
      clearInterval(carouselInterval);
      carouselInterval = null;
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      prevSlide();
      startCarousel();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      nextSlide();
      startCarousel();
    });
  }

  heroDots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const targetIdx = parseInt(dot.getAttribute('data-slide-go'), 10);
      if (!isNaN(targetIdx)) {
        goToSlide(targetIdx);
        startCarousel();
      }
    });
  });

  if (heroSection) {
    heroSection.addEventListener('mouseenter', stopCarousel);
    heroSection.addEventListener('mouseleave', startCarousel);
    heroSection.addEventListener('focusin', stopCarousel);
    heroSection.addEventListener('focusout', startCarousel);

    // Mobile touch swipe gestures
    let touchStartX = 0;
    let touchEndX = 0;

    heroSection.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    heroSection.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      if (touchStartX - touchEndX > 50) {
        nextSlide();
        startCarousel();
      } else if (touchEndX - touchStartX > 50) {
        prevSlide();
        startCarousel();
      }
    }, { passive: true });

    // Initialize first slide and start timer
    goToSlide(0);
    startCarousel();
  }

  // --- 5. Interactive One-Time Price Calculator ---
  const feeVolumeInput = document.getElementById('feeVolume');
  const feeVolumeOut = document.getElementById('feeVolumeOut');
  const avoidableRateInput = document.getElementById('avoidableRate');
  const avoidableRateOut = document.getElementById('avoidableRateOut');
  const removedFixedInput = document.getElementById('removedFixed');
  const newOperatingInput = document.getElementById('newOperating');

  const monthlySavingsEl = document.getElementById('monthlySavings');
  const oneTimePriceEl = document.getElementById('oneTimePrice');
  const firstYearBenefitEl = document.getElementById('firstYearBenefit');
  const calculatorWarning = document.getElementById('calculatorWarning');
  const copyQuoteBtn = document.getElementById('copyQuote');

  function calculatePricing() {
    if (!feeVolumeInput || !avoidableRateInput) return;

    const volume = parseFloat(feeVolumeInput.value) || 0;
    const rate = parseFloat(avoidableRateInput.value) || 0;
    const removedFixed = parseFloat(removedFixedInput ? removedFixedInput.value : 0) || 0;
    const newOperating = parseFloat(newOperatingInput ? newOperatingInput.value : 0) || 0;

    // Display formatted input labels
    if (feeVolumeOut) {
      feeVolumeOut.textContent = formatINR(volume);
    }
    if (avoidableRateOut) {
      avoidableRateOut.textContent = rate.toFixed(1) + '%';
    }

    // Formulas per DISHA 8.2 Business Model Spec:
    // avoidableTxnFees = volume * rate / 100
    // totalRemovedCosts = avoidableTxnFees + removedFixed
    // monthlyNetSavings = totalRemovedCosts - newOperating
    // oneTimePrice = 4 * monthlyNetSavings
    // firstYearBenefit = 12 * monthlyNetSavings - oneTimePrice
    const avoidableTxnFees = (volume * rate) / 100;
    const totalRemovedCosts = avoidableTxnFees + removedFixed;
    const monthlyNetSavings = totalRemovedCosts - newOperating;

    if (monthlyNetSavings > 0) {
      const oneTimePrice = 4 * monthlyNetSavings;
      const firstYearBenefit = 12 * monthlyNetSavings - oneTimePrice;

      if (monthlySavingsEl) monthlySavingsEl.textContent = formatINR(monthlyNetSavings);
      if (oneTimePriceEl) oneTimePriceEl.textContent = formatINR(oneTimePrice);
      if (firstYearBenefitEl) firstYearBenefitEl.textContent = formatINR(firstYearBenefit);
      if (calculatorWarning) calculatorWarning.hidden = true;
    } else {
      if (monthlySavingsEl) monthlySavingsEl.textContent = '₹0';
      if (oneTimePriceEl) oneTimePriceEl.textContent = '₹0';
      if (firstYearBenefitEl) firstYearBenefitEl.textContent = '₹0';
      if (calculatorWarning) calculatorWarning.hidden = false;
    }
  }

  // Bind live calculator events
  [feeVolumeInput, avoidableRateInput, removedFixedInput, newOperatingInput].forEach((input) => {
    if (input) {
      input.addEventListener('input', calculatePricing);
      input.addEventListener('change', calculatePricing);
    }
  });

  // Copy Quote Functionality
  if (copyQuoteBtn) {
    copyQuoteBtn.addEventListener('click', () => {
      const volume = parseFloat(feeVolumeInput ? feeVolumeInput.value : 0) || 0;
      const rate = parseFloat(avoidableRateInput ? avoidableRateInput.value : 0) || 0;
      const savingsText = monthlySavingsEl ? monthlySavingsEl.textContent : '₹0';
      const priceText = oneTimePriceEl ? oneTimePriceEl.textContent : '₹0';
      const benefitText = firstYearBenefitEl ? firstYearBenefitEl.textContent : '₹0';

      const quote = `DISHA 8.2 — Verified Savings Assessment:
• Monthly Volume Subject to Avoidable Fees: ${formatINR(volume)}
• Avoidable Charge Rate: ${rate.toFixed(1)}%
• Estimated Monthly Net Savings: ${savingsText}
• One-Time DISHA Software Price (4× Monthly Net Savings): ${priceText}
• Estimated First-Year Net Benefit: ${benefitText}
• Commercial Model: Perpetual self-hosted software license. No monthly DISHA subscription. 0% DISHA software commission.`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(quote).then(() => {
          showToast('Estimate copied to clipboard!');
        }).catch(() => {
          showToast('Quotation ready (copy allowed)');
        });
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = quote;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          showToast('Estimate copied to clipboard!');
        } catch {
          showToast('Failed to copy estimate');
        }
        document.body.removeChild(textarea);
      }
    });
  }

  // Initial calculation run
  calculatePricing();

  // --- 6. Copyright Year Update ---
  const copyrightYear = document.getElementById('copyrightYear');
  if (copyrightYear) {
    copyrightYear.textContent = new Date().getFullYear();
  }

  // --- 7. Smooth Anchor Scrolling Offset ---
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#' || href === '') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        closeMegaMenu();
        closeMobileDrawer();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  console.log('DISHA 8.2 PhonePe-inspired engine initialized.');
})();
