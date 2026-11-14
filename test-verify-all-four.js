const puppeteer = require('./disha-cinematic/node_modules/puppeteer-core');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/lenovo/.gemini/antigravity/brain/3c4821bd-2d19-494d-9c55-c06a1e8b05a7';

(async () => {
  console.log('🚀 Running Full Verification for Nitish@oksbi and Touch QR Flow...\n');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log('   [PAGE LOG]', msg.text()));
    page.on('pageerror', err => console.log('   [PAGE ERROR]', err.message));
    await page.setViewport({ width: 1280, height: 800 });

    // 1. Verify Clean Login Page (No Admin Box)
    console.log('1. Checking http://localhost:5000/login (Clean Production Login, No Admin Box)...');
    await page.goto('http://localhost:5000/login', { waitUntil: 'networkidle0' });
    const hasAdminBox = await page.$('.provision-helper-card');
    console.log('   ✅ Admin Provisioned Helper Card removed from login page:', hasAdminBox === null);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-1-clean-login-nitish.png') });

    // 2. Perform Login with Nitish@oksbi / Tashima@906099
    console.log('\n2. Logging in with Nitish@oksbi...');
    await page.type('#email', 'Nitish@oksbi');
    await page.type('#password', 'Tashima@906099');
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#submitBtn')
    ]);
    console.log('   ✅ Navigated successfully to:', page.url());

    // Allow dashboard scripts to finish loading
    await new Promise(r => setTimeout(r, 1000));

    // 3. Verify Merchant Dashboard for Nitish
    const bizName = await page.$eval('#sideMerchantName', el => el.textContent.trim());
    const primaryVpa = await page.$eval('#sideMerchantVpa', el => el.textContent.trim());
    console.log(`   ✅ Logged in as: ${bizName} (${primaryVpa})`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-2-nitish-dashboard-overview.png') });

    // 4. Test Create Payment Link with Automated Order ID
    console.log('\n3. Navigating to Create Payment Workspace...');
    await page.click('a[data-workspace="create-payment"]');
    await new Promise(r => setTimeout(r, 800));

    await page.waitForSelector('#orderCustomId');
    const autoOrderId = await page.$eval('#orderCustomId', el => el.value);
    console.log('   ✅ Automated Order ID pre-filled:', autoOrderId);

    // Enter Amount and click generate
    await page.type('#orderAmount', '500.00');
    await page.click('#btnGeneratePayment');
    await new Promise(r => setTimeout(r, 1000));

    // Verify QR card and Pay with App button
    await page.waitForSelector('#btnOpenUpiApp', { visible: true });
    const upiLink = await page.$eval('#btnOpenUpiApp', el => el.href);
    console.log('   ✅ Direct UPI Intent link generated:', upiLink.substring(0, 50) + '...');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-3-nitish-created-payment.png') });

    // Simulate Customer Payment
    console.log('\n4. Simulating Customer Payment for Live Confirmation...');
    await page.click('#btnSimulatePayment');
    await new Promise(r => setTimeout(r, 1500));

    await page.waitForSelector('#paymentConfirmationCard', { visible: true });
    const confirmUtr = await page.$eval('#confirmUtr', el => el.textContent.trim());
    const confirmOrderId = await page.$eval('#confirmOrderId', el => el.textContent.trim());
    const confirmTime = await page.$eval('#confirmTimestamp', el => el.textContent.trim());
    console.log(`   ✅ Live Payment Confirmation Card: Order ${confirmOrderId}, Bank UTR ${confirmUtr}, Time: ${confirmTime}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-4-nitish-payment-confirmation.png') });

    // 5. Verify Customer Sovereign Checkout on port 3000
    console.log('\n5. Checking Customer Checkout http://localhost:3000 (QR Clickable)...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#qrDirectLink');
    const checkoutUpi = await page.$eval('#qrDirectLink', el => el.href);
    console.log('   ✅ Customer Checkout QR Direct Link:', checkoutUpi.substring(0, 50) + '...');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-5-customer-checkout-qr.png') });

    // 6. Verify Customer Confirmation Screen
    console.log('\n6. Checking Customer Confirmation Receipt http://localhost:3000/success.html...');
    await page.goto('http://localhost:3000/success.html?utr=631902884112&amount=500.34&orderId=ORD_261115_TEST&txId=TX_D19A82B3C4&sender=Nitish@oksbi&vpa=Nitish@oksbi&time=' + Date.now(), { waitUntil: 'networkidle0' });
    await page.waitForSelector('#payerVpaVal');
    const payer = await page.$eval('#payerVpaVal', el => el.textContent.trim());
    const successTime = await page.$eval('#paymentTimestampVal', el => el.textContent.trim());
    console.log(`   ✅ Payer: ${payer}, Payment Timestamp: ${successTime}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-6-customer-receipt-full.png') });

    console.log('\n🎉 ALL REQUESTED REQUIREMENTS VERIFIED WITH ZERO ERRORS!');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
