// E2E w przeglądarce (Playwright) - pełne przejście modułu 2 ("Głos z helpdesku", packages/content/modules/glos-z-helpdesku)
// zaimportowanego PRAWDZIWYM CLI, na wzór scripts/e2e-module-01.mjs (tam opis założeń: org i pracownik przez Prisma, `next dev`,
// sprzątanie tylko kursu stworzonego przez ten przebieg). Cel: wszystkie 11 bloków od odprawy do zamknięcia sprawy, 20/20 dowodów,
// 100% wyniku i osiągnięcia modułu 2 (Dead Air, Perfect Pitch, Full Transcript, Off the Record - D-124) przyznane przez serwer.
//
// Nagrania i grafiki modułu 2 są wyłącznie na R2 (pipeline treści), więc web musi dostać CONTENT_BASE_URL.
// Użycie z katalogu repo:
//   CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/e2e-module-02.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SLUG = 'glos-z-helpdesku';
const MODULE = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', SLUG, 'module.json'), 'utf8'));
const MODULE_TITLE = MODULE.title.pl;
const blockOf = (id) => MODULE.blocks.find((block) => block.id === id);
const EVIDENCE_TOTAL = 20;
const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const DOMAIN = `module-02-e2e-${RUN}.test`;
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
  if (!process.env.CONTENT_BASE_URL) throw new Error('Brak CONTENT_BASE_URL - nagrania i grafiki modułu 2 są tylko na R2.');
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

  const org = await prisma.organization.create({ data: { name: `Module 02 E2E ${RUN}`, status: 'ACTIVE' } });
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
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`);
  });
  // Osiągnięcia „na żywo” ze wszystkich zapisów postępu.
  const liveBadges = new Set();
  page.on('response', async (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
    if (response.url().includes('/progress') && response.request().method() === 'POST' && response.ok()) {
      const body = await response.json().catch(() => null);
      for (const badge of body?.gamification?.unlockedBadges ?? []) liveBadges.add(badge.code);
    }
  });

  await page.goto(`${WEB}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/courses');
  step('logowanie pracownika kieruje na /courses', true);
  await page.getByText(MODULE_TITLE, { exact: true }).first().waitFor();
  step('Katalog: karta i miniatura „Głos z helpdesku”', (await page.getByRole('img', { name: MODULE_TITLE, exact: true }).count()) >= 1);

  await page.goto(`${WEB}/courses/${courseId}`);
  await page.getByRole('heading', { level: 1, name: MODULE_TITLE, exact: true }).waitFor();
  step('Player: nagłówek z nazwą modułu', true);

  const progressResponse = () => page.waitForResponse((r) => r.url().includes(`/api/courses/${courseId}/progress`) && r.request().method() === 'POST');
  const bar = () => page.getByTestId('player-bottombar');
  const nextEnabled = () => bar().getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled'));
  const nextDisabled = async () => (await bar().getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':disabled')).count()) === 1;
  const IN_BLOCK_NEXT = /^(Dalej|Kontynuuj|Przejdź dalej|Zakończ scenę|Sprawdź i dalej|Zakończ sprawę|Zakończ szkolenie|Wróć do biblioteki|Wchodzę)$/;
  const noInBlockNext = async () =>
    (await page.getByTestId('player-content-area').getByRole('button', { name: IN_BLOCK_NEXT }).count()) === 0 &&
    (await page.getByTestId('player-content-area').getByRole('link', { name: IN_BLOCK_NEXT }).count()) === 0;
  const counter = async () => (await page.getByTestId('evidence-counter').textContent()) ?? '';
  // Suma w liczniku rośnie: sprzeczność przesłuchania i notatki OSINT są dowodami ukrytymi (D-118, D-120) - liczą się dopiero po zebraniu,
  // więc od startu jest 16, po obaleniu sprzeczności 17, po ocenie OSINT 20.
  const counterIs = async (n, total = EVIDENCE_TOTAL) => {
    const wanted = `Dowody ${n}/${total}`;
    await page
      .waitForFunction((text) => document.querySelector('[data-testid="evidence-counter"]')?.textContent?.includes(text), wanted, { timeout: 15000 })
      .catch(async () => {
        throw new Error(`Licznik dowodów: oczekiwane „${wanted}”, jest „${await counter()}”`);
      });
  };
  // „Dalej” w pasku, aż pojawi się znacznik następnego bloku (blok z wynikiem pokazuje go po zapisie - wtedy drugi „Dalej” przechodzi dalej).
  const advanceUntil = async (locator, what) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await locator.first().isVisible().catch(() => false)) return;
      await nextEnabled().click({ timeout: 15000 });
      await locator.first().waitFor({ timeout: 8000 }).catch(() => {});
    }
    if (!(await locator.first().isVisible().catch(() => false))) throw new Error(`Nie przeszło do: ${what}`);
  };

  const dialog = () => page.getByRole('dialog');
  const closed = () => page.getByTestId('scene-zoom').waitFor({ state: 'detached' });
  const take = async () => {
    await dialog().getByRole('button', { name: 'Zabierz' }).click();
    await closed();
  };
  const putDown = async () => {
    await dialog().getByRole('button', { name: 'Odłóż' }).click();
    await closed();
  };
  const briefingItem = async (name) => {
    const item = page.getByRole('button', { name, exact: true });
    await item.waitFor();
    if ((await item.getAttribute('data-testid')) !== 'briefing-hotspot') throw new Error(`"${name}" nie jest przedmiotem na scenie odprawy`);
    await item.click();
  };

  // --- 1. Odprawa (BRIEFING, 5 kroków: telefon, rozmowa, teczka, legitymacja, start) -------------------------------------------
  await page.getByRole('button', { name: 'Odbierz telefon' }).waitFor();
  step('BRIEFING: scena, „Pomiń odprawę” od razu, „Dalej” nieaktywny, w bloku brak przycisku dalej', (await page.getByRole('button', { name: 'Pomiń odprawę' }).count()) === 1 && (await nextDisabled()) && (await noInBlockNext()));
  step('BRIEFING: krok 0 - „Czwartek, 10:20…”', (await page.getByText(/Czwartek, 10:20\. Wydział Cyberbezpieczeństwa, Kraków\./).count()) >= 1);
  await briefingItem('Odbierz telefon');
  step('BRIEFING: dzwoni komisarz (dymek w scenie)', (await page.getByTestId('briefing-bubble').getByText('Komisarz Adam Wolski').count()) === 1);
  await briefingItem('Rozłącz');
  await page.getByRole('button', { name: 'Otwórz teczkę' }).waitFor();
  step('BRIEFING: zamknięta teczka sprawy GZH/2026/1004', (await page.getByText(/GZH\/2026\/1004/).count()) >= 1);
  await briefingItem('Otwórz teczkę');
  step('BRIEFING: akta z 3 zadaniami w slocie', (await page.getByTestId('briefing-slot-tasks').getByRole('listitem').count()) === 3);
  await briefingItem('Zamknij teczkę');
  await page.getByTestId('briefing-slot-number').waitFor();
  step('BRIEFING: legitymacja z numerem odznaki 1004-*', /^1004-/.test((await page.getByTestId('briefing-slot-number').textContent()) ?? ''), await page.getByTestId('briefing-slot-number').textContent());
  await briefingItem('Zabierz legitymację');
  await page.getByText('Drukarnia Lipowa, dział sprzedaży. 10:40.').first().waitFor();
  await nextEnabled().waitFor();
  step('BRIEFING: ekran startu, „Dalej” aktywny, w bloku brak przycisku dalej', await noInBlockNext());
  const briefingSaved = progressResponse();
  await nextEnabled().click();
  step('BRIEFING: „Dalej” zapisuje blok', (await briefingSaved).ok());

  // --- 2. Biurko Karola (SCENE_HOTSPOTS z dwiema scenami zagnieżdżonymi: telefon, pulpit) -------------------------------------
  await page.getByRole('button', { name: 'Telefon Karola' }).waitFor();
  step('SCENE_HOTSPOTS (biurko): „Dalej” nieaktywny przed drzwiami', (await nextDisabled()) && (await noInBlockNext()));
  await page.getByRole('button', { name: 'Telefon Karola' }).click();
  await dialog().getByRole('button', { name: 'Powiadomienia aplikacji' }).click();
  await dialog().getByText('Aplikacja uwierzytelniająca').waitFor();
  step('Telefon: zbliżenie powiadomień z warstwą tekstu (6 wierszy)', (await dialog().getByText(/Prośba o logowanie/).count()) === 6);
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  await dialog().getByRole('button', { name: 'Rejestr połączeń' }).click();
  await dialog().getByText('IT Helpdesk · 39 min').waitFor();
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  await dialog().getByRole('button', { name: 'Wróć' }).click();
  await closed();
  await counterIs(2, 16);
  step('Telefon (scena zagnieżdżona): seria MFA i rejestr połączeń w notatniku (2/16 - ukryte dowody poza sumą)', true, await counter());
  await page.getByRole('button', { name: 'Komputer' }).click();
  await dialog().getByRole('button', { name: 'Narzędzie zdalnej pomocy' }).click();
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  await dialog().getByRole('button', { name: 'Przeglądarka' }).click();
  await dialog().getByRole('button', { name: 'Odłóż' }).click();
  await dialog().getByRole('button', { name: 'Wróć' }).click();
  await closed();
  await counterIs(3, 16);
  step('Pulpit (scena zagnieżdżona): narzędzie zdalnej pomocy w notatniku (3/16), przeglądarka bez dowodu', true, await counter());
  await page.getByRole('button', { name: 'Karteczka' }).click();
  await take();
  await page.getByRole('button', { name: 'Plakat' }).click();
  await dialog().getByText('IT nigdy nie prosi o kody ani liczby z aplikacji').waitFor();
  await take();
  await page.getByRole('button', { name: 'Kubek' }).click();
  await putDown();
  await counterIs(5, 16);
  step('SCENE_HOTSPOTS (biurko): karteczka i plakat w notatniku (5/16), kubek bez dowodu', true, await counter());
  step('SCENE_HOTSPOTS (biurko): „Dalej” nieaktywny, dopóki gracz nie podejdzie do drzwi', await nextDisabled());
  await page.getByRole('button', { name: 'Do sali odsłuchu' }).click();
  await advanceUntil(page.getByTestId('call-recording'), 'odsłuch nagrania');
  step('SCENE_HOTSPOTS (biurko): drzwi aktywują „Dalej”, blok zapisany', true);

  // --- 3. Odsłuch nagrania (CALL_RECORDING, waga 2): 7 flag w transkrypcji, bez pudeł -> Perfect Pitch ------------------------
  await page.getByRole('tab', { name: 'Transkrypcja' }).click();
  for (const id of ['s1', 's3', 's4', 's6', 's7', 's9', 's11']) await page.getByTestId(`recording-segment-flag-${id}`).click();
  const recordingSaved = progressResponse();
  await page.getByTestId('recording-submit').click();
  const recordingBody = await (await recordingSaved).json();
  step('CALL_RECORDING: 7/7 flag bez fałszywych -> 100%', recordingBody.lastResult?.points === 1 && recordingBody.lastResult?.detail?.falseTaps === 0, JSON.stringify(recordingBody.lastResult?.detail));
  await page.getByTestId('call-recording-result').waitFor();
  await counterIs(7, 16);
  step('CALL_RECORDING: dowody z nagrania (liczba 47, prośba o instalację) w notatniku (7/16)', true, await counter());
  step('CALL_RECORDING: wynik bez własnego „Dalej”', await noInBlockNext());
  await advanceUntil(page.getByTestId('interrogation-block'), 'przesłuchanie Karola');

  // --- 4. Przesłuchanie Karola (INTERROGATION): dwa fragmenty do notatek, podważenie dowodem „liczba 47” ---------------------------
  const typingDone = () => page.waitForFunction(() => !document.querySelector('[data-testid="dialogue-typing"]'), null, { timeout: 30000 });
  const ask = async (question, lastLine) => {
    await typingDone();
    await page.getByRole('button', { name: question, exact: true }).click();
    await page.getByTestId('interrogation-line').filter({ hasText: lastLine }).waitFor({ timeout: 30000 });
    await typingDone();
  };
  const note = async (lineText) => {
    const line = page.getByTestId('interrogation-line').filter({ hasText: lineText });
    await line.click();
    await page.getByTestId('interrogation-actions').getByRole('button', { name: 'Dodaj do notatek' }).click();
    await line.getByText('W notatniku').waitFor();
  };
  await page.getByTestId('interrogation-thread').getByText('Myślałem, że pomagam. To był Paweł, znam jego głos.').waitFor();
  step('INTERROGATION (Karol): kwestia otwierająca przed pytaniami', true);
  await ask('Skąd wiedziałeś, że to Paweł?', 'Na wyświetlaczu było');
  await note('To był jego głos, na sto procent.');
  await ask('Czy podawałeś jakieś kody?', 'Telefon cały czas miałem przy sobie.');
  const lie = page.getByTestId('interrogation-line').filter({ hasText: 'Nie, żadnych kodów' });
  await lie.click();
  await page.getByRole('button', { name: 'Podważ', exact: true }).click();
  await page.getByTestId('interrogation-picker').waitFor();
  const challenged = page.waitForResponse((r) => r.url().includes('/challenge') && r.request().method() === 'POST');
  await page.getByTestId('interrogation-evidence').filter({ hasText: 'liczbę 47' }).click();
  const challengeBody = await (await challenged).json();
  await page.getByTestId('interrogation-admission').waitFor();
  step('INTERROGATION (Karol): podważenie dowodem „liczba 47” trafione, Karol się przyznaje', challengeBody.correct === true && (await page.getByText('Wpisałem liczbę, którą podał.', { exact: false }).count()) >= 1, JSON.stringify({ correct: challengeBody.correct }));
  await ask('Co o tobie wiedział?', 'Znał moje imię, dział, nazwisko kierownika.');
  await note('Znał moje imię, dział, nazwisko kierownika.');
  await ask('Jak zakończyła się rozmowa?', 'Kazał zrestartować komputer');
  await counterIs(10, 17);
  step('INTERROGATION (Karol): 2 fragmenty + przyznanie w notatniku (10/17 - obalona sprzeczność dolicza się do sumy)', true, await counter());
  await nextEnabled().waitFor();
  step('INTERROGATION (Karol): wymagane pytania zadane, „Dalej” aktywny, w bloku brak przycisku dalej', await noInBlockNext());
  const karolSaved = progressResponse();
  await nextEnabled().click();
  const karolBody = await (await karolSaved).json();
  step('INTERROGATION (Karol): sprzeczność obalona -> 100%', karolBody.lastResult?.points === 1, JSON.stringify(karolBody.lastResult?.points));
  await advanceUntil(page.getByTestId('interrogation-thread').getByText('Nie dzwoniłem do Karola. Byłem na szkoleniu do dziesiątej.'), 'przesłuchanie Pawła');

  // --- 5. Przesłuchanie Pawła i konsola (INTERROGATION, waga 0): 2 fragmenty, 4 ślady w konsoli ----------------------------------
  await ask('Gdzie byłeś rano?', 'Na szkoleniu poza biurem');
  await note('Na szkoleniu poza biurem');
  await ask('Czy system coś zgłaszał?', 'Był alert o seryjnie odrzucanych logowaniach');
  await note('Był alert o seryjnie odrzucanych logowaniach');
  await ask('Jak IT kontaktuje się z pracownikami?', 'Zawsze z wewnętrznego 214.');
  await typingDone();
  await page.getByRole('button', { name: 'Pokaż, co widać w konsoli.', exact: true }).click();
  const consolePanel = page.getByTestId('interrogation-console');
  await consolePanel.waitFor({ timeout: 30000 });
  for (const [tab, rowText] of [
    ['Logowania', 'Zatwierdzone logowanie, Amsterdam'],
    ['Reguły poczty', 'Przekaż kopię wszystkich wiadomości'],
    ['Programy', 'Narzędzie zdalnej pomocy - zainstalowane'],
    ['CRM', 'Klienci - pełna lista'],
  ]) {
    await consolePanel.getByRole('tab', { name: tab }).click();
    await consolePanel.locator('[data-testid="dossier-rows"] button').filter({ hasText: rowText }).click();
  }
  await consolePanel.getByText('Konsola przejrzana.').waitFor();
  await consolePanel.getByRole('button', { name: 'Zamknij konsolę' }).click();
  await counterIs(16, 17);
  step('INTERROGATION (Paweł): 2 fragmenty + 4 ślady z konsoli w notatniku (16/17)', true, await counter());
  await nextEnabled().waitFor();
  step('INTERROGATION (Paweł): „Dalej” aktywny po konsoli, w bloku brak przycisku dalej', await noInBlockNext());
  await advanceUntil(page.getByRole('button', { name: 'Połączenie 9:02 - „IT Helpdesk”' }), 'porównanie w rejestrze');

  // --- 6. Rejestr połączeń (SCENE_HOTSPOTS bez drzwi - „Dalej” po wymaganych) ---------------------------------------------------
  step(
    'SCENE_HOTSPOTS (rejestr): bez hotspotu przejścia (action: next), „Dalej” nieaktywny przed wymaganymi',
    blockOf('rejestr').hotspots.every((hotspot) => hotspot.action !== 'next') && (await nextDisabled()),
  );
  await page.getByRole('button', { name: 'Połączenie 9:02 - „IT Helpdesk”' }).click();
  await take();
  await page.getByRole('button', { name: 'Połączenie 10:15 - wewnętrzny 214' }).click();
  await putDown();
  await page.getByRole('button', { name: 'Karta intranetu' }).click();
  await putDown();
  await counterIs(17, 17);
  step('SCENE_HOTSPOTS (rejestr): numer zewnętrzny w notatniku (17/17)', true, await counter());
  await nextEnabled().waitFor();
  await advanceUntil(page.getByTestId('osint-frame'), 'OSINT');

  // --- 7. OSINT (OSINT_SPOT): 4 wykorzystane informacje, bez pułapek; webinar do końca -> Off the Record ------------------------
  for (const name of ['Paweł Nowicki, specjalista IT, helpdesk', 'Kierownik sprzedaży', 'Webinar: Bezpieczna praca zdalna', 'Kontakt: centrala i numery wewnętrzne']) {
    const spot = page.getByRole('button', { name, exact: true });
    await spot.scrollIntoViewIfNeeded();
    await spot.click();
    if ((await spot.getAttribute('aria-pressed')) !== 'true') throw new Error(`OSINT: obszar „${name}” nie zaznaczony`);
  }
  await page.getByTestId('osint-play').scrollIntoViewIfNeeded();
  await page.getByTestId('osint-play').click();
  const webinar = page.getByTestId('osint-player');
  await webinar.waitFor();
  // Webinar z nagraniem otwiera się na kadrze prelekcji - transkrypcję włącza przycisk „Transkrypcja”.
  await webinar.getByRole('button', { name: 'Transkrypcja', exact: true }).click();
  await page.getByTestId('osint-transcript').evaluate((region) => region.scrollTo({ top: region.scrollHeight }));
  await page.getByTestId('osint-secret-ending').waitFor({ timeout: 15000 });
  step('OSINT: webinar doczytany do końca - ukryte zakończenie', true);
  await webinar.getByRole('button', { name: 'Zamknij nagranie' }).click();
  const osintSaved = progressResponse();
  await nextEnabled().click();
  const osintBody = await (await osintSaved).json();
  step('OSINT: 4 wykorzystane informacje bez pułapek -> 100%', osintBody.lastResult?.points === 1, JSON.stringify(osintBody.lastResult?.points));
  await page.getByTestId('osint-summary').waitFor();
  await counterIs(EVIDENCE_TOTAL);
  step(`OSINT: 3 ukryte notatki ze strony w notatniku po ocenie (${EVIDENCE_TOTAL}/${EVIDENCE_TOTAL})`, true, await counter());
  await page.getByRole('button', { name: /^Notatnik/ }).click();
  step('OSINT: wyróżnienie „Off the Record” w notatniku', (await page.getByTestId('notebook-distinctions').textContent())?.includes('Off the Record'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="notes-drawer"][aria-hidden="true"]', { state: 'attached', timeout: 5000 });
  await advanceUntil(page.getByTestId('evidence-board'), 'tablica osi czasu');

  // --- 8. Tablica osi czasu (ORDERING, waga 2): 7 zdarzeń klawiaturą ----------------------------------------------------------
  step('ORDERING: tablica śledcza z numerem sprawy', (await page.getByRole('region', { name: 'Tablica śledcza · GZH/2026/1004' }).count()) === 1);
  const wanted = [
    'Oszust zbiera dane ze strony „Zespół” i z webinaru.',
    'Karol odrzuca sześć próśb o zatwierdzenie logowania.',
    'Telefon od „IT Helpdesk”.',
    'Karol wpisuje liczbę podaną przez dzwoniącego.',
    'Instalacja narzędzia zdalnej pomocy i ID sesji.',
    'Reguła przekierowania poczty i eksport z CRM.',
    'Karol dzwoni na wewnętrzny 214.',
  ];
  const tray = page.getByRole('group', { name: 'Ślady do przypięcia' });
  step('ORDERING: 7 śladów na tacce', (await tray.getByRole('button', { name: /^Ślad: / }).count()) === 7);
  for (const [index, text] of wanted.entries()) {
    const card = tray.getByRole('button', { name: `Ślad: ${text}` });
    await card.focus();
    await card.press('Enter');
    const slot = page.getByRole('button', { name: new RegExp(`^Pole ${index + 1}, puste`) });
    await slot.focus();
    await slot.press('Enter');
  }
  const orderingSaved = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź trop' }).click();
  const orderingBody = await (await orderingSaved).json();
  step('ORDERING: pełna poprawna kolejność (7/7) -> 100%', orderingBody.lastResult?.points === 1 && orderingBody.lastResult?.reaction?.text?.startsWith('Dokładnie tak.'), JSON.stringify(orderingBody.lastResult?.points));
  await page.locator('[data-testid="evidence-board"][data-phase="settled"]').waitFor();
  await advanceUntil(page.getByTestId('live-call-answer'), 'rozmowa na żywo');

  // --- 9. Rozmowa na żywo (LIVE_CALL): od razu „Oddzwonię…” -> dobre zakończenie w 1 kroku (Dead Air) ---------------------------
  step('LIVE_CALL: ekran przed połączeniem („Odbierz”), „Dalej” nieaktywny', (await page.getByTestId('live-call-answer').isVisible()) && (await nextDisabled()));
  await page.getByTestId('live-call-answer').click();
  await page.getByTestId('live-call-line').waitFor();
  await page.getByRole('button', { name: /Oddzwonię na numer helpdesku z intranetu/ }).click();
  await page.getByTestId('live-call-ending').waitFor({ timeout: 30000 });
  step('LIVE_CALL: dobre zakończenie (Paweł: „Nie dzwoniłem”)', ((await page.getByTestId('live-call-ending').textContent()) ?? '').includes('Nie dzwoniłem'));
  const liveSaved = progressResponse();
  await nextEnabled().click();
  const liveBody = await (await liveSaved).json();
  step('LIVE_CALL: zakończenie good bez oddanych informacji -> 100%', liveBody.lastResult?.points === 1 && liveBody.lastResult?.detail?.outcome === 'good', JSON.stringify(liveBody.lastResult?.detail));
  await page.getByTestId('live-call-outcome').waitFor();
  await advanceUntil(page.getByTestId('replay-card'), 'omówienie');

  // --- 10. Omówienie (ANNOTATED_REPLAY na transkrypcji): 6 znaczników ----------------------------------------------------------
  const markers = blockOf('omowienie').markers.length;
  step(`ANNOTATED_REPLAY: ${markers} znaczników, „Dalej” nieaktywny przed ostatnim`, (await page.locator('[data-testid^="replay-marker-"]').count()) === markers && (await nextDisabled()));
  for (let i = 1; i < markers; i++) await page.getByTestId('replay-next').click();
  await nextEnabled().waitFor();
  step('ANNOTATED_REPLAY: po ostatnim znaczniku „Dalej” aktywny', await noInBlockNext());
  await advanceUntil(page.getByTestId('case-evidence'), 'zamknięcie sprawy');

  // --- 11. Zamknięcie sprawy (SUMMARY) ------------------------------------------------------------------------------------------
  const summaryText = (await page.getByTestId('case-evidence').textContent()) ?? '';
  step(`SUMMARY: wszystkie dowody zebrane (${EVIDENCE_TOTAL} z ${EVIDENCE_TOTAL})`, summaryText.includes(`Zebrane dowody: ${EVIDENCE_TOTAL} z ${EVIDENCE_TOTAL}`), summaryText.slice(0, 120));
  step('SUMMARY: lista „Trzy rzeczy do zapamiętania”', (await page.locator('ol li', { hasText: 'Numer, nie głos.' }).count()) === 1);
  const completion = progressResponse();
  await bar().getByRole('button', { name: 'Zakończ sprawę' }).click();
  const completionBody = await (await completion).json();
  step('Kurs ukończony ze 100% wyniku', completionBody.status === 'COMPLETED' && completionBody.score === 100, JSON.stringify({ status: completionBody.status, score: completionBody.score }));
  // Off the Record przyznaje serwer przy zapisie bloku OSINT, bez XP i bez pozycji w odpowiedzi (jak Curious Detective w module 1) -
  // sprawdzamy go niżej na profilu.
  const live = [...liveBadges].sort();
  step(
    'Osiągnięcia na żywo przy ukończeniu: First Case Closed, Dead Air, Perfect Pitch, Full Transcript',
    JSON.stringify(live) === JSON.stringify(['dead-air', 'first-case-closed', 'full-transcript', 'perfect-pitch']),
    JSON.stringify(live),
  );

  await page.getByRole('heading', { level: 2, name: 'Sprawa zamknięta' }).waitFor();
  await page.locator('[data-testid="case-closed"][data-stage="sign"]').waitFor({ timeout: 20000 });
  const slotText = async (testId) => ((await page.getByTestId(testId).textContent()) ?? '').trim();
  step('Zamknięcie: nazwa modułu w raporcie', (await page.getByTestId('case-closed').getByText(MODULE_TITLE, { exact: true }).count()) >= 1);
  step(`Zamknięcie: dowody ${EVIDENCE_TOTAL}/${EVIDENCE_TOTAL}`, (await slotText('closing-evidence')) === `${EVIDENCE_TOTAL}/${EVIDENCE_TOTAL}`, await slotText('closing-evidence'));
  step('Zamknięcie: czas sprawy w minutach i +XP', /^\d+ min$/.test(await slotText('closing-time')) && /^\+[1-9]\d*$/.test(await slotText('closing-xp')), `${await slotText('closing-time')} | ${await slotText('closing-xp')}`);
  step('Zamknięcie: trzy wnioski', ((await slotText('closing-lessons')).match(/\d\. /g) ?? []).length === 3, await slotText('closing-lessons'));
  await page.getByRole('button', { name: 'Podpisz raport' }).click();
  await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor();
  step('Zamknięcie: pieczęć i liścik po podpisie', (await page.getByTestId('closing-stamp').count()) === 1 && (await page.getByTestId('closing-note').count()) === 1);
  step('Zamknięcie: „Wróć do biblioteki” tylko w pasku', (await noInBlockNext()) && (await bar().getByRole('link', { name: 'Wróć do biblioteki' }).getAttribute('href')) === '/courses');

  await page.goto(`${WEB}/courses/achievements`);
  await page.getByTestId('achievements-counter').waitFor();
  for (const name of ['First Case Closed', 'Dead Air', 'Perfect Pitch', 'Full Transcript', 'Off the Record']) {
    step(`Osiągnięcia: ${name} zdobyte na profilu`, (await page.getByRole('button', { name: new RegExp(`^${name} \\(\\w+\\), zdobyte`) }).count()) === 1);
  }
  step('Bez błędów strony, konsoli i odpowiedzi 5xx', problems.length === 0, problems.join(' | '));

  console.log(`\nWSZYSTKIE KROKI OK (${results.length})`);
} catch (error) {
  console.error(`\nBŁĄD: ${error.message}`);
  if (page) {
    console.error('--- URL w chwili błędu ---', page.url());
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
