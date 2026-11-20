// E2E w przeglądarce (Playwright) - pełne przejście modułu 4 („Shadow IT”, do D-172 „Na skróty”; packages/content/modules/na-skroty, shadow IT, tryb prosty
// D-132) zaimportowanego PRAWDZIWYM CLI, na wzór scripts/e2e-module-03.mjs (org i pracownik przez Prisma, `next dev`, sprzątanie tylko
// kursu stworzonego przez ten przebieg). Cel: odprawa (statyczna scena - laptop z raportem na jutro), biurko Bartka (4 narzędzia-dowody),
// tablica skutków (4 karty-dowody), sortowanie 6 sytuacji z werdyktami „Zapytaj IT” / „Bezpieczne” (D-151; 1 gestem, reszta
// przyciskami), dwa wybory z natychmiastową oceną (najpierw zła odpowiedź - „Nie tym razem”, potem dobra), a po nich - bez ekranu
// raportu (D-169) - ekran końca (D-165) z trzema zasadami na wynos; przed odprawą ekran startu (D-163). Bez błędów strony, konsoli i
// 5xx, a w odpowiedziach API nigdy pola `correct`.
//
// Nagrania i grafiki modułu 4 są wyłącznie na R2 (pipeline treści), więc web musi dostać CONTENT_BASE_URL.
// Użycie z katalogu repo:
//   CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/e2e-module-04.mjs
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
assertLocalDatabase('scripts/e2e-module-04.mjs');

const SLUG = 'na-skroty';
const MODULE = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', SLUG, 'module.json'), 'utf8'));
const text = (value) => (typeof value === 'string' ? value : value?.pl);
const MODULE_TITLE = text(MODULE.title);
const blockOf = (id) => MODULE.blocks.find((block) => block.id === id);
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
const DOMAIN = `module-04-e2e-${RUN}.test`;
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
  if (!process.env.CONTENT_BASE_URL) throw new Error('Brak CONTENT_BASE_URL - nagrania i grafiki modułu 4 są tylko na R2.');
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

  const org = await prisma.organization.create({ data: { name: `Module 04 E2E ${RUN}`, status: 'ACTIVE' } });
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

  // --- 1. Odprawa (BRIEFING: jedna statyczna scena - laptop z „Raport na jutro, 9:00”; dalej „Dalej” w pasku, D-106) -------------
  const briefingScene = page.locator('img[alt*="Raport na jutro, 9:00"]');
  await briefingScene.first().waitFor();
  await page.getByTestId('briefing-scene-text').filter({ hasText: /Bartek Lis z marketingu/ }).waitFor();
  step('BRIEFING: odprawa - scena z laptopem (grafika z opisem alt załadowana) i tekst narracji', await imageLoaded(briefingScene.first()));
  step('BRIEFING: scena bez klikalnego przedmiotu (bez hotspotu)', (await page.getByTestId('briefing-hotspot').count()) === 0);
  await nextEnabled().waitFor();
  await page.locator('.briefing-caret').waitFor({ state: 'detached', timeout: 60000 });
  const typed = await page.getByTestId('briefing-scene-text').evaluate((frame) => {
    const box = frame.getBoundingClientRect();
    const visible = [...frame.querySelectorAll('p')].find((p) => !p.classList.contains('invisible'))?.textContent ?? '';
    return { visible, overflow: frame.scrollHeight - frame.clientHeight, inView: box.top >= 0 && box.bottom <= window.innerHeight, pageScroll: document.documentElement.scrollHeight - window.innerHeight };
  });
  step(
    'BRIEFING: po zakończeniu pisania pełny tekst w ramce, bez przewijania, w ekranie',
    typed.visible.includes('shadow IT') && typed.overflow <= 1 && typed.inView && typed.pageScroll <= 1,
    JSON.stringify({ ...typed, visible: `${typed.visible.length} znaków` }),
  );
  await shot('1-odprawa');
  await goNext();

  // --- 2-3. Biurko Bartka i tablica skutków (SCENE_HOTSPOTS, po 4 cele-dowody; „Zabierz” dopisuje notatkę) -------------------------
  for (const [id, cardCheck] of [['biurko', /serwerach obcej firmy/], ['skutki', /UODO w ciągu 72 godzin/]]) {
    const block = blockOf(id);
    await page.getByRole('button', { name: startsWith(block.hotspots[0].label) }).waitFor();
    step(`SCENE_HOTSPOTS ${id}: polecenie trybu prostego i „Dalej” nieaktywny przed celami`, (await page.getByText(block.tip).count()) >= 1 && (await nextDisabled()));
    const scene = page.locator(`img[alt="${block.imageAlt}"]`);
    step(`SCENE_HOTSPOTS ${id}: grafika sceny załadowana`, await imageLoaded(scene.first()));
    // Zrzut stanu przed interakcją: kursor poza sceną (bez :hover), przedmioty bez widocznej ramki (D-154).
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(150); // przejście koloru ramki trwa 100 ms
    const framed = await page.evaluate(() =>
      // Drzwi (ready/blocked) są zawsze widoczne - wyjście ze sceny, nie odpowiedź (D-129), jak w m13 w layout-check.
      [...document.querySelectorAll('.scene-hotspot')].filter((el) => !['ready', 'blocked'].includes(el.dataset.state)).filter((el) => {
        const { borderTopColor, backgroundColor } = getComputedStyle(el);
        return ![borderTopColor, backgroundColor].every((c) => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c));
      }).length,
    );
    step(`SCENE_HOTSPOTS ${id}: przed interakcją żaden przedmiot nie ma widocznej ramki`, framed === 0, `${framed}`);
    await shot(`2-scena-${id}`);
    for (const hotspot of block.hotspots) {
      await page.getByRole('button', { name: startsWith(hotspot.label) }).click();
      await dialog().getByText(hotspot.content).waitFor();
      if (cardCheck.test(hotspot.content)) {
        step(`SCENE_HOTSPOTS ${id}: karta „${hotspot.label}” z treścią ze scenariusza`, true);
        await shot(`3-karta-${id}`);
      }
      await dialog().getByRole('button', { name: 'Zamknij' }).click();
      await closed();
    }
    // Bez notatnika i licznika dowodów (D-162): po wszystkich celach „Dalej” w pasku jest aktywny.
    await nextEnabled().waitFor({ timeout: 15000 });
    step(`SCENE_HOTSPOTS ${id}: po ${block.hotspots.length} celach „Dalej” aktywny`, true);
    await goNext();
  }
  // Ostatni wybór zapisuje „Dalej”, a zaraz po nim odtwarzacz sam zapisuje raport (SUMMARY bez ekranu, D-169) - ten zapis kończy kurs.
  const completion = completionResponse(page, courseId, 600000);

  // --- 4-6. Sytuacje (SWIPE_SORT) i dwa wybory (QUIZ w trybie prostym) --------------------------------------------------------------
  for (const id of ['bezpieczne-czy-it', 'brak-programu', 'juz-wklejone']) {
    const block = blockOf(id);
    if (block.type === 'QUIZ') {
      await page.getByTestId('simple-choice').waitFor();
      step(`QUIZ ${id}: polecenie „${block.prompt}”, „Dalej” nieaktywny`, (await page.getByText(block.prompt, { exact: true }).count()) === 1 && (await nextDisabled()));
      const wrong = block.options.find((option) => !option.correct);
      const right = block.options.find((option) => option.correct);
      await page.getByTestId('simple-option').filter({ hasText: wrong.text }).click();
      const bad = await feedbackIs('bad');
      step(`QUIZ ${id}: zła odpowiedź - „Nie tym razem” i zdanie z treści`, bad.startsWith('Nie tym razem') && bad.includes(wrong.feedback), bad);
      if (id === 'juz-wklejone') await shot('5-wybor-zla-odpowiedz');
      await page.getByTestId('simple-option').filter({ hasText: right.text }).click();
      const good = await feedbackIs('good');
      step(`QUIZ ${id}: dobra odpowiedź - „Dobrze” i zdanie z treści`, good.startsWith('Dobrze') && good.includes(right.feedback), good);
      await goNext();
      continue;
    }

    await page.getByTestId('swipe-sort').waitFor();
    step('SWIPE_SORT: polecenie i „Dalej” nieaktywny przed ocenami', (await page.getByText(block.prompt, { exact: true }).count()) === 1 && (await nextDisabled()));
    const labels = [await page.getByTestId('swipe-suspicious').textContent(), await page.getByTestId('swipe-ok').textContent()].map((t) => (t ?? '').trim());
    step('SWIPE_SORT: własne werdykty z treści (D-151)', labels[0] === block.labels.suspicious && labels[1] === block.labels.ok, labels.join(' | '));
    for (let i = 0; i < block.cards.length; i++) {
      const card = page.getByTestId('swipe-card');
      await card.waitFor();
      const shown = (await card.textContent()) ?? '';
      const expected = block.cards.find((c) => shown.includes(c.text));
      if (!expected) throw new Error(`Nieznana karta: ${shown.slice(0, 80)}`);
      if (i === 0) await shot('4-karta-sytuacji');
      const checked = page.waitForResponse((r) => r.url().includes('/check') && r.request().method() === 'POST');
      if (i === 0) {
        // Gest: przeciągnięcie karty w stronę werdyktu (lewo = zapytaj IT, prawo = bezpieczne).
        const box = await card.boundingBox();
        const dx = expected.correct === 'suspicious' ? -260 : 260;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + dx / 2, box.y + box.height / 2, { steps: 5 });
        await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
      } else {
        await page.getByTestId(expected.correct === 'suspicious' ? 'swipe-suspicious' : 'swipe-ok').click();
      }
      const body = await (await checked).json();
      await page.locator('[data-testid="simple-feedback"][data-result="good"]').filter({ hasText: expected.feedback }).waitFor({ timeout: 15000 });
      const text = ((await feedback().textContent()) ?? '').trim();
      step(`SWIPE_SORT: ${i === 0 ? 'gest' : 'przycisk'} - „${expected.id}” ${expected.correct === 'suspicious' ? 'zapytaj IT' : 'bezpieczne'}: „Dobrze”, bez klucza w odpowiedzi`, text.includes(expected.feedback) && body.result === 'good' && !('correct' in body), text);
      await page.waitForFunction(
        (prev) => !document.querySelector('[data-testid="swipe-card"]') || !document.querySelector('[data-testid="swipe-card"]').textContent.includes(prev),
        expected.text,
        { timeout: 10000 },
      );
    }
    await page.getByText('Wszystkie sytuacje ocenione.').waitFor();
    step('SWIPE_SORT: wszystkie sytuacje ocenione', true);
    await goNext();
  }

  // --- 7. Raport (SUMMARY) bez ekranu - zapisuje się sam (D-169), potem ekran końca (D-165) z trzema zasadami na wynos ---------------
  const finishedBody = await (await completion).json();
  step('Zakończenie: kurs ukończony (status COMPLETED) bez ekranu raportu', finishedBody.status === 'COMPLETED', JSON.stringify({ status: finishedBody.status, score: finishedBody.score }));
  const rules = [
    'Nowy program, strona albo AI do pracy? Najpierw zapytaj IT – pomogą znaleźć bezpieczne narzędzie.',
    'Dane firmy i klientów tylko w firmowych narzędziach – także w AI.',
    'Coś poszło nie tak? Zgłoś od razu. Liczy się czas, nie szukanie winnych.',
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
