const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
  
  const sections = await page.$$eval('.story-scene', els => els.map(e => ({
    id: e.id,
    top: Math.round(e.getBoundingClientRect().top + window.scrollY),
    height: Math.round(e.offsetHeight)
  })));
  
  console.log('Sections layout:', JSON.stringify(sections, null, 2));
  
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

  const nav = await page.$('.disha-bleed-nav');
  if (nav) await nav.screenshot({ path: path.join(screenshotsDir, 'nav-bleed.png') });
  
  const vpa = await page.$('#scene-vpa-routing');
  if (vpa) await vpa.screenshot({ path: path.join(screenshotsDir, 'vpa-section.png') });

  const ledger = await page.$('#scene-ledger');
  if (ledger) await ledger.screenshot({ path: path.join(screenshotsDir, 'ledger-section.png') });

  const dash = await page.$('#scene-dashboard');
  if (dash) await dash.screenshot({ path: path.join(screenshotsDir, 'dashboard-section.png') });

  await browser.close();
  console.log('Screenshots captured successfully!');
})();
