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
// Wymaga zbudowanych pakietów: `npm run build --workspace=packages/shared` i `--workspace=packages/content` (skrypt importuje
// packages/content/dist/node.js do wyliczenia skrótu treści kursu v2). Na końcu sprawdza odtwarzacz modułu (powłoka, CSP, brak
// przewijania poziomego na 1280 i 390 px) i zapisuje zrzuty ekranu do E2E_SCREENSHOT_DIR (domyślnie docs/brand/screens, poza gitem).
//
// Użycie z katalogu repo (dotenv-cli ładuje bazę i sekrety JWT z .env):
//   npx dotenv -e .env -- node scripts/e2e-registration.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    if (courseIds.length > 0) await prisma?.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma?.$disconnect();
  } catch (error) {
    console.error('Sprzątanie bazy nie powiodło się:', error.message);
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

let prisma;
let browser;
const courseIds = [];
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
  const courseId = course.id;
  courseIds.push(course.id);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    const admin = await tx.user.findFirst({ where: { organizationId: org.id, email: EMAIL } });
    await tx.courseAssignment.create({ data: { organizationId: org.id, userId: admin.id, courseId } });
  });
  await page.goto(`${WEB}/courses/${courseId}`);
  await page.getByText('Który adres jest podejrzany?').waitFor();
  await page.getByLabel('a@bank-0.pl').check();
  step('odtwarzacz kursu: blok się renderuje i reaguje na kliknięcie (hydracja z nonce działa)', await page.getByLabel('a@bank-0.pl').isChecked());

  // 12. Powłoka odtwarzacza modułu (silnik scen, PR 2): kurs w formacie v2 z narracją i maskotką, zrzuty ekranu na desktopie i telefonie.
  // Zrzuty lądują w E2E_SCREENSHOT_DIR (domyślnie docs/brand/screens, katalog poza gitem). Nagranie to cisza WAV serwowana przez
  // page.route pod ścieżką .mp3 (tylko na potrzeby zrzutu: prawdziwe pliki audio dochodzą w PR 3).
  // Skrypt jest ESM, a pakiet CJS: ścieżka z rozszerzeniem, eksport przez interop (named albo default).
  const contentNode = await import('@cyberszkolo/content/dist/node.js');
  const hashContent = contentNode.hashContent ?? contentNode.default.hashContent;
  const demoBlocks = [
    { id: 'wstep', type: 'QUIZ', prompt: 'Pytanie wstępne', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
    {
      id: 'adres',
      type: 'QUIZ',
      title: 'Adres nadawcy',
      prompt: 'Który adres nadawcy jest podejrzany?',
      options: [{ text: 'wsparcie@bank-oficjalny.pl', correct: false }, { text: 'wsparcie@bank-0ficjalny.pl', correct: true }],
      narration: {
        text: 'Spójrz uważnie na adres nadawcy. Oszuści często podmieniają jedną literę. Zwróć uwagę na zero zamiast litery o.',
        audioUrl: 'audio/demo.mp3',
        durationMs: 8000,
        cues: [
          { text: 'Spójrz uważnie na adres nadawcy.', startMs: 0 },
          { text: 'Oszuści często podmieniają jedną literę.', startMs: 2600 },
          { text: 'Zwróć uwagę na zero zamiast litery o.', startMs: 5400 },
        ],
      },
      mascot: {
        pose: 'pointing',
        text: 'Sprawdź dokładnie każdy znak w adresie! Oszuści podmieniają pojedyncze litery, na przykład literę o na zero. Jeśli coś budzi wątpliwości, nie klikaj i zgłoś wiadomość.',
      },
    },
    { id: 'link', type: 'QUIZ', prompt: 'Co zrobisz z linkiem?', options: [{ text: 'Kliknę', correct: false }, { text: 'Zgłoszę', correct: true }] },
    { id: 'koniec', type: 'QUIZ', prompt: 'Ostatnie pytanie', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
  ];
  const demoCourse = await prisma.course.create({
    data: { title: `Sprawa testowa ${RUN}`, category: 'EMAIL_SECURITY', durationMinutes: 8, contentBlocks: demoBlocks },
  });
  courseIds.push(demoCourse.id);
  const demoVersion = await prisma.courseVersion.create({
    data: { courseId: demoCourse.id, version: 1, schemaVersion: 2, contentHash: hashContent(demoBlocks), contentBlocks: demoBlocks, blockCount: demoBlocks.length },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    const admin = await tx.user.findFirst({ where: { organizationId: org.id, email: EMAIL } });
    await tx.courseAssignment.create({
      data: {
        organizationId: org.id,
        userId: admin.id,
        courseId: demoCourse.id,
        courseVersionId: demoVersion.id,
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        progress: { v: 2, blocks: { wstep: { type: 'QUIZ', done: true, answeredAt: new Date().toISOString(), weight: 1, points: 1, correct: true } }, notes: [] },
      },
    });
  });

  // Cisza WAV (8 s, 8 kHz, mono, 8 bit) zamiast pliku audio.
  const sampleRate = 8000;
  const samples = sampleRate * 8;
  const wav = Buffer.alloc(44 + samples, 0x80);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples, 40);
  await page.route('**/content/audio/demo.mp3', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }));

  const screenshotDir = process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), 'docs', 'brand', 'screens');
  mkdirSync(screenshotDir, { recursive: true });
  const viewports = [['desktop', { width: 1280, height: 800 }], ['mobile-390', { width: 390, height: 844 }]];
  // Dwa stany: blok Z narracją (dłuższy dymek: 3 zdania) i blok BEZ narracji (znika cały rząd odtwarzacza, zostaje nawigacja).
  const shots = [
    { suffix: '', promptText: 'Który adres nadawcy jest podejrzany?', narrated: true },
    { suffix: '-bez-narracji', promptText: 'Co zrobisz z linkiem?', narrated: false },
  ];
  for (const shot of shots) {
    if (!shot.narrated) {
      // Przesuwamy kurs do bloku bez narracji (przypisanie ma FORCE RLS: transakcja z kontekstem organizacji).
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
        await tx.courseAssignment.updateMany({ where: { organizationId: org.id, courseId: demoCourse.id }, data: { currentBlockIndex: 2 } });
      });
    }
    for (const [name, size] of viewports) {
      await page.setViewportSize(size);
      await page.goto(`${WEB}/courses/${demoCourse.id}`);
      await page.getByText(shot.promptText).waitFor();
      if (shot.narrated) await page.getByTestId('caption').waitFor();
      const label = `${name}${shot.suffix}`;
      const narrationRows = await page.locator('section[aria-label="Narracja"]').count();
      step(`odtwarzacz (${label}): ${shot.narrated ? 'rząd narracji jest' : 'rząd narracji znika, zostaje nawigacja'}`, shot.narrated ? narrationRows === 1 : narrationRows === 0);
      // Bez poziomego przewijania strony (telefon): szerokość dokumentu nie przekracza okna.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // Przy nadmiarze wskazujemy elementy wystające poza okno (diagnostyka).
      const offenders = overflow > 0
        ? await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
              .slice(0, 6)
              .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`),
          )
        : [];
      step(`odtwarzacz (${label}): brak poziomego przewijania`, overflow <= 0, `nadmiar ${overflow}px ${offenders.join(' | ')}`);
      // Dolny pasek na telefonie nie może zajmować więcej niż ok. jednej czwartej ekranu (cel: dwa rzędy).
      const barHeight = await page.evaluate(() => document.querySelector('nav[aria-label="Nawigacja po blokach"]')?.closest('.sticky')?.getBoundingClientRect().height ?? 0);
      if (name === 'mobile-390') step(`odtwarzacz (${label}): dolny pasek <= 30% wysokości ekranu`, barHeight <= size.height * 0.3, `${Math.round(barHeight)} px z ${size.height}`);
      const file = join(screenshotDir, `player-${name}${shot.suffix}.png`);
      await page.screenshot({ path: file });
      step(`odtwarzacz (${label}): zrzut ekranu zapisany`, true, file);
    }
  }

  // 13. Śledztwo (schemaVersion 3): hotspoty z dowodami, dialog po jednej kwestii, rozwiązanie sprawy. Cała ścieżka idzie przez prawdziwe API
  // (ocena i liczniki dowodów po stronie serwera). Ilustracje to proste SVG serwowane przez page.route pod ścieżką z CONTENT_BASE (tylko <img>).
  const caseBlocks = [
    {
      id: 'scena',
      type: 'SCENE_HOTSPOTS',
      title: 'Biuro',
      image: 'scenes/office.svg',
      imageAlt: 'Biurko z monitorem, drzwi i kubek',
      hotspots: [
        { id: 'monitor', label: 'Monitor', x: 8, y: 12, width: 26, height: 30, content: 'Na monitorze przyklejona kartka z hasłem do systemu księgowego.', required: true, evidence: true, note: { text: 'Hasło na kartce przy monitorze.', kind: 'item' } },
        { id: 'drzwi', label: 'Drzwi', x: 62, y: 20, width: 20, height: 55, content: 'Drzwi do biura nie były zamknięte na klucz.', required: true, evidence: true, note: { text: 'Drzwi biura niezamknięte.', kind: 'place' } },
        { id: 'kubek', label: 'Kubek', x: 40, y: 58, width: 12, height: 14, content: 'Zwykły kubek z logo firmy. Nic podejrzanego.', required: false, evidence: true, note: { text: 'Kubek z logo firmy.', kind: 'item' } },
      ],
    },
    {
      id: 'rozmowa',
      type: 'DIALOGUE',
      title: 'Rozmowa z Anną',
      character: { name: 'Anna Kowalska', role: 'Księgowa', avatar: 'img/anna.svg' },
      questions: [
        {
          id: 'mail',
          text: 'Skąd był ten mail?',
          lines: [{ text: 'Przyszedł dziś rano, podpisany jako bank.' }, { text: 'Prosił o pilne potwierdzenie danych logowania.' }, { text: 'Kliknęłam w link, zanim to sprawdziłam.' }],
          note: { text: 'Pracownica kliknęła link z maila.', kind: 'person' },
          evidence: true,
          required: true,
        },
        { id: 'nadawca', text: 'Znasz tego nadawcę?', answer: 'Nie, ale adres wyglądał znajomo.', required: false },
      ],
    },
    { id: 'wnioski', type: 'SUMMARY', title: 'Rozwiązanie sprawy', text: 'Do incydentu doszło przez słabe nawyki: hasło na kartce i pochopne kliknięcie w link.' },
  ];
  const caseCourse = await prisma.course.create({
    data: { title: `Śledztwo ${RUN}`, category: 'EMAIL_SECURITY', durationMinutes: 6, contentBlocks: caseBlocks },
  });
  courseIds.push(caseCourse.id);
  const caseVersion = await prisma.courseVersion.create({
    data: { courseId: caseCourse.id, version: 1, schemaVersion: 3, contentHash: hashContent(caseBlocks), contentBlocks: caseBlocks, blockCount: caseBlocks.length },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    const admin = await tx.user.findFirst({ where: { organizationId: org.id, email: EMAIL } });
    await tx.courseAssignment.create({
      data: { organizationId: org.id, userId: admin.id, courseId: caseCourse.id, courseVersionId: caseVersion.id, status: 'IN_PROGRESS', currentBlockIndex: 0 },
    });
  });
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">${body}</svg>`;
  const office = svg('<rect width="400" height="240" fill="#e8ecf4"/><rect x="30" y="30" width="105" height="70" rx="6" fill="#2d3a55"/><rect x="40" y="40" width="85" height="50" fill="#9fb8e8"/><rect x="250" y="50" width="80" height="130" fill="#b58b5c"/><rect x="160" y="140" width="48" height="34" rx="6" fill="#fff" stroke="#6C5CE7" stroke-width="3"/><rect x="0" y="190" width="400" height="50" fill="#c9d1e0"/>');
  const annaAvatar = svg('<rect width="400" height="240" fill="#6C5CE7"/><circle cx="200" cy="105" r="58" fill="#f3d6b5"/><path d="M110 240 Q200 130 290 240Z" fill="#2d3a55"/>');
  await page.route('**/content/scenes/office.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: office }));
  await page.route('**/content/img/anna.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: annaAvatar }));

  const noHScroll = async (label) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    step(`śledztwo (${label}): brak poziomego przewijania`, overflow <= 0, `nadmiar ${overflow}px`);
  };
  const shoot = async (name) => {
    // Playwright przewija stronę do klikanego elementu; zrzut zawsze od góry, żeby pokazywał nagłówek z licznikiem.
    await page.evaluate(() => window.scrollTo(0, 0));
    const file = join(screenshotDir, `sledztwo-${name}.png`);
    await page.screenshot({ path: file });
    step(`śledztwo: zrzut ${name}`, true, file);
  };
  const counter = () => page.getByTestId('evidence-counter');

  // Wyższe okno desktopowe (1280x1100), żeby scena z obrazem, licznik i karta punktu mieściły się na jednym zrzucie.
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`${WEB}/courses/${caseCourse.id}`);
  await page.getByRole('list', { name: 'Elementy sceny' }).waitFor();
  step('śledztwo: licznik startuje z serwera (Dowody 0/4)', (await counter().textContent())?.includes('Dowody 0/4') === true, await counter().textContent());
  step('śledztwo: puls-podpowiedź na punktach przed pierwszym kliknięciem', (await page.getByTestId('hotspot-overlay-monitor').getAttribute('data-state')) === 'hint');
  await shoot('hotspoty-przed');

  // Punkt z obrazu (mysz) i z listy (klawiatura/czytnik); dowód dodaje "Dodaj do notatnika".
  await page.getByTestId('hotspot-overlay-drzwi').click();
  await page.getByRole('button', { name: 'Dodaj do notatnika' }).click();
  await page.getByRole('list', { name: 'Elementy sceny' }).getByRole('button', { name: 'Monitor' }).click();
  await page.getByRole('button', { name: 'Dodaj do notatnika' }).click();
  step('śledztwo: dowody z hotspotów podbijają licznik od razu (Dowody 2/4) i maskotka się cieszy', (await counter().textContent())?.includes('Dowody 2/4') === true && (await page.getByAltText('Maskotka Unfooly się cieszy').count()) === 1, await counter().textContent());
  step('śledztwo: odkryte punkty mają znacznik, nieodkryty (opcjonalny kubek) nie', (await page.getByTestId('hotspot-overlay-monitor').getAttribute('data-state')) === 'discovered' && (await page.getByTestId('hotspot-overlay-kubek').getAttribute('data-state')) === 'hidden');
  await shoot('hotspoty-po');
  await noHScroll('desktop, hotspoty');

  await page.getByRole('button', { name: 'Kontynuuj' }).click();
  await page.getByText('Blok ukończony.').waitFor();
  step('śledztwo: po zapisie licznik z serwera nadal 2/4 (bez podwójnego liczenia)', (await counter().textContent())?.includes('Dowody 2/4') === true, await counter().textContent());
  // Po wyniku bloku są dwa "Dalej": nieaktywny w powłoce i aktywny pod wynikiem; klikamy aktywny (bez polegania na kolejności w DOM).
  await page.getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled')).click();

  await page.getByRole('list', { name: 'Pytania do zadania' }).waitFor();
  await page.getByRole('button', { name: 'Skąd był ten mail?' }).click();
  step('śledztwo: dialog pokazuje pierwszą kwestię, nie całość', (await page.getByText('Przyszedł dziś rano, podpisany jako bank.').count()) === 1 && (await page.getByText('Kliknęłam w link, zanim to sprawdziłam.').count()) === 0);
  step('śledztwo: avatar rozmówcy ładuje się przez <img>', (await page.locator('img[src$="/content/img/anna.svg"]').count()) === 1);
  await shoot('dialog-w-trakcie');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHScroll('telefon, dialog');
  await shoot('dialog-w-trakcie-390');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Następna kwestia' }).click();
  await page.getByRole('button', { name: 'Następna kwestia' }).click();
  step('śledztwo: po ostatniej kwestii dowód (Dowody 3/4)', (await counter().textContent())?.includes('Dowody 3/4') === true, await counter().textContent());
  await page.getByRole('button', { name: 'Kontynuuj' }).click();
  await page.getByText('Blok ukończony.').waitFor();
  // Po wyniku bloku są dwa "Dalej": nieaktywny w powłoce i aktywny pod wynikiem; klikamy aktywny (bez polegania na kolejności w DOM).
  await page.getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled')).click();

  await page.getByTestId('case-evidence').waitFor();
  const caseText = (await page.getByTestId('case-evidence').textContent()) ?? '';
  step('śledztwo: rozwiązanie sprawy: 3 z 4 dowodów, przeoczony 1 tylko liczbowo (bez treści)', caseText.includes('Zebrane dowody: 3 z 4') && caseText.includes('1 dowód w tej scenie pozostał nieodkryty') && !caseText.includes('Kubek'), caseText.slice(0, 160));
  await shoot('rozwiazanie-sprawy');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHScroll('telefon, rozwiązanie sprawy');
  await shoot('rozwiazanie-sprawy-390');
  await page.setViewportSize({ width: 1280, height: 800 });
  // Odpowiedź /progress na "Zakończ sprawę" musi mieć status COMPLETED (kurs ukończony po stronie serwera), nie tylko zmianę ekranu.
  const completion = page.waitForResponse((r) => r.url().includes(`/api/courses/${caseCourse.id}/progress`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Zakończ sprawę' }).click();
  const completionBody = await (await completion).json();
  step('śledztwo: "Zakończ sprawę" kończy kurs po stronie serwera (status COMPLETED)', completionBody.status === 'COMPLETED', JSON.stringify({ status: completionBody.status, evidence: completionBody.evidence?.collected }));

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
