// E2E w przeglądarce (Playwright) - pełne przejście modułu 3 („Komunikatory i SMS-y”, slug `lancuszek`, tryb prosty D-132) zaimportowanego
// PRAWDZIWYM CLI, na wzór scripts/e2e-module-04.mjs (org i pracownik przez Prisma, `next dev`, sprzątanie tylko kursu stworzonego przez ten
// przebieg). Cel - przebieg według nagrania właściciela „Usługi przesyłania wiadomości” (D-203): ekran startu (D-163), po kolei bloki z
// module.json - ekrany NARRATIVE z ilustracją (D-200), rozmowa w komunikatorze i SMS (po 4 cele), pytania w monitorze z ilustracją
// (najpierw zła odpowiedź - „Nie tym razem” i zdanie z treści, potem dobra; wielokrotny wybór przez „Sprawdź”), a po ostatnim pytaniu - bez
// ekranu raportu (D-169) - ekran końca (D-165) z trzema zasadami na wynos. Bez błędów strony, konsoli i 5xx, a w odpowiedziach API nigdy
// pola `correct`.
//
// Grafiki modułu 3 są wyłącznie na R2 (pipeline treści), więc web musi dostać CONTENT_BASE_URL.
// Użycie z katalogu repo:
//   CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/e2e-module-03.mjs
// Opcjonalnie: E2E_VIEWPORT=390x844 (telefon w pionie, dotyk) zamiast domyślnego 1366x768; E2E_SHOTS_DIR=<katalog> - zrzuty ekranu
// kluczowych momentów do przeglądu graficznego; E2E_WEB_MODE=start - web z buildu produkcyjnego (D-142).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { launchPolishBrowser } from './lib/pl-browser.mjs';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { assertLocalDatabase } from './lib/local-db-guard.mjs';
import { checkEndScreen, completionResponse, passStartScreen } from './lib/module-screens.mjs';

// Skrypt tworzy i usuwa dane - tylko baza lokalna albo kontener testowy CI (B-140).
assertLocalDatabase('scripts/e2e-module-03.mjs');

const SLUG = 'lancuszek';
const MODULE = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', SLUG, 'module.json'), 'utf8'));
const text = (value) => (typeof value === 'string' ? value : value?.pl);
const MODULE_TITLE = text(MODULE.title);
// Etykieta z treści jako początek nazwy przycisku (znaki specjalne wyrażeń regularnych dosłownie).
const startsWith = (label) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const [VW, VH] = (process.env.E2E_VIEWPORT ?? '1366x768').split('x').map(Number);
if (![VW, VH].every((n) => Number.isInteger(n) && n > 0)) throw new Error(`E2E_VIEWPORT: oczekiwano <szer>x<wys>, jest "${process.env.E2E_VIEWPORT}"`);
const WEB_MODE = process.env.E2E_WEB_MODE ?? 'dev';
if (!['dev', 'start'].includes(WEB_MODE)) throw new Error(`E2E_WEB_MODE: dev albo start, jest "${WEB_MODE}"`);
const MOBILE = VW < 768;
const SHOTS_DIR = process.env.E2E_SHOTS_DIR;
const DOMAIN = `module-03-e2e-${RUN}.test`;
const EMAIL = `pracownik@${DOMAIN}`;
const PASSWORD = 'E2e-Haslo-Testowe-1!';

const children = [];
let log = '';
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

function start(command, args, env, cwd) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, shell: false });
  children.push(child);
  child.stdout.on('data', (chunk) => (log += chunk.toString()));
  child.stderr.on('data', (chunk) => (log += chunk.toString()));
}

let prisma;
let browser;
let page;
let orgId;
let courseId;
let courseCreatedByThisRun = false;
try {
  if (!process.env.CONTENT_BASE_URL) throw new Error('Brak CONTENT_BASE_URL - grafiki modułu 3 są tylko na R2.');
  start(process.execPath, ['apps/api/dist/main.js'], { PORT: API_PORT, FRONTEND_URL: WEB, MAILERSEND_API_TOKEN: '', BACKGROUND_JOBS_ENABLED: 'false', NODE_ENV: 'development' }, process.cwd());
  start(process.execPath, [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), WEB_MODE, '-p', WEB_PORT], { API_URL: API }, join(process.cwd(), 'apps', 'web'));
  await waitFor(async () => (await fetch(`${API}/`)).status > 0, 'start API');
  await waitFor(async () => (await fetch(`${WEB}/`)).ok, 'start web');

  const contentImport = await import('../apps/api/dist/scripts/content-import.js');
  prisma = new PrismaClient();
  const modules = await contentImport.loadModules(join(process.cwd(), 'packages', 'content', 'modules'));
  const loaded = modules.find((m) => m.slug === SLUG);
  step(`content-import: moduł "${SLUG}" wczytany i zwalidowany`, !!loaded);
  const importResult = await prisma.$transaction((tx) => contentImport.importModule(tx, loaded));
  step('content-import: moduł zaimportowany do bazy', importResult.courseId != null && importResult.slug === SLUG, JSON.stringify(importResult));
  courseId = importResult.courseId;
  courseCreatedByThisRun = importResult.courseCreated;

  const org = await prisma.organization.create({ data: { name: `Module 03 E2E ${RUN}`, status: 'ACTIVE' } });
  orgId = org.id;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    return tx.user.create({ data: { organizationId: org.id, email: EMAIL, passwordHash, role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    await tx.courseAssignment.create({ data: { organizationId: org.id, userId: user.id, courseId } });
  });
  step('organizacja ACTIVE i pracownik z przypisanym kursem', true);

  browser = await launchPolishBrowser(chromium);
  page = await (await browser.newContext({ viewport: { width: VW, height: VH }, isMobile: MOBILE, hasTouch: MOBILE })).newPage();
  const shot = async (name) => {
    if (!SHOTS_DIR) return;
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS_DIR, `${VW}x${VH}-${name}.png`) });
  };
  const problems = [];
  const leaks = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`);
  });
  // Klucz odpowiedzi nigdy w odpowiedziach `/api` (w praktyce `/check`); `/progress` pomijamy (jego `lastResult.correct` to ocena wysłanej
  // odpowiedzi). Treść bloków przychodzi w HTML/RSC strony - tę pilnują classification.spec.ts i e2e API.
  page.on('response', async (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
    const url = response.url();
    if (url.includes(`/api/courses/${courseId}`) && !url.endsWith('/progress') && (response.headers()['content-type'] ?? '').includes('json')) {
      const text = await response.text().catch(() => '');
      if (/"correct"\s*:/.test(text)) leaks.push(response.url());
    }
  });

  await page.goto(`${WEB}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/courses');
  step('logowanie pracownika kieruje na /courses', true);
  await page.getByText(MODULE_TITLE, { exact: true }).first().waitFor();
  step(`Katalog: karta i miniatura „${MODULE_TITLE}”`, (await page.getByRole('img', { name: MODULE_TITLE, exact: true }).count()) >= 1);

  await page.goto(`${WEB}/courses/${courseId}`);
  await passStartScreen(page, step, { title: MODULE_TITLE, caseNumber: MODULE.caseNumber, notice: MODULE.startNotice && text(MODULE.startNotice) });
  await shot('0-start');

  const bar = () => page.getByTestId('player-bottombar');
  const nextEnabled = () => bar().getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled'));
  const nextDisabled = async () => (await bar().getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':disabled')).count()) === 1;
  const progressResponse = () => page.waitForResponse((r) => r.url().includes(`/api/courses/${courseId}/progress`) && r.request().method() === 'POST');
  const dialog = () => page.getByRole('dialog');
  const closed = () => page.getByTestId('scene-zoom').waitFor({ state: 'detached' });
  const feedback = () => page.getByTestId('simple-feedback');
  const feedbackIs = async (result) => {
    await page.locator(`[data-testid="simple-feedback"][data-result="${result}"]`).waitFor({ timeout: 15000 });
    return ((await feedback().textContent()) ?? '').trim();
  };
  const goNext = async () => {
    const saved = progressResponse();
    await nextEnabled().click();
    step('„Dalej” zapisuje blok', (await saved).ok());
  };
  const imageLoaded = (locator) =>
    locator.evaluate((img) => (img.complete ? img.naturalWidth > 0 : new Promise((resolve) => {
      img.addEventListener('load', () => resolve(img.naturalWidth > 0));
      img.addEventListener('error', () => resolve(false));
    })));

  // Ostatnie pytanie zapisuje „Dalej”, a zaraz po nim odtwarzacz sam zapisuje raport (SUMMARY bez ekranu, D-169) - ten zapis kończy kurs.
  const completion = completionResponse(page, courseId, 600000);
  // Ilustracja obok tekstu i pytania (D-200): wczytana, z opisem z treści.
  const illustrationOk = async (block) => {
    const img = page.locator(`[data-testid="illustration"][alt="${block.illustration.alt}"]`);
    await img.first().waitFor();
    return imageLoaded(img.first());
  };

  // --- Ekrany według nagrania właściciela (D-203): po kolei bloki modułu ---------------------------------------------------------------
  for (const block of MODULE.blocks) {
    if (block.type === 'SUMMARY') break;
    if (block.type === 'NARRATIVE') {
      await page.getByText(block.title, { exact: true }).first().waitFor();
      step(`NARRATIVE ${block.id}: tytuł „${block.title}” i ilustracja załadowana`, await illustrationOk(block));
      await nextEnabled().waitFor();
      await shot(`ekran-${block.id}`);
      await goNext();
      continue;
    }
    if (block.type === 'QUIZ') {
      const multi = block.multiple === true;
      await page.getByTestId(multi ? 'simple-multi-choice' : 'simple-choice').waitFor();
      step(`QUIZ ${block.id}: polecenie, ilustracja na ekranie monitora, „Dalej” nieaktywny`, (await page.getByText(block.prompt, { exact: true }).count()) === 1 && (await illustrationOk(block)) && (await nextDisabled()));
      const wrong = block.options.find((option) => !option.correct);
      const rights = block.options.filter((option) => option.correct);
      const option = (o) => page.getByTestId(multi ? 'simple-multi-option' : 'simple-option').filter({ hasText: o.text });
      await option(wrong).click();
      if (multi) await page.getByTestId('simple-multi-check').click();
      const bad = await feedbackIs('bad');
      // Zdanie z treści: przy pojedynczym wyborze w ogólnym komunikacie, przy wielokrotnym - przy zaznaczonej odpowiedzi.
      const badSentence = multi ? ((await option(wrong).getByTestId('simple-multi-feedback').textContent()) ?? '') : bad;
      step(`QUIZ ${block.id}: zła odpowiedź - „Nie tym razem” i zdanie z treści`, bad.startsWith('Nie tym razem') && badSentence.includes(wrong.feedback), `${bad} | ${badSentence}`);
      await shot(`pytanie-${block.id}-zle`);
      if (multi) {
        await option(wrong).click();
        for (const right of rights) await option(right).click();
        await page.getByTestId('simple-multi-check').click();
      } else {
        await option(rights[0]).click();
      }
      const good = await feedbackIs('good');
      const goodSentence = multi ? ((await option(rights[0]).getByTestId('simple-multi-feedback').textContent()) ?? '') : good;
      step(`QUIZ ${block.id}: dobra odpowiedź - „Dobrze” i zdanie z treści`, good.startsWith('Dobrze') && goodSentence.includes(rights[0].feedback), `${good} | ${goodSentence}`);
      await goNext();
      continue;
    }
    // Nowy typ bloku w module - jawny błąd zamiast mylącego timeoutu w gałęzi sceny.
    if (block.type !== 'SCENE_HOTSPOTS') throw new Error(`e2e-module-03: nieobsługiwany typ bloku ${block.type} (${block.id})`);
    // Rozmowa w komunikatorze i SMS (SCENE_HOTSPOTS, po 4 cele-dowody na ekranie telefonu).
    const cardCheck = /złośliwy program|smishing/;
    const id = block.id;
    await page.getByRole('button', { name: startsWith(block.hotspots[0].label) }).waitFor();
    step(`SCENE_HOTSPOTS ${id}: polecenie trybu prostego i „Dalej” nieaktywny przed celami`, (await page.getByText(block.tip).count()) >= 1 && (await nextDisabled()));
    const scene = page.locator(`img[alt="${block.imageAlt}"]`);
    step(`SCENE_HOTSPOTS ${id}: grafika sceny załadowana`, await imageLoaded(scene.first()));
    // Zrzut stanu przed interakcją: kursor poza sceną (bez :hover), przedmioty bez widocznej ramki (D-154).
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(150); // przejście koloru ramki trwa 100 ms
    const framed = await page.evaluate(() =>
      [...document.querySelectorAll('.scene-hotspot')].filter((el) => !['ready', 'blocked'].includes(el.dataset.state)).filter((el) => {
        const { borderTopColor, backgroundColor } = getComputedStyle(el);
        return ![borderTopColor, backgroundColor].every((c) => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c));
      }).length,
    );
    step(`SCENE_HOTSPOTS ${id}: przed interakcją żaden cel nie ma widocznej ramki`, framed === 0, `${framed}`);
    await shot(`2-scena-${id}`);
    for (const hotspot of block.hotspots) {
      await page.getByRole('button', { name: startsWith(hotspot.label) }).click();
      await dialog().getByText(hotspot.content).waitFor();
      if (cardCheck.test(hotspot.content)) {
        step(`SCENE_HOTSPOTS ${id}: karta „${hotspot.label}” z treścią ze scenariusza`, true);
        await shot(`3-karta-${id}-${hotspot.id}`);
      }
      await dialog().getByRole('button', { name: 'Zamknij' }).click();
      await closed();
    }
    // Bez notatnika i licznika dowodów (D-162): po wszystkich celach „Dalej” w pasku jest aktywny.
    await nextEnabled().waitFor({ timeout: 15000 });
    step(`SCENE_HOTSPOTS ${id}: po ${block.hotspots.length} celach „Dalej” aktywny`, true);
    await goNext();
  }

  // --- Raport (SUMMARY) bez ekranu - zapisuje się sam (D-169), potem ekran końca (D-165) z trzema zasadami na wynos ---------------
  const finishedBody = await (await completion).json();
  step('Zakończenie: kurs ukończony (status COMPLETED) bez ekranu raportu', finishedBody.status === 'COMPLETED', JSON.stringify({ status: finishedBody.status, score: finishedBody.score }));
  const rules = [
    'Plik albo aplikacja od nieznajomego? Nie otwieraj – zapytaj IT.',
    'Dziwna wiadomość od znajomego? Sprawdź ją innym kanałem.',
    'SMS z linkiem i pośpiechem? Nie klikaj i nie odpisuj.',
  ];
  await checkEndScreen(page, step, { completion: finishedBody, rules });
  await shot('7-koniec');
  step('Klucz odpowiedzi (`correct`) nigdy w odpowiedziach /check', leaks.length === 0, leaks.join(' | '));
  step('Bez błędów strony, konsoli i odpowiedzi 5xx', problems.length === 0, problems.join(' | '));

  console.log(`\nWSZYSTKIE KROKI OK (${results.length})`);
} catch (error) {
  console.error(`\nBŁĄD: ${error.message}`);
  if (page) {
    console.error('--- URL w chwili błędu ---', page.url());
    if (SHOTS_DIR) await page.screenshot({ path: join(SHOTS_DIR, `${VW}x${VH}-blad.png`) }).catch(() => {});
    console.error('--- treść strony (pierwsze 2000 znaków) ---\n' + (await page.locator('body').innerText().catch(() => '(brak)')).slice(0, 2000));
  }
  console.error('--- ostatnie logi API/web ---\n' + log.split('\n').slice(-40).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  try {
    prisma ??= new PrismaClient();
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    if (courseId && courseCreatedByThisRun) await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  } catch (error) {
    console.error('Sprzątanie nie powiodło się:', error.message);
  }
}
