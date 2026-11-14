const puppeteer = require('puppeteer-core');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  page.on('dialog', async d => { console.log('DIALOG:', d.message()); await d.dismiss(); });

  await page.goto('http://localhost:5000/login', { waitUntil: 'networkidle0' });
  await page.type('#email', 'ramesh@kirana.in');
  await page.type('#password', 'Ramesh@123');
  await page.click('#submitBtn');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  console.log('Navigated to:', page.url());
  await page.evaluate(() => switchWorkspace('create-payment'));
  await new Promise(r => setTimeout(r, 600));

  const info = await page.evaluate(() => {
    return {
      overviewActive: document.getElementById('ws-overview').classList.contains('active'),
      createPaymentActive: document.getElementById('ws-create-payment').classList.contains('active'),
      amountVal: document.getElementById('orderAmount').value
    };
  });
  console.log('Workspace state before typing:', info);

  console.log('Setting amount...');
  await page.evaluate(() => {
    document.getElementById('orderAmount').value = '1250.00';
    document.getElementById('orderDesc').value = 'Test Order';
  });

  const invalidElement = await page.evaluate(() => {
    const form = document.getElementById('createPaymentForm');
    for (const el of form.elements) {
      if (!el.checkValidity()) {
        return { tag: el.tagName, id: el.id, name: el.name, validity: el.validationMessage };
      }
    }
    return null;
  });
  console.log('Invalid element in createPaymentForm:', invalidElement);

  console.log('Submitting form...');
  await page.evaluate(() => {
    document.getElementById('btnGeneratePayment').scrollIntoView();
    document.getElementById('createPaymentForm').requestSubmit();
  });
  await new Promise(r => setTimeout(r, 1500));

  const activeDisplay = await page.$eval('#qrActiveState', el => window.getComputedStyle(el).display);
  console.log('qrActiveState display:', activeDisplay);
  const linkVal = await page.$eval('#generatedLinkInput', el => el.value);
  console.log('generatedLinkInput:', linkVal);

  await browser.close();
})();
