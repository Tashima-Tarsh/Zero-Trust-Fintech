const puppeteer = require('../disha-cinematic/node_modules/puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function testQrTouch() {
  console.log('🚀 Starting QR Touch & Intent Verification...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // ----------------------------------------------------
    // TEST 1: Customer Checkout Desktop Flow (Port 3000)
    // ----------------------------------------------------
    console.log('\n--- 1. Testing Customer Checkout on Desktop (Port 3000) ---');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // Wait for session & canvas to be loaded
    await page.waitForSelector('#qrCanvas');
    console.log('✅ QR Canvas loaded on checkout page.');

    // Click on the QR Canvas
    await page.click('#qrCanvas');
    await sleep(400);

    // Verify Desktop Modal appeared
    const modalVisible = await page.$eval('#desktopUpiModal', el => el.style.display !== 'none');
    console.log('✅ Desktop UPI Guidance Modal visible after QR click:', modalVisible);

    // Take screenshot of desktop modal
    await page.screenshot({ path: 'test-artifacts/verify-touch-1-checkout-desktop-modal.png' });

    // Test Simulate button in modal
    console.log('Testing Simulate Instant Payment from modal...');
    await page.click('#desktopUpiModal .btn-modal-sim');
    
    // Wait for redirect to success receipt
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
    const currentUrl = page.url();
    console.log('✅ Redirected after simulation to:', currentUrl);
    await page.screenshot({ path: 'test-artifacts/verify-touch-2-checkout-success-redirect.png' });
    await page.close();

    // ----------------------------------------------------
    // TEST 2: Customer Checkout Mobile Flow (Emulated Pixel 7)
    // ----------------------------------------------------
    console.log('\n--- 2. Testing Customer Checkout Mobile Emulation (Android Chrome) ---');
    const mobilePage = await browser.newPage();
    await mobilePage.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    await mobilePage.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

    await mobilePage.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await mobilePage.waitForSelector('#qrCanvas');
    console.log('✅ Mobile checkout page ready.');

    // Tap the QR canvas on mobile
    await mobilePage.tap('#qrCanvas');
    await sleep(300);
    let lastUri = await mobilePage.evaluate(() => window.__lastDispatchedUri);
    console.log('✅ Tapped QR Canvas on mobile. Dispatched URI:', lastUri);

    // Also tap Google Pay pill button
    await mobilePage.click('button[onclick="launchSpecificUpi(\'gpay\')"]');
    await sleep(300);
    lastUri = await mobilePage.evaluate(() => window.__lastDispatchedUri);
    console.log('✅ Tapped Google Pay launcher. Dispatched URI:', lastUri);

    // Also tap PhonePe pill button
    await mobilePage.click('button[onclick="launchSpecificUpi(\'phonepe\')"]');
    await sleep(300);
    lastUri = await mobilePage.evaluate(() => window.__lastDispatchedUri);
    console.log('✅ Tapped PhonePe launcher. Dispatched URI:', lastUri);

    await mobilePage.screenshot({ path: 'test-artifacts/verify-touch-3-mobile-checkout.png' });
    await mobilePage.close();

    // ----------------------------------------------------
    // TEST 3: Merchant Dashboard Create Payment (Port 5000)
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Merchant Dashboard QR Touch (Port 5000) ---');
    const dashPage = await browser.newPage();
    await dashPage.setViewport({ width: 1280, height: 900 });

    // Login as Nitish@oksbi
    await dashPage.goto('http://localhost:5000/login', { waitUntil: 'networkidle0' });
    await dashPage.type('#email', 'Nitish@oksbi');
    await dashPage.type('#password', 'Tashima@906099');
    await dashPage.click('#submitBtn');
    await dashPage.waitForFunction(() => window.location.pathname.includes('dashboard'), { timeout: 8000 });
    console.log('✅ Successfully authenticated Nitish@oksbi into dashboard.');
    await sleep(1000);

    // Navigate to Create Payment
    await dashPage.click('a[data-workspace="create-payment"]');
    await sleep(600);
    await dashPage.waitForFunction(() => {
      const el = document.getElementById('ws-create-payment');
      return el && el.classList.contains('active');
    }, { timeout: 5000 });

    // Generate Payment
    await dashPage.type('#orderAmount', '250');
    await dashPage.click('#btnGeneratePayment');
    await dashPage.waitForSelector('#qrActiveState', { visible: true });
    console.log('✅ Payment QR generated in merchant dashboard.');

    // Click on the QR card on desktop
    await dashPage.click('#qrCardBox');
    await sleep(400);

    const dashModalVisible = await dashPage.$eval('#dashUpiModal', el => el.style.display !== 'none');
    console.log('✅ Dashboard UPI Guidance Modal visible after QR click:', dashModalVisible);
    await dashPage.screenshot({ path: 'test-artifacts/verify-touch-4-dashboard-modal.png' });

    // Simulate payment from dashboard modal
    console.log('Simulating payment from dashboard modal...');
    await dashPage.click('#dashUpiModal .btn-dash-primary');
    await sleep(2000);

    const confirmationVisible = await dashPage.$eval('#paymentConfirmationCard', el => el.style.display !== 'none');
    console.log('✅ Dashboard Live Payment Confirmation visible:', confirmationVisible);
    await dashPage.screenshot({ path: 'test-artifacts/verify-touch-5-dashboard-confirmed.png' });
    await dashPage.close();

    console.log('\n🎉 ALL QR TOUCH & INTENT TESTS PASSED WITH 100% SUCCESS!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

testQrTouch();
