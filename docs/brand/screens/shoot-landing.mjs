// Zrzuty strony głównej: node docs/brand/screens/shoot-landing.mjs <etap>
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3010';
const stage = process.argv[2] ?? 'landing';
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const browser = await chromium.launch();
for (const [name, width] of [['1440', 1440], ['1024', 1024], ['390', 390]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${outDir}${stage}-${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${name}px: poziomy overflow = ${overflow}px`);
  await page.close();
}
await browser.close();
