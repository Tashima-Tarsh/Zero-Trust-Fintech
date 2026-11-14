const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1280x720', width: 1280, height: 720 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'mobile-390x844', width: 390, height: 844 }
];

async function captureViews(prefix = 'before') {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

  const results = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.toString()));

    await page.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 600));

    // Check for horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    const screenshotPath = path.join(screenshotsDir, `${prefix}-${vp.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    results.push({
      viewport: vp.name,
      width: vp.width,
      height: vp.height,
      horizontalOverflow: hasHorizontalOverflow,
      errorsCount: errors.length,
      errors: errors,
      screenshot: screenshotPath
    });

    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

captureViews(process.argv[2] || 'before').catch(err => {
  console.error(err);
  process.exit(1);
});
