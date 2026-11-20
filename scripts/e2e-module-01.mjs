// E2E w przeglądarce (Playwright) - pełne przejście modułu 1 („Zabawa w phishing”, scenariusz „Webinar” D-176, okna D-178/D-179;
// packages/content/modules/wyludzone-haslo) zaimportowanego PRAWDZIWYM CLI (apps/api/dist/scripts/content-import.js), nie ręcznie
// sklejoną treścią. Przebieg: ekran startu (D-163, uwaga D-171) → teczka na biurku → biuro (komputer = drzwi) → pulpit (Poczta = drzwi,
// Internet, easter egg „Ciekawski detektyw”) → mail w monitorze → biuro z ✓ → ekran telefonu → czat → domena → Tak/Nie → biuro z dwoma ✓
// → rozmowa z Pawłem → tablica → raport w teczce → gazeta → (podsumowanie zapisuje się samo, D-169) → ekran końca (D-165) → osiągnięcia.
//
// Rejestracja/aktywacja organizacji NIE jest tu powtarzana (pełna ścieżka: scripts/e2e-registration.mjs) - organizację i pracownika
// tworzymy wprost przez Prisma (ACTIVE, jak w testach e2e apps/api), żeby skupić się na odtwarzaczu.
//
// Wymaga zbudowanych pakietów: `npm run build --workspace=packages/content`, `--workspace=apps/api` (import przez skompilowany
// apps/api/dist/scripts/content-import.js, API z apps/api/dist/main.js). Web startuje przez `next dev` (komentarz niżej).
// Grafiki i nagrania modułu 1 są wyłącznie na R2 (pipeline treści), więc web dostaje CONTENT_BASE_URL.
//
// Użycie z katalogu repo (dotenv-cli ładuje bazę i sekrety JWT z .env):
//   CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/e2e-module-01.mjs
// Opcjonalnie: E2E_VIEWPORT=390x844 (telefon w pionie, dotyk; bez easter egga pulpitu) zamiast domyślnego 1366x768,
// E2E_WEB_MODE=start (build produkcyjny, D-142), E2E_SHOTS_DIR=<katalog> (zrzut każdego bloku do przeglądu graficznego).
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
assertLocalDatabase('scripts/e2e-module-01.mjs');

const SLUG = 'wyludzone-haslo';
const MODULE = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', SLUG, 'module.json'), 'utf8'));
const text = (value) => (typeof value === 'string' ? value : value?.pl);
const MODULE_TITLE = text(MODULE.title);
const blockOf = (id) => {
  const block = MODULE.blocks.find((item) => item.id === id);
  if (!block) throw new Error(`Brak bloku "${id}" w module ${SLUG} - skrypt nieaktualny względem treści`);
  return block;
};
const BLOCK_IDS = MODULE.blocks.map((block) => block.id);
const positionOf = (id) => `blok ${BLOCK_IDS.indexOf(id) + 1} z ${BLOCK_IDS.length}`;

const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const DOMAIN = `module-01-e2e-${RUN}.test`;
const EMAIL = `pracownik@${DOMAIN}`;
const PASSWORD = 'E2e-Haslo-Testowe-1!';
const ORG_NAME = `Module 01 E2E ${RUN}`;
const [VW, VH] = (process.env.E2E_VIEWPORT ?? '1366x768').split('x').map(Number);
if (![VW, VH].every((n) => Number.isInteger(n) && n > 0)) throw new Error(`E2E_VIEWPORT: oczekiwano <szer>x<wys>, jest "${process.env.E2E_VIEWPORT}"`);
const WEB_MODE = process.env.E2E_WEB_MODE ?? 'dev';
if (!['dev', 'start'].includes(WEB_MODE)) throw new Error(`E2E_WEB_MODE: dev albo start, jest "${WEB_MODE}"`);
// Na telefonie skrypt pomija easter egg pulpitu (D-100) i zależne od niego osiągnięcie: kaskada okienek na telefonie to inny przebieg,
// poza zakresem tego skryptu (pełna ścieżka desktopowa bez zmian).
const PHONE = VW < 768;
const SHOTS_DIR = process.env.E2E_SHOTS_DIR;

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
// Sprzątamy TYLKO kurs, który TEN przebieg naprawdę stworzył (importResult.courseCreated) - importModule robi upsert po slug, więc gdy
// developer wcześniej sam uruchomił `content:import`, skrypt znajduje ISTNIEJĄCY kurs; kasowanie go skasowałoby cudzy kurs z lokalnej bazy.
let courseCreatedByThisRun = false;
try {
  if (!process.env.CONTENT_BASE_URL) throw new Error('Brak CONTENT_BASE_URL - grafiki i nagrania modułu 1 są tylko na R2.');
  start(process.execPath, ['apps/api/dist/main.js'], { PORT: API_PORT, FRONTEND_URL: WEB, MAILERSEND_API_TOKEN: '', BACKGROUND_JOBS_ENABLED: 'false', NODE_ENV: 'development' }, process.cwd());
  // `next dev`, NIE `next start`: `next start` twardo ustawia NODE_ENV=production WEWNĄTRZ CLI - cookies (auth-cookies.ts) dostają wtedy
  // Secure, którego przeglądarka bez TLS nie wyśle (401 na każdym żądaniu do BFF). `next dev` kompiluje z apps/web/src na bieżąco, więc
  // skrypt testuje NAJNOWSZY kod. E2E_WEB_MODE=start (D-142): build produkcyjny - pamięć routera i prefetch działają w nim inaczej.
  start(process.execPath, [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), WEB_MODE, '-p', WEB_PORT], { API_URL: API }, join(process.cwd(), 'apps', 'web'));
  await waitFor(async () => (await fetch(`${API}/`)).status > 0, 'start API');
  await waitFor(async () => (await fetch(`${WEB}/`)).ok, 'start web');

  // Import PRAWDZIWEGO modułu przez PRAWDZIWY skrypt (ta sama ścieżka co produkcja - D-051 pkt 11). Skrypt jest CJS, ten plik ESM.
  const contentImport = await import('../apps/api/dist/scripts/content-import.js');
  prisma = new PrismaClient();
  const modules = await contentImport.loadModules(join(process.cwd(), 'packages', 'content', 'modules'));
  const loaded = modules.find((m) => m.slug === SLUG);
  step(`content-import: moduł "${SLUG}" wczytany i zwalidowany`, !!loaded, `${modules.length} modułów łącznie`);
  const importResult = await prisma.$transaction((tx) => contentImport.importModule(tx, loaded));
  step(`content-import: moduł zaimportowany do bazy (${BLOCK_IDS.length} bloków)`, importResult.courseId != null && importResult.slug === SLUG, JSON.stringify(importResult));
  courseId = importResult.courseId;
  courseCreatedByThisRun = importResult.courseCreated;

  // Organizacja ACTIVE + pracownik (bez pełnej ścieżki rejestracji - patrz nagłówek).
  const org = await prisma.organization.create({ data: { name: ORG_NAME, status: 'ACTIVE' } });
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
  step('organizacja ACTIVE i pracownik z przypisanym kursem utworzeni', true);

  browser = await launchPolishBrowser(chromium);
  page = await (await browser.newContext({ viewport: { width: VW, height: VH }, isMobile: PHONE, hasTouch: PHONE })).newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));
  // Treść bloków przychodzi w HTML/RSC strony (`/start` woła serwer Next), nie przez `/api` - klucza odpowiedzi w treści pilnują
  // classification.spec.ts (packages/content) i e2e API. Tu: odpowiedź `/attempt` w bloku „domena” (bez rozwiązania i podpowiedzi).
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });
  const shot = async (name) => {
    if (!SHOTS_DIR) return;
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS_DIR, `${VW}x${VH}-${name}.png`) });
  };

  // 1. Logowanie -> pracownik ląduje na /courses (homePathForRole); katalog z nazwą modułu (D-170).
  await page.goto(`${WEB}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/courses');
  step('logowanie pracownika kieruje na /courses', true);
  await page.getByText(MODULE_TITLE, { exact: true }).first().waitFor();
  step(
    `Katalog: karta i miniatura modułu „${MODULE_TITLE}”, bez starej nazwy`,
    (await page.getByRole('img', { name: MODULE_TITLE, exact: true }).count()) >= 1 && (await page.getByText('Wyłudzone hasło', { exact: true }).count()) === 0,
  );

  const bar = () => page.getByTestId('player-bottombar');
  const nextEnabled = () => bar().getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled'));
  const nextDisabled = async () => (await bar().getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':disabled')).count()) === 1;
  const isProgress = (r) => r.url().includes(`/api/courses/${courseId}/progress`) && r.request().method() === 'POST';
  const progressResponse = () => page.waitForResponse(isProgress);
  // Jeden „Dalej” (D-106): w obszarze bloku nie ma przycisku nawigacji dalej.
  const IN_BLOCK_NEXT = /^(Dalej|Kontynuuj|Przejdź dalej|Zakończ scenę|Sprawdź i dalej|Zakończ sprawę|Zakończ szkolenie|Wróć do biblioteki)$/;
  const noInBlockNext = async () =>
    (await page.getByTestId('player-content-area').getByRole('button', { name: IN_BLOCK_NEXT }).count()) === 0 &&
    (await page.getByTestId('player-content-area').getByRole('link', { name: IN_BLOCK_NEXT }).count()) === 0;
  const goNext = async (what) => {
    const saved = progressResponse();
    await nextEnabled().click();
    const response = await saved;
    step(`${what}: „Dalej” w pasku zapisuje blok`, response.ok(), `HTTP ${response.status()}`);
    return response;
  };
  const dialog = () => page.getByRole('dialog');
  const closed = () => page.getByTestId('scene-zoom').waitFor({ state: 'detached' });
  const hotspot = (id) => page.getByTestId(`hotspot-overlay-${id}`);
  // Karta przedmiotu (treść bez grafiki): otwarcie = obejrzane (wymagane liczą się po obejrzeniu), „Odłóż” zamyka zbliżenie.
  // Treść karty z module.json (pierwsze słowa wystarczą do znalezienia jej w zbliżeniu).
  const cardText = (blockId, id) => text(blockOf(blockId).hotspots.find((h) => h.id === id).content).slice(0, 40);
  const lookAt = async (blockId, id) => {
    await hotspot(id).click();
    await dialog().getByText(cardText(blockId, id)).waitFor();
    await dialog().getByRole('button', { name: 'Odłóż' }).click();
    await closed();
  };
  // Drzwi (action:'next'): klik zapisuje blok i przechodzi dalej - bez osobnego „Dalej” (D-129).
  const door = async (id, what) => {
    const label = (await hotspot(id).getAttribute('aria-label')) ?? id;
    const saved = progressResponse();
    await hotspot(id).click();
    step(`${what}: klik w drzwi „${label}” zapisuje blok i przechodzi dalej`, (await saved).ok());
  };
  const doneMark = (label) => page.getByRole('img', { name: `${label} (obejrzane wcześniej)`, exact: true });
  const doorHint = (label) => page.getByText(`Kliknij „${label}”, żeby iść dalej.`, { exact: true });
  const openTabs = async (block) => {
    for (const tab of block.tabs) {
      await page.getByRole('tab', { name: text(tab.title), exact: true }).click();
      await page.getByRole('tabpanel').getByText(text(tab.content).split('\n')[0].slice(0, 40), { exact: false }).first().waitFor();
    }
  };

  // --- Ekran startu (D-163): okładka, numer sprawy, uwaga w czerwonej ramce (D-171), Start -------------------------------------
  await page.goto(`${WEB}/courses/${courseId}`);
  await page.getByTestId('module-start').waitFor();
  await shot('00-start');
  await passStartScreen(page, step, { title: MODULE_TITLE, caseNumber: MODULE.caseNumber, notice: text(MODULE.startNotice) });
  // Tło modułu za ramką (cover.backdrop, D-178) - na komputerze; na telefonie ukryte.
  if (!PHONE) step('Player: rozmyte tło modułu za ramką (cover.backdrop)', (await page.getByTestId('player-backdrop').count()) === 1);

  // --- 1. Teczka (TABS look folder na biurku, pieczątka ŚCIŚLE TAJNE) --------------------------------------------------------
  const teczka = blockOf('teczka');
  await page.getByTestId('folder').waitFor();
  step(
    'TECZKA: teczka na biurku (tło), pieczątka „ŚCIŚLE TAJNE”, „Dalej” nieaktywny przed zakładkami',
    (await page.getByTestId('folder-desk').count()) === 1 && ((await page.getByTestId('folder-stamp').textContent()) ?? '').includes(teczka.stamp) && (await nextDisabled()),
  );
  await shot('01-teczka');
  await openTabs(teczka);
  await nextEnabled().waitFor();
  step('TECZKA: wszystkie zakładki obejrzane - „Dalej” aktywny, w bloku brak przycisku dalej', await noInBlockNext());
  await goNext('TECZKA');

  // --- 2. Biuro Pawła (komputer = drzwi; smartfon i Paweł - karty nieobowiązkowe) --------------------------------------------
  await hotspot('komputer').waitFor();
  step('BIURO: jedyne drzwi to komputer - podpowiedź „Kliknij „Komputer”…” zamiast licznika', (await doorHint('Komputer').count()) === 1);
  await shot('02-biuro');
  await lookAt('biuro-pawla', 'smartfon');
  await lookAt('biuro-pawla', 'pawel');
  step('BIURO: karty smartfona i Pawła otwierają się i zamykają „Odłóż”', true);
  await door('komputer', 'BIURO');

  // Wznowienie po wyjściu (fix/resume-po-wyjsciu, D-142): X i od razu „Kontynuuj naukę” - BEZ przeładowania - wraca na pulpit, a nie na
  // teczkę z pamięci routera klienta (ani na ekran startu). Przy okazji sieć: lista kursów pobrana raz, prefetch liczony osobno.
  {
    const net = { list: [], course: [], listPrefetch: [], coursePrefetch: [] };
    let phase = 'list';
    const onRequest = (request) => {
      const { pathname } = new URL(request.url());
      const headers = request.headers();
      if (headers.rsc !== '1') return;
      const prefetch = headers['next-router-prefetch'] === '1';
      if (pathname === '/courses') (prefetch ? net.listPrefetch : net.list).push(phase);
      if (pathname === `/courses/${courseId}`) (prefetch ? net.coursePrefetch : net.course).push(phase);
    };
    page.on('request', onRequest);
    await page.getByRole('link', { name: 'Zakończ i wróć do listy kursów' }).click();
    await page.waitForURL((url) => url.pathname === '/courses');
    await page.getByRole('link', { name: 'Kontynuuj naukę' }).waitFor();
    await page.waitForLoadState('networkidle');
    phase = 'course';
    await page.getByRole('link', { name: 'Kontynuuj naukę' }).click();
    await page.waitForURL((url) => url.pathname === `/courses/${courseId}`);
    const resumed = await hotspot('poczta').waitFor({ timeout: 15000 }).then(() => true, () => false);
    page.off('request', onRequest);
    const detail = `RSC lista: ${net.list.length} (prefetch ${net.listPrefetch.length}), RSC odtwarzacz: ${net.course.length} (prefetch ${net.coursePrefetch.length})`;
    step(`Wznowienie: X i od razu „Kontynuuj naukę” (bez przeładowania) - pulpit, ${positionOf('pulpit')}, bez ekranu startu`, resumed && (await page.getByTestId('module-start').count()) === 0, detail);
    step('Wznowienie: strona odtwarzacza pobrana z serwera (pełne żądanie RSC), nie z pamięci routera', net.course.filter((p) => p === 'course').length >= 1, detail);
    step('Sieć: lista kursów pobrana raz przy powrocie X (bez podwójnego pobierania)', net.list.filter((p) => p === 'list').length === 1, detail);
  }

  // --- 3. Pulpit (monitor Unfooly; Poczta = drzwi, Internet - karta, gra - easter egg) ---------------------------------------
  step('PULPIT: jedyne drzwi to Poczta - podpowiedź „Kliknij „Poczta”…”', (await doorHint('Poczta').count()) === 1);
  await shot('03-pulpit');
  {
    // Internet (D-184): okno przeglądarki z fałszywą stroną logowania (makieta bez pól), bez najazdu kamery, opis z historii pod oknem.
    await hotspot('internet').click();
    // Faza od razu po kliknięciu: z najazdem kamery byłaby 'in' (450 ms), bez niego od razu 'open'.
    const internetPhase = await page.getByTestId('scene-zoom').getAttribute('data-phase');
    await dialog().getByText(cardText('pulpit', 'internet')).waitFor();
    const fakeWindow = page.getByTestId('fake-page-window');
    step(
      'PULPIT: Internet - okno z fałszywą stroną logowania (karta „Formularz prelegenta”, makieta bez pól), bez najazdu kamery',
      internetPhase === 'open' &&
        ((await fakeWindow.textContent()) ?? '').includes('Formularz prelegenta') &&
        (await fakeWindow.getByTestId('fake-login-page').count()) === 1 &&
        (await fakeWindow.locator('input, form, textarea, button').count()) === 0,
    );
    await shot('03b-internet');
    await dialog().getByRole('button', { name: 'Odłóż' }).click();
    await closed();
  }
  if (!PHONE) {
    // Easter egg (D-100): trzy okienka zamykane krzyżykiem, outro z osiągnięciem, „Wróć” zamyka zbliżenie. Bez najazdu kamery (D-184).
    await hotspot('gra').click();
    {
      const zoom = page.getByTestId('scene-zoom');
      const [phase, cls] = [await zoom.getAttribute('data-phase'), (await zoom.getAttribute('class')) ?? ''];
      step('EASTER EGG: okienka bez najazdu kamery i bez przyciemnienia sceny', phase === 'open' && cls.includes('bg-transparent') && !cls.includes('backdrop-blur'), `${phase} | ${cls}`);
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="easter-popup"]').length === 3, undefined, { timeout: 10000 });
    for (const item of [...blockOf('pulpit').hotspots.find((h) => h.id === 'gra').media.items].reverse()) {
      const title = text(item.title).replace(/^[^\p{L}\p{N}]+/u, '').trim();
      await page.getByRole('button', { name: `Zamknij okienko: ${title}` }).click();
    }
    await page.getByTestId('easter-outro').waitFor();
    const eggBadge = (await page.getByTestId('easter-badge').textContent()) ?? '';
    step('EASTER EGG: trzy okienka zamknięte krzyżykiem, outro z osiągnięciem „Ciekawski detektyw”', eggBadge.includes('Ciekawski detektyw'), eggBadge);
    await page.getByTestId('easter-outro').getByRole('button').click();
    await closed();
  }
  await door('poczta', 'PULPIT');

  // --- 4. Zaproszenie (EMAIL_ANALYSIS w monitorze, waga 2): jedyna prawdziwa cecha - niespodziewana oferta --------------------
  const zaproszenie = blockOf('zaproszenie');
  await page.getByTestId('monitor-screen').getByTestId('mail-client').waitFor();
  step(
    'MAIL: wiadomość na ekranie monitora (pasek „Poczta”), adresat „Do:” z treści',
    ((await page.getByTestId('mail-app-bar').textContent()) ?? '').includes('Poczta') && ((await page.getByTestId('mail-client').textContent()) ?? '').includes(zaproszenie.email.to),
  );
  await shot('04-mail');
  for (const criterion of zaproszenie.criteria.filter((c) => c.correct)) {
    await page.getByRole('checkbox', { name: text(criterion.label) }).check();
  }
  const emailAnswered = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź odpowiedź' }).click();
  const emailBody = await (await emailAnswered).json();
  step('MAIL: tylko „niespodziewana oferta” -> 100% i reakcja z treści', emailBody.lastResult?.points === 1 && emailBody.lastResult?.reaction?.text === text(zaproszenie.reactions.result[0].text), JSON.stringify(emailBody.lastResult));
  await page.getByText(/Wynik: 100%/).waitFor();
  step('MAIL: wynik zostaje w tym samym monitorze (D-184)', (await page.getByTestId('monitor-screen').getByText(/Wynik: 100%/).count()) === 1);
  await shot('04b-mail-wynik');
  step('MAIL: wynik bez własnego „Dalej” - jedyny w pasku', await noInBlockNext());
  await nextEnabled().click();

  // --- 5. Biuro z ✓ komputera (smartfon = drzwi) ------------------------------------------------------------------------------
  await hotspot('smartfon').waitFor();
  // „Wstecz” przeglądarki po kolejnym zapisie (D-142): wpis historii ma drzewo z wejścia na pulpit, a postęp poszedł dalej - odtwarzacz
  // pobiera świeży postęp i pokazuje biuro z ✓, nie pulpit.
  {
    await page.getByRole('link', { name: 'Zakończ i wróć do listy kursów' }).click();
    await page.waitForURL((url) => url.pathname === '/courses');
    await page.goBack();
    await page.waitForURL((url) => url.pathname === `/courses/${courseId}`);
    const back = await doneMark('Komputer').waitFor({ timeout: 15000 }).then(() => true, () => false);
    step(`Wznowienie: X i „Wstecz” przeglądarki - biuro z ✓, ${positionOf('biuro-pawla-2')}, nie pulpit`, back && (await hotspot('poczta').count()) === 0);
  }
  step('BIURO 2: komputer z ✓ (bez przycisku), drzwi - smartfon', (await page.getByRole('button', { name: /^Komputer/ }).count()) === 0 && (await doorHint('Smartfon').count()) === 1);
  await shot('05-biuro-2');
  await door('smartfon', 'BIURO 2');

  // --- 6. Telefon Pawła (ekran główny; Komunikator = drzwi, Poczta i Kalendarz - karty) --------------------------------------
  await hotspot('komunikator').waitFor();
  await shot('06-telefon');
  await lookAt('telefon', 'kalendarz');
  await door('komunikator', 'TELEFON');

  // --- 7. Komunikator (DOSSIER layout chat na ekranie telefonu ze sceny, D-181): wymagane - połączenie, link, prośba o hasło -----
  const czat = blockOf('komunikator').documents[0];
  await page.getByTestId('phone-screen').getByTestId('chat-sheet').waitFor();
  const bubble = (row) => page.getByTestId('chat-bubble').filter({ hasText: text(row.cells[2]).slice(0, 30) });
  step(
    'CZAT: dymki na ekranie telefonu ze sceny (bez karty teczki), „Dalej” nieaktywny przed wymaganymi',
    (await page.getByTestId('chat-bubble').count()) === czat.rows.length && (await page.getByTestId('dossier-block').count()) === 0 && (await nextDisabled()),
    `${await page.getByTestId('chat-bubble').count()} dymków`,
  );
  await shot('07-czat');
  const greeting = czat.rows.find((row) => row.message);
  await bubble(greeting).click();
  step('CZAT: zwykła wiadomość - komunikat z treści, bez zaznaczenia', ((await page.getByTestId('chat-sheet').getByRole('status').textContent()) ?? '').includes(text(greeting.message).slice(0, 30)) && (await bubble(greeting).getAttribute('aria-pressed')) === 'false');
  for (const row of czat.rows.filter((r) => r.required)) {
    await bubble(row).click();
    step(`CZAT: „${text(row.cells[2]).slice(0, 40)}…” zaznaczona`, (await bubble(row).getAttribute('aria-pressed')) === 'true');
  }
  await nextEnabled().waitFor();
  step('CZAT: po wymaganych „Dalej” aktywny, w bloku brak przycisku dalej', await noInBlockNext());
  await goNext('CZAT');

  // --- 8. Domena (TEXT_INPUT_GUIDED, D-181/D-184, waga 0): fałszywa strona na pulpicie Pawła; w pasku adresu pierwszy pojedynczy „/”,
  // potem druga „.” w lewo -----
  const domena = blockOf('domena');
  const url = domena.markUrl;
  const monitor = page.getByTestId('desktop-window');
  await monitor.getByTestId('address-marker').waitFor();
  const separator = (index) => monitor.locator(`[data-testid="address-separator"][data-index="${index}"]`);
  step(
    'DOMENA: okno przeglądarki na pulpicie (tło sceny), pod zadaniem fałszywa strona logowania, pole odpowiedzi ukryte do zaznaczenia domeny',
    (await page.getByTestId('desktop-stage').count()) === 1 &&
      (await monitor.getByTestId('fake-login-page').count()) === 1 &&
      (await page.getByPlaceholder(text(domena.placeholder)).count()) === 0,
  );
  await shot('08a-domena-adres');
  await separator(url.indexOf('/')).click(); // ukośnik z „https://” - zły
  step('DOMENA: ukośnik z „https://” - komunikat, bez zapisu', ((await monitor.getByRole('status').textContent()) ?? '').includes('POJEDYNCZEGO'));
  const slash = url.indexOf('/', url.indexOf('://') + 3);
  await separator(slash).click();
  const firstDot = url.lastIndexOf('.', slash);
  await separator(firstDot).click(); // pierwsza kropka w lewo (.net) - zła
  step('DOMENA: pierwsza kropka w lewo - komunikat „To nie ta kropka”', ((await monitor.getByRole('status').textContent()) ?? '').includes('To nie ta kropka'));
  await separator(url.lastIndexOf('.', firstDot - 1)).click();
  step('DOMENA: po „/” i „.” podświetlona domena z treści i pole odpowiedzi', ((await monitor.getByTestId('address-domain').textContent()) ?? '') === text(domena.solution.text) && (await page.getByPlaceholder(text(domena.placeholder)).count()) === 1);
  await page.getByPlaceholder(text(domena.placeholder)).fill(text(domena.solution.text));
  const attempted = page.waitForResponse((r) => r.url().endsWith('/blocks/domena/attempt') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sprawdź', exact: true }).click();
  const attemptBody = await (await attempted).json();
  step('DOMENA: /attempt po dobrej pierwszej próbie - werdykt bez rozwiązania i podpowiedzi', attemptBody.correct === true && !('solution' in attemptBody) && !('hint' in attemptBody), JSON.stringify(Object.keys(attemptBody)));
  await page.getByText(/Poprawna odpowiedź!/).waitFor();
  step('DOMENA: poprawna odpowiedź za pierwszym razem -> reakcja z treści', (await page.getByText(text(domena.reactions.result[0].text), { exact: true }).count()) === 1);
  await shot('08-domena');
  step('DOMENA: wynik bez własnego „Dalej” - jedyny w pasku', await noInBlockNext());
  const domainBody = await (await goNext('DOMENA')).json();
  step('DOMENA: pełne punkty za pierwszą próbę', domainBody.lastResult?.points === 1, JSON.stringify(domainBody.lastResult?.points));

  // --- 9. Czy to bezpieczny link? (QUIZ, waga 1) ------------------------------------------------------------------------------
  const zaufanie = blockOf('zaufanie');
  const right = zaufanie.options.find((option) => option.correct);
  await page.getByRole('radio', { name: text(right.text) }).check();
  const quizAnswered = progressResponse();
  await page.getByRole('button', { name: 'Wybierz odpowiedź' }).click();
  const quizBody = await (await quizAnswered).json();
  step('QUIZ: „Nie – domena nie należy do fundacji.” -> pełne punkty', quizBody.lastResult?.points === 1, JSON.stringify(quizBody.lastResult));
  await shot('09-quiz');
  await nextEnabled().click();

  // --- 10. Biuro z dwoma ✓ (Paweł = drzwi) ------------------------------------------------------------------------------------
  await hotspot('pawel').waitFor();
  step('BIURO 3: komputer i smartfon z ✓, drzwi - Paweł', (await doneMark('Komputer').count()) === 1 && (await doneMark('Smartfon').count()) === 1 && (await doorHint('Paweł').count()) === 1);
  await shot('10-biuro-3');
  await door('pawel', 'BIURO 3');

  // --- 11. Rozmowa z Pawłem (DIALOGUE): opening przed pytaniami, wszystkie pytania ----------------------------------------------
  const rozmowa = blockOf('rozmowa-pawel');
  const chatIdle = () => page.locator('[role="log"][data-typing="false"]').waitFor();
  await page.getByText(text(rozmowa.character.opening)).waitFor();
  step('ROZMOWA: character.opening przed pierwszym pytaniem, „Dalej” nieaktywny', await nextDisabled());
  step('ROZMOWA: wątek na ekranie telefonu z biurka (D-184)', (await page.getByTestId('phone-screen').getByTestId('dialogue-on-phone').count()) === 1);
  for (const question of rozmowa.questions) {
    await chatIdle();
    await page.getByRole('button', { name: text(question.text), exact: true }).click();
    await chatIdle();
  }
  await nextEnabled().waitFor();
  await shot('11-rozmowa');
  step('ROZMOWA: po pytaniach „Dalej” aktywny, w bloku brak przycisku dalej', await noInBlockNext());
  await goNext('ROZMOWA');

  // --- 12. Tablica z notatkami (ORDERING look notes, D-182, waga 2): etapy na kartki - przeciągnięcie, klawiatura, kliknięcia ----------
  const tablica = blockOf('tablica');
  await page.getByTestId('notes-board').waitFor();
  const labels = page.getByRole('group', { name: 'Etapy ataku do przypięcia' });
  step(
    `TABLICA: ${tablica.slots.length} kartki z notatkami z treści, ${tablica.items.length} etapy pod tablicą, bez „Sprawdź trop”`,
    (await page.getByTestId('notes-card').count()) === tablica.slots.length &&
      ((await page.getByTestId('notes-card').first().textContent()) ?? '').includes(text(tablica.slots[0].notes[0])) &&
      (await labels.getByRole('button').count()) === tablica.items.length &&
      (await page.getByRole('button', { name: 'Sprawdź trop' }).count()) === 0,
  );
  await shot('12a-tablica-pusta');
  const labelOf = (item) => labels.getByRole('button', { name: new RegExp(`^Etap: ${text(item.text)}`) });
  const emptyCard = (index) => page.getByRole('button', { name: new RegExp(`^Kartka ${index + 1}: pusta`) });
  for (const [index, item] of tablica.items.entries()) {
    if (index === 0 && !PHONE) {
      // Przeciągnięcie myszą: etykieta -> kartka 1.
      const from = await labelOf(item).boundingBox();
      const to = await emptyCard(index).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 - 20, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
    } else if (index === 1) {
      // Klawiatura: Enter na etykiecie, Enter na kartce.
      await labelOf(item).focus();
      await labelOf(item).press('Enter');
      await emptyCard(index).focus();
      await emptyCard(index).press('Enter');
    } else {
      await labelOf(item).click();
      await emptyCard(index).click();
    }
    await page.getByRole('button', { name: new RegExp(`^Kartka ${index + 1}: ${text(item.text)}`) }).waitFor({ timeout: 5000 });
  }
  step(`TABLICA: etapy przypięte (${PHONE ? 'stuknięcia' : 'przeciągnięcie'}, klawiatura, klik) - „Sprawdź trop” widoczny`, (await page.getByRole('button', { name: 'Sprawdź trop' }).count()) === 1);
  const orderingAnswered = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź trop' }).click();
  const orderingBody = await (await orderingAnswered).json();
  step('TABLICA: poprawna kolejność -> pełne punkty i reakcja z treści', orderingBody.lastResult?.points === 1 && orderingBody.lastResult?.reaction?.text === text(tablica.reactions.result[0].text), JSON.stringify(orderingBody.lastResult));
  await page.locator('[data-testid="notes-board"][data-phase="settled"]').waitFor();
  step('TABLICA: po sprawdzeniu ✓ na każdej kartce', (await page.locator('[data-testid="notes-card"][data-result="good"]').count()) === tablica.slots.length);
  await shot('12-tablica');
  step('TABLICA: wynik bez własnego „Dalej” - jedyny w pasku', await noInBlockNext());
  await nextEnabled().click();

  // --- 13. Raport końcowy (TABS w teczce „SPRAWA ZAMKNIĘTA” na biurku) ---------------------------------------------------------
  const raport = blockOf('raport');
  await page.getByTestId('folder-stamp').filter({ hasText: raport.stamp }).waitFor();
  step('RAPORT: teczka „SPRAWA ZAMKNIĘTA” na biurku, „Dalej” nieaktywny przed zakładkami', (await page.getByTestId('folder-desk').count()) === 1 && (await nextDisabled()));
  await openTabs(raport);
  await shot('13-raport');
  await goNext('RAPORT');

  // --- 14. Gazeta (SCENE_HOTSPOTS, wymagany artykuł), potem podsumowanie zapisuje się samo (D-169) i ekran końca (D-165) -------
  await hotspot('artykul').waitFor();
  step('GAZETA: „Dalej” nieaktywny przed artykułem', await nextDisabled());
  await hotspot('artykul').click();
  const article = blockOf('gazeta').hotspots[0].media;
  await dialog().getByTestId('newspaper-page').getByText(text(article.lines[0]).slice(0, 40)).first().waitFor();
  step('GAZETA: strona gazety z winietą z treści (D-181)', ((await dialog().getByTestId('newspaper-page').textContent()) ?? '').includes(text(article.masthead)));
  await shot('14-gazeta');
  await dialog().getByRole('button', { name: 'Odłóż' }).click();
  await closed();
  // Dwa zapisy po kolei: gazeta („Dalej”), potem SUMMARY bez ekranu (odtwarzacz sam, D-169) - ten drugi kończy kurs.
  const completion = completionResponse(page, courseId);
  await nextEnabled().click();
  const completionBody = await (await completion).json();
  // score to skala 0-100 (progress.ts computeScore: Math.round((weighted/total)*100)).
  step('Kurs ukończony po stronie serwera ze 100% wyniku (bez ekranu podsumowania, D-169)', completionBody.status === 'COMPLETED' && completionBody.score === 100, JSON.stringify({ status: completionBody.status, score: completionBody.score }));
  // Osiągnięcia „na żywo” (D-111) w odpowiedzi ukończenia.
  const liveCodes = (completionBody.gamification?.unlockedBadges ?? []).map((badge) => badge.code).sort();
  step('Osiągnięcia na żywo przy ukończeniu: Pierwsza sprawa zamknięta i Sprawa bez skazy', JSON.stringify(liveCodes) === JSON.stringify(['first-case-closed', 'flawless-case']), JSON.stringify(liveCodes));

  // --- Ekran końca (D-165): pieczątka, kafelki Wynik / Czas / Punkty, poziom, zasady na wynos, przyciski -------------------------
  const end = page.getByTestId('module-end');
  const tile = async (name) => ((await page.getByTestId(`module-end-${name}`).textContent()) ?? '').trim();
  await checkEndScreen(page, step, { completion: completionBody, rules: blockOf('zasady').lessons.map(text) });
  await shot('15-koniec');

  // Powrót do ukończonego kursu: od razu ekran końca, bez ekranu startu; czas sprawy nadal znany (startedAt/completedAt z /start).
  await page.reload();
  await end.waitFor();
  step('KONIEC po odświeżeniu: ekran końca od razu (bez startu), czas w minutach', (await page.getByTestId('module-start').count()) === 0 && /^\d+ min$/.test(await tile('czas')), await tile('czas'));

  // Osiągnięcia (D-111): pełne przejście z easter eggiem i 100% - na profilu trzy z modułu 1, przyznane przez serwer.
  await page.goto(`${WEB}/courses/achievements`);
  await page.getByTestId('achievements-counter').waitFor();
  const achievementsCounter = ((await page.getByTestId('achievements-counter').textContent()) ?? '').replace(/\s/g, '');
  const earned = PHONE ? ['Pierwsza sprawa zamknięta', 'Sprawa bez skazy'] : ['Pierwsza sprawa zamknięta', 'Sprawa bez skazy', 'Ciekawski detektyw'];
  step(`Osiągnięcia: licznik ${earned.length} / N na profilu`, new RegExp(`^${earned.length}/\\d+$`).test(achievementsCounter), achievementsCounter);
  for (const name of earned) {
    step(`Osiągnięcia: ${name} zdobyte`, (await page.getByRole('button', { name: new RegExp(`^${name} \\([^)]+\\), zdobyte`) }).count()) === 1);
  }
  if (!PHONE) {
    await page.getByRole('button', { name: /^Ciekawski detektyw/ }).click();
    step('Osiągnięcia: rewers Ciekawski detektyw z datą zdobycia', /Zdobyto: \d{2}\.\d{2}\.\d{4}/.test((await page.getByTestId('achievement-live').textContent()) ?? ''));
  }

  // Przypinanie (D-112): z rewersu dwóch zdobytych kart -> sekcja „Przypięte” i miniatury przy imieniu w rankingu na /courses.
  for (const name of ['Sprawa bez skazy', 'Pierwsza sprawa zamknięta']) {
    const pinResponse = page.waitForResponse((r) => r.url().includes('/api/gamification/pinned') && r.request().method() === 'PUT');
    await page.getByRole('button', { name: new RegExp(`^${name} \\(`) }).click();
    await page.getByTestId('achievement-pin').click();
    step(`Przypinanie: ${name} zapisane na serwerze`, (await pinResponse).ok());
  }
  step('Przypinanie: sekcja „Przypięte” w kolejności przypięcia', (await page.getByTestId('pinned-item').allTextContents()).map((t) => t.replace(/^\d+\.\s*/, '').split('Odepnij')[0].trim()).join('|') === 'Sprawa bez skazy|Pierwsza sprawa zamknięta');
  await page.goto(`${WEB}/courses`);
  const myRow = page.getByRole('row').filter({ has: page.getByText('Ty', { exact: true }) });
  await myRow.waitFor();
  const rowBadges = await myRow.getByTestId('pinned-badge').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
  step('Ranking: przy moim nazwisku przypięte osiągnięcia (nazwa w podpowiedzi)', rowBadges.join('|') === 'Sprawa bez skazy|Pierwsza sprawa zamknięta', rowBadges.join('|'));

  step('Bez błędów strony i odpowiedzi 5xx', problems.length === 0, problems.join(' | '));
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
    // Kurs po organizacji (przypisania znikają kaskadowo; kurs z przypisaniami jest chroniony - RESTRICT, B-032) i TYLKO, gdy ten
    // przebieg go stworzył (courseCreatedByThisRun).
    if (courseId && courseCreatedByThisRun) await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  } catch (error) {
    console.error('Sprzątanie bazy nie powiodło się:', error.message);
  }
}
