/**
 * DISHA 8.2 — PhonePe-Inspired Interaction & Navigation Engine
 * Phase 4: Typographic & Spacing Controls
 * Phase 5: Complete Responsive Mega-Menu Navigation, Keyboard A11y,
 *          Hero Carousel, Interactive Pricing Calculator, and Toast System.
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

  // --- 1. Sticky Header with Scroll Elevation ---
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

  // --- 2. Professional Mega-Menu (Hover & Click with Intent + Keyboard A11y) ---
  const megaMenu = document.getElementById('megaMenu');
  const navTriggers = document.querySelectorAll('.nav-menu-trigger');
  const megaPanels = document.querySelectorAll('.mega-inner');
  let hoverCloseTimer = null;

  let isMenuLockedByClick = false;

  function openMegaPanel(menuType, triggerBtn) {
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    navTriggers.forEach((btn) => {
      btn.setAttribute('aria-expanded', btn === triggerBtn ? 'true' : 'false');
      btn.classList.toggle('active', btn === triggerBtn);
    });

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

  function closeMegaMenu() {
    if (!megaMenu) return;
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    megaMenu.hidden = true;
    navTriggers.forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('active');
    });
  }

  navTriggers.forEach((trigger) => {
    const menuType = trigger.getAttribute('data-menu');

    // Click behavior
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const activePanel = document.querySelector('.mega-inner:not([hidden])');
      const currentMenu = megaMenu && !megaMenu.hidden && activePanel ? activePanel.getAttribute('data-mega-content') : null;
      
      if (currentMenu === menuType && isMenuLockedByClick) {
        isMenuLockedByClick = false;
        closeMegaMenu();
      } else {
        isMenuLockedByClick = true;
        openMegaPanel(menuType, trigger);
      }
    });

    // Hover intent on desktop
    trigger.addEventListener('mouseenter', () => {
      openMegaPanel(menuType, trigger);
    });
  });

  if (siteHeader) {
    siteHeader.addEventListener('mouseleave', () => {
      if (!isMenuLockedByClick) {
        hoverCloseTimer = setTimeout(closeMegaMenu, 250);
      }
    });
    siteHeader.addEventListener('mouseenter', () => {
      if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    });
  }

  // Close mega menu on outside click
  document.addEventListener('click', (e) => {
    if (siteHeader && !siteHeader.contains(e.target)) {
      isMenuLockedByClick = false;
      closeMegaMenu();
    }
  });

  // Close when clicking a link inside mega menu
  if (megaMenu) {
    megaMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        isMenuLockedByClick = false;
        closeMegaMenu();
      });
    });
  }

  // Keyboard Navigation: Escape key closes menus
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

    mobileDrawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        closeMobileDrawer();
      });
    });
  }

  // --- 4. Hero Carousel (3 Slides with Smooth Transitions & Gestures) ---
  // --- 4. Hero Carousel (3 Slides with Smooth Transitions, Pause Controls & Progress Bar) ---
  const heroSection = document.getElementById('home');
  const heroSlides = document.querySelectorAll('.hero-slide');
  const heroDots = document.querySelectorAll('.hero-dot');
  const prevBtn = document.getElementById('previousSlide');
  const nextBtn = document.getElementById('nextSlide');
  const heroPauseBtn = document.getElementById('heroPauseBtn');
  const pauseSymbol = heroPauseBtn ? heroPauseBtn.querySelector('.pause-symbol') : null;
  const playSymbol = heroPauseBtn ? heroPauseBtn.querySelector('.play-symbol') : null;

  let currentSlide = 0;
  const totalSlides = heroSlides.length || 3;
  let carouselInterval = null;
  const AUTO_INTERVAL_MS = 6500;
  let isManuallyPaused = false;
  let isHoveredOrFocused = false;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    isManuallyPaused = true;
  }

  function resetDotProgress(activeDot) {
    if (!activeDot) return;
    const progressSpan = activeDot.querySelector('.dot-progress');
    if (progressSpan) {
      progressSpan.style.animation = 'none';
      // Trigger reflow
      void progressSpan.offsetWidth;
      if (!prefersReducedMotion) {
        progressSpan.style.animation = `dotProgress ${AUTO_INTERVAL_MS}ms linear forwards`;
      }
    }
  }

  function goToSlide(index) {
    if (totalSlides === 0) return;
    currentSlide = (index + totalSlides) % totalSlides;

    heroSlides.forEach((slide, idx) => {
      if (idx === currentSlide) {
        slide.classList.add('active');
        slide.removeAttribute('hidden');
        slide.setAttribute('aria-hidden', 'false');
      } else {
        slide.classList.remove('active');
        slide.setAttribute('aria-hidden', 'true');
      }
    });

    heroDots.forEach((dot, idx) => {
      if (idx === currentSlide) {
        dot.classList.add('active');
        dot.setAttribute('aria-current', 'true');
        resetDotProgress(dot);
      } else {
        dot.classList.remove('active');
        dot.removeAttribute('aria-current');
        const progressSpan = dot.querySelector('.dot-progress');
        if (progressSpan) progressSpan.style.animation = 'none';
      }
    });
  }

  function nextSlide() {
    goToSlide(currentSlide + 1);
  }

  function prevSlide() {
    goToSlide(currentSlide - 1);
  }

  function updatePauseButtonUI() {
    if (!heroPauseBtn) return;
    const isPaused = isManuallyPaused || isHoveredOrFocused;
    if (heroSection) {
      heroSection.classList.toggle('is-paused', isPaused);
    }
    if (isManuallyPaused) {
      if (pauseSymbol) pauseSymbol.hidden = true;
      if (playSymbol) playSymbol.hidden = false;
      heroPauseBtn.setAttribute('aria-label', 'Resume slideshow');
      heroPauseBtn.setAttribute('title', 'Resume slideshow');
    } else {
      if (pauseSymbol) pauseSymbol.hidden = false;
      if (playSymbol) playSymbol.hidden = true;
      heroPauseBtn.setAttribute('aria-label', 'Pause slideshow');
      heroPauseBtn.setAttribute('title', 'Pause slideshow');
    }
  }

  function startCarousel() {
    if (isManuallyPaused || prefersReducedMotion) return;
    stopCarouselTimer();
    carouselInterval = setInterval(nextSlide, AUTO_INTERVAL_MS);
    updatePauseButtonUI();
  }

  function stopCarouselTimer() {
    if (carouselInterval) {
      clearInterval(carouselInterval);
      carouselInterval = null;
    }
    updatePauseButtonUI();
  }

  if (heroPauseBtn) {
    heroPauseBtn.addEventListener('click', () => {
      isManuallyPaused = !isManuallyPaused;
      if (isManuallyPaused) {
        stopCarouselTimer();
      } else {
        startCarousel();
      }
      updatePauseButtonUI();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      prevSlide();
      if (!isManuallyPaused) startCarousel();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      nextSlide();
      if (!isManuallyPaused) startCarousel();
    });
  }

  heroDots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const targetIdx = parseInt(dot.getAttribute('data-slide-go'), 10);
      if (!isNaN(targetIdx)) {
        goToSlide(targetIdx);
        if (!isManuallyPaused) startCarousel();
      }
    });
  });

  if (heroSection) {
    heroSection.addEventListener('mouseenter', () => {
      isHoveredOrFocused = true;
      stopCarouselTimer();
    });
    heroSection.addEventListener('mouseleave', () => {
      isHoveredOrFocused = false;
      if (!isManuallyPaused) startCarousel();
    });
    heroSection.addEventListener('focusin', () => {
      isHoveredOrFocused = true;
      stopCarouselTimer();
    });
    heroSection.addEventListener('focusout', () => {
      isHoveredOrFocused = false;
      if (!isManuallyPaused) startCarousel();
    });

    // Mobile swipe gestures
    let touchStartX = 0;
    let touchEndX = 0;

    heroSection.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    heroSection.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      if (touchStartX - touchEndX > 50) {
        nextSlide();
        if (!isManuallyPaused) startCarousel();
      } else if (touchEndX - touchStartX > 50) {
        prevSlide();
        if (!isManuallyPaused) startCarousel();
      }
    }, { passive: true });

    goToSlide(0);
    if (!isManuallyPaused) {
      startCarousel();
    }
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

    if (feeVolumeOut) {
      feeVolumeOut.textContent = formatINR(volume);
    }
    if (avoidableRateOut) {
      avoidableRateOut.textContent = rate.toFixed(1) + '%';
    }

    // DISHA 8.2 Verified Formula
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

  [feeVolumeInput, avoidableRateInput, removedFixedInput, newOperatingInput].forEach((input) => {
    if (input) {
      input.addEventListener('input', calculatePricing);
      input.addEventListener('change', calculatePricing);
    }
  });

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

  calculatePricing();

  // --- 6. Dynamic Year ---
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

  // --- 8. Active Nav Link on Scroll Spy ---
  const sections = document.querySelectorAll('section[id], header[id]');
  const desktopNavLinks = document.querySelectorAll('.desktop-nav a');

  window.addEventListener('scroll', () => {
    let current = '';
    const scrollPos = window.scrollY + 120;

    sections.forEach((section) => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
        current = section.getAttribute('id');
      }
    });

    desktopNavLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href === `#${current}`) {
        link.classList.add('nav-active');
      } else {
        link.classList.remove('nav-active');
      }
    });
  }, { passive: true });

  console.log('DISHA 8.2 PhonePe navigation & interaction system initialized.');
})();
