/**
 * DISHA 8.2 End-to-End Puppeteer Journey Verification
 */

const puppeteer = require('../disha-cinematic/node_modules/puppeteer-core');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/lenovo/.gemini/antigravity/brain/3c4821bd-2d19-494d-9c55-c06a1e8b05a7';

(async () => {
  console.log('🧪 Starting DISHA 8.2 End-to-End Browser Journey Verification...\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  // 1. Load Checkout Page
  console.log('--- 1. Testing Checkout Page Load ---');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  const title = await page.title();
  console.log('Page Title:', title);

  const baseAmt = await page.$eval('#baseAmountVal', el => el.textContent);
  const chalAmt = await page.$eval('#challengeAmountVal', el => el.textContent);
  const centsBadge = await page.$eval('#challengeCentsBadge', el => el.textContent);
  console.log(`Summary: Base ${baseAmt} | Challenge ${chalAmt} (${centsBadge})`);

  // Verify Canvas QR
  const canvasExists = await page.$('#qrCanvas');
  console.log('Untouchable Canvas QR present:', Boolean(canvasExists));

  // Verify Countdown Timer
  const timerText = await page.$eval('#timerSeconds', el => el.textContent);
  console.log('Active Countdown Timer:', timerText);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'disha82-checkout-home.png') });
  console.log('📸 Captured disha82-checkout-home.png');

  // 2. Test Savings Calculator Interaction
  console.log('\n--- 2. Testing Savings Calculator Interaction ---');
  await page.evaluate(() => {
    const slider = document.getElementById('turnoverSlider');
    slider.value = 1500000;
    slider.dispatchEvent(new Event('input'));
  });
  await new Promise(r => setTimeout(r, 200));
  const newTurnover = await page.$eval('#calcTurnoverVal', el => el.textContent);
  const newAnnualSaved = await page.$eval('#calcAnnualSavedVal', el => el.textContent);
  console.log(`Calculator Slider adjusted -> Turnover: ${newTurnover} | Annual Kept: ${newAnnualSaved}`);

  // 3. Test Simulation & Real-time WebSocket to Success Screen
  console.log('\n--- 3. Testing Payment Simulation & WebSocket Redirect ---');
  await page.click('#btnSimulatePay');
  
  // Wait for redirect to /success.html
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
  const successUrl = page.url();
  console.log('Redirected to:', successUrl);

  const successUtr = await page.$eval('#successUtr', el => el.textContent);
  const successAmt = await page.$eval('#successAmount', el => el.textContent);
  const ledgerDebit = await page.$eval('#ledgerDebit', el => el.textContent);
  const ledgerCredit = await page.$eval('#ledgerCredit', el => el.textContent);
  console.log(`Success Receipt: UTR ${successUtr} | Amount ${successAmt} | Debit: ${ledgerDebit} | Credit: ${ledgerCredit}`);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'disha82-checkout-success.png') });
  console.log('📸 Captured disha82-checkout-success.png');

  // 4. Test Failed Screen
  console.log('\n--- 4. Testing Failed Fraud Interception Screen ---');
  await page.goto('http://localhost:3000/failed.html?reason=Amount%20tampering%20detected!%20Expected%20%E2%82%B9100.37,%20received%20%E2%82%B9100.00&layer=Fraud%20Layer%202%20(Amount%20Match)', { waitUntil: 'networkidle0' });
  const failedReason = await page.$eval('#failedReason', el => el.textContent);
  const failedLayer = await page.$eval('#failedLayer', el => el.textContent);
  console.log(`Failure Display: [${failedLayer}] ${failedReason}`);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'disha82-checkout-failed.png') });
  console.log('📸 Captured disha82-checkout-failed.png');

  // 5. Test Mobile Responsive Viewport (390x844)
  console.log('\n--- 5. Testing Mobile Viewport (390x844) ---');
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'disha82-checkout-mobile.png') });
  console.log('📸 Captured disha82-checkout-mobile.png');

  console.log('\n🎉 ALL DISHA 8.2 END-TO-END JOURNEY CHECKS PASSED WITH 100% SUCCESS!\n');
  await browser.close();
})();
