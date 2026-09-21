// E2E w przeglądarce (Playwright) po CAŁEJ ścieżce samoobsługowej rejestracji:
// formularz -> mail (link z logu API, bez prawdziwej wysyłki) -> ustaw hasło ->
// logowanie -> ekran weryfikacji domeny (rekord TXT) -> "Sprawdź teraz" (najpierw
// brak rekordu, potem rekord wpisany) -> panel -> ustawienia (selfJoinEnabled).
//
// Skrypt sam uruchamia API (apps/api/dist, wymaga `npm run build --workspace=apps/api`)
// i web (`next start`, wymaga `npm run build --workspace=apps/web`) na wolnych portach,
// używa lokalnej bazy z .env i sprząta po sobie. DNS jest podmieniony preloadem
// scripts/e2e/dns-stub.cjs (tylko w procesie API tego skryptu).
//
// Użycie z katalogu repo (dotenv-cli ładuje bazę i sekrety JWT z .env):
//   npx dotenv -e .env -- node scripts/e2e-registration.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

const API_PORT = process.env.E2E_API_PORT ?? '3101';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3100';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const DOMAIN = `e2e-${RUN}.test`;
const EMAIL = `admin@${DOMAIN}`;
const COMPANY = `E2E Firma ${RUN}`;
const PASSWORD = 'E2e-Haslo-Testowe-1!';
const tmpDir = mkdtempSync(join(tmpdir(), 'unfooly-e2e-'));
const dnsFile = join(tmpDir, 'txt');

const children = [];
let apiLog = '';
const results = [];

function step(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) throw new Error(`Krok nieudany: ${name}`);
}

async function waitFor(check, what, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout: ${what}`);
}

function start(name, command, args, env, cwd) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, shell: false });
  children.push(child);
  const sink = (chunk) => {
    // Log web też trafia do bufora (przydatny przy diagnostyce), ale link aktywacyjny szukamy w całości.
    apiLog += chunk.toString();
  };
  child.stdout.on('data', sink);
  child.stderr.on('data', sink);
  return child;
}

async function cleanup(prisma) {
  for (const child of children) child.kill();
  try {
    await prisma?.organization.deleteMany({ where: { name: { in: [COMPANY, `${COMPANY} (wyświetlana)`] } } });
    // Kurs po organizacjach: przypisania znikają kaskadowo, a kurs z przypisaniami jest chroniony (RESTRICT, B-032).
    if (courseId) await prisma?.course.deleteMany({ where: { id: courseId } });
    await prisma?.$disconnect();
  } catch (error) {
    console.error('Sprzątanie bazy nie powiodło się:', error.message);
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

let prisma;
let browser;
let courseId;
try {
  // Zmienne z .env (baza, sekrety JWT) dziedziczy proces API; token MailerSend nadpisany na pusty =>
  // tryb deweloperski: mail nie wychodzi, a link ląduje w logu API.
  const apiEnv = {
    PORT: API_PORT,
    FRONTEND_URL: WEB,
    MAILERSEND_API_TOKEN: '',
    BACKGROUND_JOBS_ENABLED: 'false',
    NODE_ENV: 'development',
    E2E_DNS_TXT_FILE: dnsFile,
  };
  start('api', process.execPath, ['-r', './scripts/e2e/dns-stub.cjs', 'apps/api/dist/main.js'], apiEnv, process.cwd());
  start(
    'web',
    process.execPath,
    [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', WEB_PORT],
    { API_URL: API },
    join(process.cwd(), 'apps', 'web'),
  );

  await waitFor(async () => (await fetch(`${API}/`)).status > 0, 'start API');
  await waitFor(async () => (await fetch(`${WEB}/`)).ok, 'start web');

  browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const pathOf = () => new URL(page.url()).pathname;

  // Naruszenia Content-Security-Policy (D-053) w konsoli przeglądarki przez CAŁY scenariusz: rejestracja, aktywacja, logowanie,
  // onboarding, panel, ustawienia i odtwarzacz kursu. Chromium zgłasza je jako błędy konsoli i błędy strony.
  const cspViolations = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      cspViolations.push(`${pathOf()}: ${message.text().slice(0, 200)}`);
    }
  });
  page.on('pageerror', (error) => {
    if (/content security policy/i.test(error.message)) cspViolations.push(`${pathOf()}: ${error.message.slice(0, 200)}`);
  });

  // 1. Formularz rejestracji: brak pól hasła, komplet danych, zgody.
  const registerResponse = await page.goto(`${WEB}/register`);
  const csp = registerResponse.headers()['content-security-policy'] ?? '';
  step(
    'nagłówek CSP: script-src z nonce, bez unsafe-inline/unsafe-eval; object-src none; frame-ancestors none',
    /script-src 'self' 'nonce-[^']+'(;|$)/.test(csp) && !/script-src[^;]*unsafe-/.test(csp) && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"),
    csp.slice(0, 120),
  );
  step('skrypty Next.js na stronie mają nonce z nagłówka', (await page.locator('script[nonce]').count()) > 0);
  step('formularz nie ma pól hasła', (await page.locator('input[type=password]').count()) === 0);
  await page.fill('#firstName', 'Ewa');
  await page.fill('#lastName', 'Testowa');
  await page.fill('#email', EMAIL);
  await page.fill('#organizationLegalName', COMPANY);
  await page.fill('#organizationName', COMPANY);
  await page.fill('#taxId', '526-025-02-74');
  await page.fill('#addressLine', 'ul. Testowa 1');
  await page.fill('#postalCode', '00-001');
  await page.fill('#city', 'Warszawa');
  await page.getByLabel(/Akceptuję/).check();
  await page.getByLabel(/Zapoznałem/).check();
  await page.getByRole('button', { name: /załóż konto firmy/i }).click();
  await page.getByText('Sprawdź skrzynkę e-mail').waitFor();
  step('rejestracja: ekran "Sprawdź skrzynkę e-mail"', true);

  // 2. Link aktywacyjny z logu API (rejestracja działa w tle - czekamy na mail).
  const activationUrl = await waitFor(
    async () => /registration-activation[\s\S]*?"activationUrl":"([^"]+)"/.exec(apiLog)?.[1],
    'mail aktywacyjny w logu API',
  );
  step('mail aktywacyjny zawiera nazwę firmy', apiLog.includes(`"organizationName":"${COMPANY}"`));

  // 3. Ustawienie hasła.
  await page.goto(activationUrl);
  await page.fill('#newPassword', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);
  await page.getByRole('button', { name: /ustaw nowe hasło/i }).click();
  await page.waitForURL((url) => url.pathname === '/login');
  step('po ustawieniu hasła przekierowanie na /login', true);

  // 4. Logowanie -> organizacja PENDING => /onboarding.
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname !== '/login');
  step('logowanie kieruje na /onboarding (organizacja PENDING)', pathOf() === '/onboarding', pathOf());

  // 5. Dashboard jest zablokowany (guard API) i odsyła na onboarding.
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState('networkidle');
  step('wejście na /dashboard wraca na /onboarding', pathOf() === '/onboarding', pathOf());
  await page.goto(`${WEB}/dashboard/users`);
  await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 10000 }).catch(() => {});
  step('wejście na /dashboard/users wraca na /onboarding', pathOf() === '/onboarding', pathOf());

  // 6. Rekord TXT z ekranu.
  const host = await page.locator('dd code').nth(1).innerText();
  const value = await page.locator('dd code').nth(2).innerText();
  step('ekran pokazuje host i wartość rekordu TXT', host === `_unfooly-verify.${DOMAIN}` && value.startsWith('unfooly-verify='), host);

  // 7. "Sprawdź teraz" bez rekordu => jeden komunikat porażki, zostajemy na ekranie.
  await page.getByRole('button', { name: 'Sprawdź teraz' }).click();
  await page.getByRole('alert').getByText(/nie znaleźliśmy jeszcze poprawnego rekordu/i).waitFor();
  step('brak rekordu w DNS: komunikat porażki, ekran bez zmian', pathOf() === '/onboarding');

  // 8. Ustawienia PRZED weryfikacją: przełącznik zablokowany.
  await page.goto(`${WEB}/dashboard/settings`);
  step('ustawienia: przełącznik selfJoin zablokowany do weryfikacji', await page.getByRole('switch').isDisabled());
  await page.goto(`${WEB}/onboarding`);

  // 9. Rekord "wpisany w DNS" (plik czytany przez stub) + odczekanie cooldownu 10 s.
  writeFileSync(dnsFile, value);
  // Cooldown per organizacja w API (DomainVerificationService) wynosi 10 s.
  await page.waitForTimeout(10500);
  await page.getByRole('button', { name: 'Sprawdź teraz' }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 20000 });
  step('poprawny rekord: organizacja odblokowana, przejście do /dashboard', true);

  // 10. Po weryfikacji: onboarding odsyła do panelu, ustawienia pozwalają włączyć selfJoin.
  await page.goto(`${WEB}/onboarding`);
  step('/onboarding dla organizacji ACTIVE odsyła do /dashboard', pathOf() === '/dashboard', pathOf());
  await page.goto(`${WEB}/dashboard/settings`);
  await page.getByText(COMPANY, { exact: false }).first().waitFor();
  const toggle = page.getByRole('switch');
  step('ustawienia: przełącznik aktywny po weryfikacji', await toggle.isEnabled());
  // Przełącznik zmienia stan dopiero po potwierdzeniu z API (nie optymistycznie) - stąd click, nie check.
  await toggle.click();
  await page.getByText('Ustawienie zapisane.').waitFor();
  step('przełącznik włączony po odpowiedzi API', await toggle.isChecked());
  step('selfJoinEnabled zapisane', true);

  prisma = new PrismaClient();
  const org = await prisma.organization.findFirst({ where: { name: COMPANY } });
  step('baza: status ACTIVE i selfJoinEnabled', org?.status === 'ACTIVE' && org.selfJoinEnabled === true);

  // 11. Odtwarzacz kursu (dummy: kurs w formacie sprzed silnika: QUIZ, scenariusz, DRAG_AND_DROP - bez wideo z obcego hosta i bez
  // EMBEDDED_HTML z inline-skryptem: patrz D-053, oba wymagają osobnych rozwiązań w PR 2). Przypisanie ma FORCE RLS, więc idzie
  // w transakcji z kontekstem organizacji (jak TenantPrismaService).
  const course = await prisma.course.create({
    data: {
      title: `E2E kurs CSP ${RUN}`,
      category: 'EMAIL_SECURITY',
      durationMinutes: 3,
      contentBlocks: [
        { type: 'QUIZ', prompt: 'Który adres jest podejrzany?', options: [{ text: 'a@bank.pl', correct: false }, { text: 'a@bank-0.pl', correct: true }] },
        { type: 'BRANCHING_SCENARIO', prompt: 'Co robisz?', options: [{ text: 'Klikam', outcome: 'wrong' }, { text: 'Zgłaszam', outcome: 'correct' }] },
        { type: 'DRAG_AND_DROP', prompt: 'Posegreguj', items: [{ text: 'Mail 1' }], categories: ['Bezpieczne', 'Phishing'] },
      ],
    },
  });
  courseId = course.id;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    const admin = await tx.user.findFirst({ where: { organizationId: org.id, email: EMAIL } });
    await tx.courseAssignment.create({ data: { organizationId: org.id, userId: admin.id, courseId } });
  });
  await page.goto(`${WEB}/courses/${courseId}`);
  await page.getByText('Który adres jest podejrzany?').waitFor();
  await page.getByLabel('a@bank-0.pl').check();
  step('odtwarzacz kursu: blok się renderuje i reaguje na kliknięcie (hydracja z nonce działa)', await page.getByLabel('a@bank-0.pl').isChecked());

  step('brak naruszeń CSP w konsoli przez cały scenariusz (rejestracja, panel, ustawienia, odtwarzacz)', cspViolations.length === 0, cspViolations.slice(0, 3).join(' | '));

  // Kontrola negatywna: skrypt inline BEZ nonce musi zostać zablokowany. Bez niej "zero naruszeń" mogłoby znaczyć "CSP nie działa".
  await page.evaluate(() => {
    window.__cspCanary = false;
    const script = document.createElement('script');
    script.textContent = 'window.__cspCanary = true';
    document.body.appendChild(script);
  });
  await page.waitForTimeout(300);
  step(
    'kontrola: inline-skrypt bez nonce jest zablokowany przez CSP (i zgłoszony w konsoli)',
    (await page.evaluate(() => window.__cspCanary)) === false && cspViolations.length > 0,
    cspViolations[0]?.slice(0, 100),
  );
  console.log(`\nWSZYSTKIE KROKI OK (${results.length})`);
} catch (error) {
  console.error(`\nBŁĄD: ${error.message}`);
  console.error('--- ostatnie logi API ---\n' + apiLog.split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  prisma ??= new PrismaClient();
  await cleanup(prisma);
}
