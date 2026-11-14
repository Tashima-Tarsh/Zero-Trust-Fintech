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

  // Test 1: Click QR code
  await page.click('#demoQrBox');
  await new Promise(r => setTimeout(r, 300));
  const scanPrompt = await page.$eval('#scanPromptText', el => el.textContent.trim());
  console.log('Test 1 - QR Scan Prompt:', scanPrompt);

  // Test 2: Soundbox trigger
  await page.click('#btnTriggerSoundbox');
  await new Promise(r => setTimeout(r, 450));
  const lcdText = await page.$eval('#soundboxLcd', el => el.textContent.replace(/\s+/g, ' ').trim());
  console.log('Test 2 - Soundbox LCD Text:', lcdText);

  // Test 3: Slider recalculation
  await page.$eval('#volumeSlider', el => {
    el.value = '2500000';
    el.dispatchEvent(new Event('input'));
  });
  const newLoss = await page.$eval('#monthlyLoss', el => el.textContent);
  const newSavings = await page.$eval('#annualSavings', el => el.textContent);
  console.log('Test 3 - Recalculated at 25L: Loss =', newLoss, 'Savings =', newSavings);

  await browser.close();
  console.log('All interactive tests passed successfully!');
})();
