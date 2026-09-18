// Ręczna weryfikacja na działającej aplikacji: dla każdej roli loguje się
// przez prawdziwy formularz i sprawdza, gdzie ląduje użytkownik, czy sesja
// (cookies) przetrwała oraz co robi "/" dla zalogowanego.
// Użycie (po node apps/api/... seed-dev-roles): BASE=http://localhost:3010 node scripts/verify-role-redirects.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3010';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo12345!x';
const USERS = [
  ['ORG_ADMIN', 'admin@demo.test', '/dashboard'],
  ['SUPER_ADMIN', 'super-admin@demo.test', '/courses'],
  ['DEPARTMENT_MANAGER', 'manager@demo.test', '/courses'],
  ['EMPLOYEE', 'employee@demo.test', '/courses'],
];

const browser = await chromium.launch();
let failed = false;
for (const [role, email, expected] of USERS) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cookieNames = async () => (await context.cookies(BASE)).map((c) => c.name).sort().join(',') || '(brak)';
  const pathOf = () => new URL(page.url()).pathname;

  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  const afterLogin = pathOf();
  const cookiesAfterLogin = await cookieNames();

  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  const afterReload = pathOf();

  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const fromRoot = pathOf();

  const ok = afterLogin === expected && afterReload === expected && fromRoot === expected && cookiesAfterLogin.includes('refresh_token');
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${role} (${email})`);
  console.log(`     po logowaniu: ${afterLogin} (oczekiwano ${expected}), cookies: ${cookiesAfterLogin}`);
  console.log(`     po odświeżeniu strony: ${afterReload}; wejście na "/": ${fromRoot}`);

  // Ścieżka zabroniona dla roli (tylko ORG_ADMIN ma /dashboard): sprawdzamy, że
  // to middleware, a nie logowanie, odsyła na /login.
  if (role !== 'ORG_ADMIN') {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log(`     ręczne wejście na /dashboard: ${pathOf()}, cookies: ${await cookieNames()}`);
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
