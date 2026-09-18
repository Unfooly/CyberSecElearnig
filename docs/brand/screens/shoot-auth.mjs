// Zrzuty stron publicznych: node docs/brand/screens/shoot-auth.mjs <etap>
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3010';
const stage = process.argv[2] ?? 'auth';
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const shots = [
  ['login', '/login'],
  ['register', '/register'],
  ['verify-email', '/verify-email?token=nieprawidlowy'],
  ['forgot-password', '/forgot-password'],
  ['reset-password', '/reset-password?token=nieprawidlowy'],
];
for (const [name, path] of shots) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${outDir}${stage}-${name}.png` });
}
// Stan błędu walidacji na logowaniu.
await page.goto(`${BASE}/login`);
await page.click('button[type=submit]');
await page.screenshot({ path: `${outDir}${stage}-login-errors.png` });
await browser.close();
