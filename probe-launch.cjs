const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('https://example.com', { timeout: 20000 });
  console.log('TITLE:', await p.title());
  await b.close();
  console.log('LAUNCH OK');
})().catch(e => { console.error('LAUNCH FAIL:', e.message); process.exit(1); });
