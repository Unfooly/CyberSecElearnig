// E2E w przeglądarce (Playwright) - pełne przejście modułu 3 („Łańcuszek”, packages/content/modules/lancuszek, tryb prosty D-132)
// zaimportowanego PRAWDZIWYM CLI, na wzór scripts/e2e-module-02.mjs (org i pracownik przez Prisma, `next dev`, sprzątanie tylko kursu
// stworzonego przez ten przebieg). Cel: odprawa (statyczna scena z połączeniem od Oli), scena telefonu (3 cele, zbliżenie ekranu
// logowania), trzy wybory z natychmiastową oceną (najpierw zła odpowiedź - komunikat „Nie tym razem”, potem dobra), sortowanie
// 6 wiadomości (5 przyciskami, 1 gestem przeciągnięcia), raport z trzema zasadami i ekran zamknięcia sprawy (zasady w grafice,
// podpis jednym dotknięciem, pieczęć i liścik) - bez błędów strony, konsoli i 5xx, a w odpowiedziach API nigdy pola `correct`.
//
// Nagrania i grafiki modułu 3 są wyłącznie na R2 (pipeline treści), więc web musi dostać CONTENT_BASE_URL.
// Użycie z katalogu repo:
//   CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/e2e-module-03.mjs
// Opcjonalnie: E2E_VIEWPORT=390x844 (telefon w pionie, dotyk) zamiast domyślnego 1366x768; E2E_SHOTS_DIR=<katalog> - zrzuty ekranu
// kluczowych momentów (scena, zbliżenie, wybór z oceną, karta wiadomości, raport) do przeglądu graficznego.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { assertLocalDatabase } from './lib/local-db-guard.mjs';

// Skrypt tworzy i usuwa dane - tylko baza lokalna albo kontener testowy CI (B-140).
assertLocalDatabase('scripts/e2e-module-03.mjs');

const SLUG = 'lancuszek';
const MODULE = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', SLUG, 'module.json'), 'utf8'));
const MODULE_TITLE = typeof MODULE.title === 'string' ? MODULE.title : MODULE.title.pl;
const blockOf = (id) => MODULE.blocks.find((block) => block.id === id);
const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const [VW, VH] = (process.env.E2E_VIEWPORT ?? '1366x768').split('x').map(Number);
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
  if (!process.env.CONTENT_BASE_URL) throw new Error('Brak CONTENT_BASE_URL - nagrania i grafiki modułu 3 są tylko na R2.');
  start(process.execPath, ['apps/api/dist/main.js'], { PORT: API_PORT, FRONTEND_URL: WEB, MAILERSEND_API_TOKEN: '', BACKGROUND_JOBS_ENABLED: 'false', NODE_ENV: 'development' }, process.cwd());
  start(process.execPath, [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', WEB_PORT], { API_URL: API }, join(process.cwd(), 'apps', 'web'));
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

  browser = await chromium.launch();
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
  // Klucz odpowiedzi nigdy w treści bloków ani w `/check` (D-132: `correct` jest sekretem, `/check` zwraca tylko result good/bad).
  // `/progress` pomijamy: jego `lastResult.correct` to ocena odpowiedzi, którą gracz już wysłał, nie klucz.
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
  await page.getByRole('heading', { level: 1, name: MODULE_TITLE, exact: true }).waitFor();
  step('Player: nagłówek z nazwą modułu', true);

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

  // --- 1. Odprawa (BRIEFING: jedna statyczna scena - telefon z połączeniem od Oli; jedyny krok, dalej „Dalej” w pasku, D-106) ----
  const briefingScene = page.locator('img[alt*="połączenie przychodzące - Ola Malec, księgowość"]');
  await briefingScene.first().waitFor();
  await page.getByTestId('briefing-scene-text').filter({ hasText: /Dzwoni Ola Malec z księgowości/ }).waitFor();
  const sceneLoaded = await briefingScene.first().evaluate((img) => (img.complete ? img.naturalWidth > 0 : new Promise((resolve) => {
    img.addEventListener('load', () => resolve(img.naturalWidth > 0));
    img.addEventListener('error', () => resolve(false));
  })));
  step('BRIEFING: odprawa - scena z połączeniem od Oli (grafika z opisem alt załadowana) i tekst narracji', sceneLoaded);
  step('BRIEFING: scena bez klikalnego przedmiotu (bez hotspotu)', (await page.getByTestId('briefing-hotspot').count()) === 0);
  await nextEnabled().waitFor();
  await shot('1-odprawa');
  await goNext();

  // --- 2. Telefon Oli (SCENE_HOTSPOTS, 3 cele, zbliżenie ekranu logowania) -----------------------------------------------------
  await page.getByRole('button', { name: /^Wiadomość od Kasi/ }).waitFor();
  step('SCENE_HOTSPOTS: polecenie trybu prostego (jedno zdanie) i „Dalej” nieaktywny przed celami', (await page.getByText(blockOf('telefon').tip).count()) >= 1 && (await nextDisabled()));
  await shot('2-scena-telefon');
  for (const label of ['Wiadomość od Kasi', 'Link do filmu']) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    if (label === 'Link do filmu') {
      await dialog().getByText(/Kłódka w pasku adresu/).waitFor();
      step('Karta „link”: zdanie o kłódce w pasku adresu', true);
    }
    await dialog().getByRole('button', { name: 'Zabierz' }).click();
    await closed();
  }
  await page.getByRole('button', { name: /^Ponaglenie do logowania/ }).click();
  const login = dialog().getByRole('img', { name: /Strona wideo-kasi\.test\/login/ });
  await login.waitFor();
  step('Zbliżenie: ekran logowania bez marki (grafika z opisem alt załadowana)', await login.evaluate((img) => img.complete && img.naturalWidth > 0));
  await shot('3-zblizenie-logowanie');
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  await closed();
  await page.waitForFunction(() => document.querySelector('[data-testid="evidence-counter"]')?.textContent?.includes('3/3'), null, { timeout: 15000 });
  step('SCENE_HOTSPOTS: trzy cele w notatniku (Dowody 3/3)', true);
  await goNext();

  // --- 3-6. Wybory (QUIZ w trybie prostym: zła odpowiedź -> „Nie tym razem”, potem dobra -> „Dobrze” i „Dalej”) i skrzynka (blok 4) -
  for (const id of ['zaloguj', 'wiadomosci', 'blik', 'kod-sms']) {
    const block = blockOf(id);
    // Wznowienie po wyjściu (fix/resume-po-wyjsciu): po 3 blokach X i od razu „Kontynuuj naukę” - BEZ przeładowania strony - wraca na
    // blok, na którym przerwano (skrzynka), a nie na odprawę z pamięci routera klienta.
    if (id === 'wiadomosci') {
      // Żądania RSC strony odtwarzacza w trakcie powrotu: 0 = strona podana z pamięci routera klienta (stary postęp).
      const rsc = [];
      const onRequest = (request) => {
        if (request.headers().rsc === '1' && new URL(request.url()).pathname === `/courses/${courseId}`) rsc.push(request.url());
      };
      page.on('request', onRequest);
      await page.getByRole('link', { name: 'Zakończ i wróć do listy kursów' }).click();
      await page.waitForURL((url) => url.pathname === '/courses');
      await page.getByRole('link', { name: 'Kontynuuj naukę' }).click();
      await page.waitForURL((url) => url.pathname === `/courses/${courseId}`);
      await page.getByRole('heading', { level: 1, name: MODULE_TITLE, exact: true }).waitFor();
      const resumed = await page.getByText(block.prompt, { exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false);
      page.off('request', onRequest);
      step(
        'Wznowienie: X i od razu „Kontynuuj naukę” (bez przeładowania) - skrzynka, blok 4 z 7, nie odprawa',
        resumed && (await page.getByTestId('briefing-scene-text').count()) === 0,
        `żądania RSC odtwarzacza: ${rsc.length}`,
      );
    }
    // „Wstecz” przeglądarki po kolejnym zapisie (D-142): wpis historii odtwarzacza ma drzewo z wejścia na skrzynkę, a postęp poszedł
    // dalej - odtwarzacz z pamięci routera pobiera świeży postęp i pokazuje BLIK, nie skrzynkę.
    if (id === 'blik') {
      await page.getByRole('link', { name: 'Zakończ i wróć do listy kursów' }).click();
      await page.waitForURL((url) => url.pathname === '/courses');
      await page.goBack();
      await page.waitForURL((url) => url.pathname === `/courses/${courseId}`);
      const back = await page.getByText(block.prompt, { exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false);
      step('Wznowienie: X i „Wstecz” przeglądarki po kolejnym bloku - BLIK, blok 5 z 7, nie skrzynka', back && (await page.getByTestId('swipe-card').count()) === 0);
    }
    if (block.type === 'QUIZ') {
      await page.getByTestId('simple-choice').waitFor();
      step(`QUIZ ${id}: polecenie „${block.prompt}”, „Dalej” nieaktywny`, (await page.getByText(block.prompt, { exact: true }).count()) === 1 && (await nextDisabled()));
      const wrong = block.options.find((option) => !option.correct);
      const right = block.options.find((option) => option.correct);
      await page.getByTestId('simple-option').filter({ hasText: wrong.text }).click();
      const bad = await feedbackIs('bad');
      step(`QUIZ ${id}: zła odpowiedź - „Nie tym razem” i zdanie z treści`, bad.startsWith('Nie tym razem') && bad.includes(wrong.feedback), bad);
      if (id === 'zaloguj') await shot('4-wybor-zla-odpowiedz');
      await page.getByTestId('simple-option').filter({ hasText: right.text }).click();
      const good = await feedbackIs('good');
      step(`QUIZ ${id}: dobra odpowiedź - „Dobrze” i zdanie z treści`, good.startsWith('Dobrze') && good.includes(right.feedback), good);
      if (id === 'zaloguj') await shot('5-wybor-dobra-odpowiedz');
      await goNext();
      continue;
    }

    // --- 4. Skrzynka Oli (SWIPE_SORT, 6 kart w kolejności serwera; jedna gestem, reszta przyciskami) ----------------------------
    await page.getByTestId('swipe-sort').waitFor();
    step(`SWIPE_SORT: polecenie i „Dalej” nieaktywny przed ocenami`, (await page.getByText(block.prompt, { exact: true }).count()) === 1 && (await nextDisabled()));
    for (let i = 0; i < block.cards.length; i++) {
      const card = page.getByTestId('swipe-card');
      await card.waitFor();
      const shown = (await card.textContent()) ?? '';
      const expected = block.cards.find((c) => shown.includes(c.text));
      if (!expected) throw new Error(`Nieznana karta: ${shown.slice(0, 80)}`);
      if (i === 0) await shot('6-karta-wiadomosci');
      const checked = page.waitForResponse((r) => r.url().includes('/check') && r.request().method() === 'POST');
      if (i === 0) {
        // Gest: przeciągnięcie karty w stronę werdyktu (lewo = podejrzane, prawo = w porządku).
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
      // Komunikat poprzedniej karty (też „good”) zostaje do odpowiedzi /check - czekamy na komentarz TEJ karty.
      await page.locator('[data-testid="simple-feedback"][data-result="good"]').filter({ hasText: expected.feedback }).waitFor({ timeout: 15000 });
      const text = ((await feedback().textContent()) ?? '').trim();
      step(`SWIPE_SORT: ${i === 0 ? 'gest' : 'przycisk'} - „${expected.from}” ${expected.correct === 'suspicious' ? 'podejrzana' : 'w porządku'}: „Dobrze”, bez klucza w odpowiedzi`, text.includes(expected.feedback) && body.result === 'good' && !('correct' in body), text);
      await page.waitForFunction(
        (prev) => !document.querySelector('[data-testid="swipe-card"]') || !document.querySelector('[data-testid="swipe-card"]').textContent.includes(prev),
        expected.text,
        { timeout: 10000 },
      );
    }
    await page.getByText('Wszystkie wiadomości ocenione.').waitFor();
    step('SWIPE_SORT: wszystkie wiadomości ocenione', true);
    await goNext();
  }

  // --- 7. Raport (SUMMARY z trzema zasadami jako lista w tekście), potem ekran zamknięcia sprawy (jak w module 2) --------------
  const rules = ['Dziwna prośba od znajomego? Zadzwoń na znany numer.', 'Kodu z SMS-a nie podajesz nikomu.', 'Link w wiadomości? Nie klikaj – wejdź sam przez aplikację lub stronę.'];
  for (const rule of rules) {
    await page.locator('ol li', { hasText: rule }).first().waitFor({ timeout: 20000 });
  }
  step('SUMMARY: trzy zasady z raportu na liście', (await page.locator('ol li').count()) >= 3);
  step('SUMMARY: wszystkie dowody (3 z 3)', (await page.getByText('Zebrane dowody: 3 z 3').count()) >= 1);
  await shot('7-raport');
  const finished = progressResponse();
  await bar().getByRole('button', { name: 'Zakończ sprawę' }).click();
  const finishedBody = await (await finished).json();
  step('Zakończenie: kurs ukończony (status COMPLETED)', finishedBody.status === 'COMPLETED', JSON.stringify({ status: finishedBody.status, score: finishedBody.score }));

  await page.getByRole('heading', { level: 2, name: 'Sprawa zamknięta' }).waitFor();
  await page.locator('[data-testid="case-closed"][data-stage="sign"]').waitFor({ timeout: 20000 });
  const slotText = async (testId) => ((await page.getByTestId(testId).textContent()) ?? '').trim();
  const report = page.getByTestId('case-closed').getByRole('img', { name: /Raport końcowy w teczce/ });
  step('Zamknięcie: grafika raportu (zasady wpalone w grafikę) załadowana', await report.evaluate((img) => img.complete && img.naturalWidth > 0));
  const reportAlt = (await report.getAttribute('alt')) ?? '';
  step('Zamknięcie: opis alt raportu zawiera wszystkie trzy zasady', rules.every((rule) => reportAlt.includes(rule)), reportAlt);
  step('Zamknięcie: dowody 3/3', (await slotText('closing-evidence')) === '3/3', await slotText('closing-evidence'));
  step('Zamknięcie: czas sprawy w minutach i +XP', /^\d+ min$/.test(await slotText('closing-time')) && /^\+[1-9]\d*$/.test(await slotText('closing-xp')), `${await slotText('closing-time')} | ${await slotText('closing-xp')}`);
  step('Zamknięcie: bez wpisywanych wniosków (zasady są w grafice)', (await page.getByTestId('closing-lesson-typed').count()) === 0);
  await shot('8-zamkniecie-przed-podpisem');
  await page.getByRole('button', { name: 'Podpisz raport' }).click();
  await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor();
  step('Zamknięcie: podpis jednym dotknięciem, potem pieczęć i liścik', (await page.getByTestId('closing-stamp').count()) === 1 && (await page.getByTestId('closing-note').count()) === 1);
  await shot('9-zamkniecie-podpisane');
  step('Klucz odpowiedzi (`correct`) nigdy w treści bloków ani w /check', leaks.length === 0, leaks.join(' | '));
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
