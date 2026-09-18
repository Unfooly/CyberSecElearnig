// Zrzuty ekranu do przeglądu rebrandingu: node docs/brand/screens/shoot.mjs <etap>
// Wymaga działającego web (BASE) i API z kontem demo (admin@demo.test).
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3010';
const stage = process.argv[2] ?? 'stage';
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login`);
await page.screenshot({ path: `${outDir}${stage}-login.png` });
await page.fill('input[type=email]', 'admin@demo.test');
await page.fill('input[type=password]', 'Demo12345!x');
await Promise.all([page.waitForURL(/\/(dashboard|courses)/), page.click('button[type=submit]')]);
for (const [name, path] of [['dashboard', '/dashboard'], ['team', '/dashboard/users'], ['courses', '/courses']]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${outDir}${stage}-${name}.png`, fullPage: true });
}
await browser.close();
