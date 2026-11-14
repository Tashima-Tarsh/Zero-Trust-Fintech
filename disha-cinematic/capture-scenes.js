const puppeteer = require('puppeteer-core');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle0' });

  const scenes = [
    { id: 'scene-hero', name: 'scene-1-hero.png' },
    { id: 'scene-crisis', name: 'scene-2-crisis.png' },
    { id: 'scene-hero-arrives', name: 'scene-5-disha-hero.png' },
    { id: 'scene-transform', name: 'scene-6-transform.png' },
    { id: 'scene-calculator', name: 'scene-8-calculator.png' },
    { id: 'scene-soundbox', name: 'scene-9-soundbox.png' }
  ];

  for (const s of scenes) {
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'instant' });
    }, s.id);
    await new Promise(r => setTimeout(r, 450));
    await page.screenshot({ path: `screenshots/${s.name}` });
  }

  await browser.close();
  console.log('All scene screenshots captured successfully.');
})();
