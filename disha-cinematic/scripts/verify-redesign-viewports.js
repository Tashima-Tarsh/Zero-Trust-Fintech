const puppeteer = require('puppeteer-core');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:/Users/lenovo/.gemini/antigravity/brain/3c4821bd-2d19-494d-9c55-c06a1e8b05a7';
const BASE_URL = 'http://localhost:5000';

async function runVerification() {
  console.log('🚀 Starting DISHA Redesign Multi-Viewport Visual Verification...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const viewports = [
    { name: '1440x900', width: 1440, height: 900, deviceScaleFactor: 1 },
    { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
    { name: '768x1024', width: 768, height: 1024, deviceScaleFactor: 1 },
    { name: '390x844', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }
  ];

  for (const vp of viewports) {
    console.log(`\n📸 Capturing viewport ${vp.name}...`);
    const page = await browser.newPage();
    await page.setViewport(vp);

    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for animations and fonts to settle
    await new Promise(r => setTimeout(r, 1200));

    // Capture Above-the-fold Hero
    const heroPath = path.join(ARTIFACT_DIR, `redesign-hero-${vp.name}.png`);
    await page.screenshot({ path: heroPath });
    console.log(`Saved above-fold hero screenshot: ${heroPath}`);

    // If 1440x900, also take full-page screenshot and test interactions
    if (vp.name === '1440x900') {
      const fullPath = path.join(ARTIFACT_DIR, `redesign-fullpage-${vp.name}.png`);
      await page.screenshot({ path: fullPath, fullPage: true });
      console.log(`Saved full-page screenshot: ${fullPath}`);

      // Verify sections exist and capture specific component crops
      const sections = [
        { id: '#scene-hero', name: 'section-1-hero' },
        { id: '#scene-crisis', name: 'section-2-crisis' },
        { id: '#scene-architecture', name: 'section-3-pipeline' },
        { id: '#scene-vpa-routing', name: 'section-4-vpa' },
        { id: '#scene-ledger', name: 'section-5-ledger' },
        { id: '#scene-calculator', name: 'section-6-roi-calc' },
        { id: '#scene-soundbox', name: 'section-7-soundbox' },
        { id: '#scene-dashboard', name: 'section-8-saas-portal' }
      ];

      for (const sec of sections) {
        const el = await page.$(sec.id);
        if (el) {
          const secPath = path.join(ARTIFACT_DIR, `redesign-${sec.name}.png`);
          await el.screenshot({ path: secPath });
          console.log(`Captured ${sec.name} -> ${secPath}`);
        } else {
          console.warn(`Could not find section ${sec.id}`);
        }
      }

      // Test ROI Calculator Interaction
      console.log('Testing ROI Calculator Slider...');
      const slider = await page.$('#turnoverSlider');
      if (slider) {
        await page.evaluate(() => {
          const s = document.getElementById('turnoverSlider');
          s.value = '1500000';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await new Promise(r => setTimeout(r, 400));
        const calcVal = await page.$eval('#estSavingsVal', el => el.textContent.trim());
        console.log(`ROI Calculator updated value at ₹15L: ${calcVal}`);
        const calcEl = await page.$('#scene-calculator');
        if (calcEl) {
          await calcEl.screenshot({ path: path.join(ARTIFACT_DIR, 'redesign-calc-updated.png') });
        }
      }

      // Test Soundbox Language Switcher & Simulation
      console.log('Testing Soundbox Language selection...');
      const langBtns = await page.$$('.sbox-lang-pill');
      if (langBtns.length > 0) {
        await langBtns[1].click(); // click second language
        await new Promise(r => setTimeout(r, 400));
        const soundboxEl = await page.$('#scene-soundbox');
        if (soundboxEl) {
          await soundboxEl.screenshot({ path: path.join(ARTIFACT_DIR, 'redesign-soundbox-lang-switched.png') });
        }
      }

      // Test Demo QR Click
      console.log('Testing Demo QR Box Click...');
      const qrBox = await page.$('#demoQrBox');
      if (qrBox) {
        await qrBox.click();
        await new Promise(r => setTimeout(r, 600));
        console.log('QR box clicked successfully.');
      }
    }

    await page.close();
  }

  await browser.close();
  console.log('\n🎉 Multi-viewport visual verification finished successfully!');
}

runVerification().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
