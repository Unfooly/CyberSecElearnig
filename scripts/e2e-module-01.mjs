// E2E w przeglądarce (Playwright) — pełne przejście modułu 1 ("Sprawa: wyłudzone hasło", packages/content/modules/wyludzone-haslo)
// zaimportowanego PRAWDZIWYM CLI (apps/api/dist/scripts/content-import.js), nie ręcznie sklejoną treścią jak w scripts/e2e-registration.mjs.
// Cel: udowodnić, że treść modułu 1 (schemat v4: NARRATIVE, character.opening, reactions, email.to, markdown w TABS/SUMMARY) faktycznie
// działa w przeglądarce od importu do ukończenia kursu, nie tylko przechodzi parseModule.
//
// Rejestracja/aktywacja organizacji NIE jest tu powtarzana (pełna ścieżka: scripts/e2e-registration.mjs) - organizację i pracownika
// tworzymy wprost przez Prisma (ACTIVE, jak w istniejących testach e2e apps/api), żeby skupić się na odtwarzaczu.
//
// Wymaga zbudowanych pakietów: `npm run build --workspace=packages/content`, `--workspace=apps/api` (skrypt importuje treść
// przez skompilowany apps/api/dist/scripts/content-import.js i startuje API z apps/api/dist/main.js). Web NIE wymaga builda -
// startuje przez `next dev` (patrz komentarz przy jego uruchomieniu niżej), kompiluje z apps/web/src na bieżąco.
//
// Użycie z katalogu repo (dotenv-cli ładuje bazę i sekrety JWT z .env):
//   npx dotenv -e .env -- node scripts/e2e-module-01.mjs
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const DOMAIN = `module-01-e2e-${RUN}.test`;
const EMAIL = `pracownik@${DOMAIN}`;
const PASSWORD = 'E2e-Haslo-Testowe-1!';
const ORG_NAME = `Module 01 E2E ${RUN}`;

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
  child.stdout.on('data', (chunk) => (apiLog += chunk.toString()));
  child.stderr.on('data', (chunk) => (apiLog += chunk.toString()));
  return child;
}

let prisma;
let browser;
let page;
let orgId;
let courseId;
// Sprzątamy TYLKO kurs, który TEN przebieg naprawdę stworzył (importResult.courseCreated) - importModule robi upsert po
// slug, więc gdy developer wcześniej sam uruchomił `content:import` dla tego samego modułu, ten skrypt znajduje ISTNIEJĄCY
// kurs zamiast tworzyć nowy; bezwarunkowe kasowanie po id skasowałoby wtedy cudzy (nie-testowy) kurs z lokalnej bazy.
let courseCreatedByThisRun = false;
try {
  const apiEnv = { PORT: API_PORT, FRONTEND_URL: WEB, MAILERSEND_API_TOKEN: '', BACKGROUND_JOBS_ENABLED: 'false', NODE_ENV: 'development' };
  start('api', process.execPath, ['apps/api/dist/main.js'], apiEnv, process.cwd());
  // `next dev`, NIE `next start`: `next start` twardo ustawia NODE_ENV=production WEWNĄTRZ CLI (nie da się tego nadpisać
  // zmienną środowiskową procesu) - cookies (auth-cookies.ts) dostają wtedy Secure, którego przeglądarka nigdy nie wyśle
  // bez TLS (przechowuje, ale nie wysyła - stąd 401 na każdym żądaniu do BFF mimo poprawnego zalogowania; zweryfikowane
  // empirycznie). `next dev` kompiluje z apps/web/src na bieżąco (bez wymogu wcześniejszego `next build`), więc ten
  // skrypt zawsze testuje NAJNOWSZY kod, nie stary build .next. Skutek uboczny (CSP z unsafe-eval/WebSocket, D-053 pkt 5)
  // nie ma znaczenia: ten skrypt nie sprawdza nagłówków CSP (to robi scripts/e2e-registration.mjs).
  start(
    'web',
    process.execPath,
    [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', WEB_PORT],
    { API_URL: API },
    join(process.cwd(), 'apps', 'web'),
  );

  await waitFor(async () => (await fetch(`${API}/`)).status > 0, 'start API');
  await waitFor(async () => (await fetch(`${WEB}/`)).ok, 'start web');

  // Import PRAWDZIWEGO modułu przez PRAWDZIWY skrypt (ta sama ścieżka co produkcja - D-051 pkt 11), nie ręczna treść.
  // Skrypt jest CJS, a ten plik ESM: ścieżka z rozszerzeniem, eksport przez interop (jak w scripts/e2e-registration.mjs).
  const contentImport = await import('../apps/api/dist/scripts/content-import.js');
  prisma = new PrismaClient();
  const modules = await contentImport.loadModules(join(process.cwd(), 'packages', 'content', 'modules'));
  const wyludzoneHaslo = modules.find((m) => m.slug === 'wyludzone-haslo');
  step('content-import: moduł "wyludzone-haslo" wczytany i zwalidowany', !!wyludzoneHaslo, `${modules.length} modułów łącznie`);
  const importResult = await prisma.$transaction((tx) => contentImport.importModule(tx, wyludzoneHaslo));
  step('content-import: moduł zaimportowany do bazy (10 bloków)', importResult.courseId != null && importResult.slug === 'wyludzone-haslo', JSON.stringify(importResult));
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

  browser = await chromium.launch();
  page = await (await browser.newContext()).newPage();

  // 1. Logowanie -> pracownik ląduje na /courses (homePathForRole).
  await page.goto(`${WEB}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/courses');
  step('logowanie pracownika kieruje na /courses', true);

  await page.goto(`${WEB}/courses/${courseId}`);
  const progressResponse = () => page.waitForResponse((r) => r.url().includes(`/api/courses/${courseId}/progress`) && r.request().method() === 'POST');
  const nextEnabled = () => page.getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled'));
  // D-093: odtwarzacz nie pokazuje postaci - żadnego obrazka maskotki (alt ani plik z /mascot/).
  const noMascot = async () => (await page.getByAltText(/Maskotka/).count()) === 0 && (await page.locator('img[src*="/mascot/"]').count()) === 0;
  // reactions.complete (klient) może na chwilę "przegrać" wyścig z inną reakcją zdarzeniową (np. hints.notify('evidence') przy
  // ostatnim wymaganym elemencie, który JEST też dowodem - DialogueBlock.tsx/SceneHotspotsBlock.tsx) w tym samym cyklu renderowania:
  // druga reakcja (z useCompleteHint) nadpisuje pierwszą w KOLEJNYM, natychmiastowym cyklu efektów. getByText(...).waitFor()
  // (auto-retry Playwrighta) czeka na TEN docelowy tekst zamiast zgadywać z arbitralnym opóźnieniem.
  const reactionText = (text) => page.getByText(text, { exact: true }).waitFor();

  // Zbliżenie przedmiotu (D-086): klik w przedmiot -> kamera przybliża scenę (450 ms), nakładka role="dialog" z grafiką i
  // "Zabierz"/"Odłóż". "Zabierz" przy dowodzie dopisuje notatkę i odkłada przedmiot, "Odłóż" tylko odkłada; oddalenie trwa 350 ms -
  // czekamy, aż nakładka zniknie, zanim klikniemy kolejny przedmiot (zasłania scenę, tak jak dla prawdziwego użytkownika).
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

  // --- Blok 0: Odprawa (BRIEFING, D-081/D-084/D-086) -----------------------------------------------------------------------
  // Moduł zaczyna się od odprawy: cztery kroki (sceny), "Pomiń odprawę" w górnym pasku widoczny od razu, bez "Dalej". Bez przycisków
  // cta - postęp WYŁĄCZNIE klikiem w przedmiot kroku.
  await page.getByRole('button', { name: 'Odbierz telefon' }).waitFor();
  step('BRIEFING: "Pomiń odprawę" w górnym pasku od razu, bez "Dalej" w dolnym', (await page.getByRole('button', { name: 'Pomiń odprawę' }).count()) === 1 && (await page.getByRole('button', { name: 'Dalej', exact: true }).count()) === 0);
  step('BRIEFING: odprawa jako scena z grafiką, jedynym przyciskiem kroku jest przedmiot (telefon)', (await page.locator('[data-testid="briefing-block"][data-scene="true"]').count()) === 1 && (await page.getByRole('button', { name: 'Odbierz telefon' }).count()) === 1);
  step('BRIEFING: krok 0 - "Wtorek, 9:40. Wydział Cyberbezpieczeństwa, Kraków."', (await page.getByText(/Wtorek, 9:40\. Wydział Cyberbezpieczeństwa, Kraków\. Dzwoni telefon służbowy\./).count()) >= 1);
  await briefingItem('Odbierz telefon');
  step('BRIEFING: dzwoni komisarz - dymek w scenie, bez maskotki', (await page.getByTestId('briefing-bubble').getByText('Komisarz Adam Wolski').count()) === 1 && (await noMascot()));
  await briefingItem('Rozłącz');
  // Karta sprawy w dwóch fazach: zamknięta teczka ("Otwórz teczkę") -> akta z zadaniami w slocie; klik w akta zamyka teczkę.
  await page.getByRole('button', { name: 'Otwórz teczkę' }).waitFor();
  step('BRIEFING: zamknięta teczka, dane karty dla czytnika (CS/2026/0915)', (await page.getByTestId('briefing-scene').getAttribute('data-phase')) === 'closed' && (await page.getByText(/CS\/2026\/0915/).count()) === 1);
  await briefingItem('Otwórz teczkę');
  step('BRIEFING: akta z listą 3 zadań w slocie', (await page.getByTestId('briefing-slot-tasks').getByRole('listitem').count()) === 3);
  await briefingItem('Zamknij teczkę');
  // Legitymacja: imię wyłącznie z danych sesji (konto testowe bez imienia -> z e-maila), numer odznaki z numeru sprawy.
  await page.getByTestId('briefing-slot-number').waitFor();
  step('BRIEFING: legitymacja z numerem odznaki 0915-* w slocie', /^0915-/.test((await page.getByTestId('briefing-slot-number').textContent()) ?? ''));
  const briefingSaved = progressResponse();
  await briefingItem('Zabierz legitymację');
  step('BRIEFING: klik w legitymację (ostatni krok) zapisuje blok', (await briefingSaved).ok());

  // --- Blok 1: Korytarz (SCENE_HOTSPOTS: tablica - dowód opcjonalny, drzwi) - B-086/D-071/D-086 -----------------------------
  await page.getByRole('button', { name: 'Drzwi do księgowości' }).waitFor();
  step('SCENE_HOTSPOTS (korytarz): brak "Dalej" w pasku - jedynym wyjściem są drzwi (hideForward)', (await page.getByRole('button', { name: 'Dalej', exact: true }).count()) === 0);
  await page.getByRole('button', { name: 'Tablica ogłoszeń' }).click();
  await dialog().getByRole('img', { name: /hasła - nie na karteczkach/ }).waitFor();
  step('SCENE_HOTSPOTS (korytarz): zbliżenie tablicy (grafika, Zabierz/Odłóż)', (await dialog().getByRole('button', { name: 'Zabierz' }).count()) === 1 && (await dialog().getByRole('button', { name: 'Odłóż' }).count()) === 1);
  await take();
  step('SCENE_HOTSPOTS (korytarz): tablica w notatniku (dowód 1)', (await page.getByTestId('evidence-counter').textContent())?.includes('Dowody 1/23'), await page.getByTestId('evidence-counter').textContent());
  // Tablica jest opcjonalna (required:false) - drzwi są gotowe od razu; klik kończy blok (jak "Dalej").
  await page.getByRole('button', { name: 'Drzwi do księgowości' }).click();
  step('SCENE_HOTSPOTS (korytarz): "drzwi" kończą blok', true);

  // --- Blok 2: Biuro Anny (SCENE_HOTSPOTS, media w hotspotach + zagnieżdżona scena "pulpit") - B-086/D-071/D-086 -------------
  await page.getByRole('button', { name: 'Żółta karteczka' }).waitFor();
  // Dowód zalicza WYŁĄCZNIE "Zabierz" w zbliżeniu - jednolicie, także dla przedmiotów z nagraniem.
  for (const label of ['Żółta karteczka', 'Telefon stacjonarny', 'Kalendarz ścienny']) {
    await page.getByRole('button', { name: label }).click();
    await take();
  }

  // "Monitor" jest 4. i ostatnim wymaganym punktem - zbliżenie przechodzi w zagnieżdżoną scenę "pulpit" (bez własnego dowodu,
  // bez Zabierz/Odłóż - ikona "Wróć"). reactions.complete odpala się od razu po tym kliku.
  await page.getByRole('button', { name: 'Monitor' }).click();
  await reactionText('Cztery ślady. Teraz porozmawiajmy z Anną.');
  step('SCENE_HOTSPOTS: reactions.complete po wymaganych 4 punktach', true);
  step('SCENE_HOTSPOTS: "drzwi" chowa "Dalej" z paska nawet gdy ready (hideForward)', (await page.getByRole('button', { name: 'Dalej', exact: true }).count()) === 0);

  // Prawdziwy dowód maila jest dopiero za Pocztą wewnątrz zagnieżdżonej sceny "pulpit" - "Zabierz" w jej zbliżeniu go zalicza.
  await dialog().getByRole('button', { name: 'Poczta' }).click();
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  step('SCENE_HOTSPOTS: zagnieżdżona scena "pulpit" - dowód z przedmiotu "Poczta" (media image, B-086/D-071)', true);
  // Ikona "Internet" na pulpicie (feat/browser-evidence): zbliżenie historii przeglądarki, dowód niewymagany.
  await dialog().getByRole('button', { name: 'Internet' }).click();
  await dialog().getByRole('img', { name: /bankwektor-weryfikacja\.pl\/login/ }).waitFor();
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  // Tablica 1 + karteczka, telefon, kalendarz 3 + Poczta 1 + historia przeglądarki 1 = 6.
  await page.waitForFunction(() => document.querySelector('[data-testid="evidence-counter"]')?.textContent?.includes('Dowody 6/23'));
  step('SCENE_HOTSPOTS: pulpit - dowód z historii przeglądarki (Internet, 8:58 bankwektor-weryfikacja.pl/login)', true);
  await dialog().getByRole('button', { name: 'Wróć' }).click(); // pulpit -> zamyka nakładkę
  await closed();

  await page.getByRole('button', { name: 'Drukarka' }).click();
  await take();
  step('SCENE_HOTSPOTS: 7 dowodów w notatniku (tablica + 6 z biura, kubek bez dowodu)', (await page.getByTestId('evidence-counter').textContent())?.includes('Dowody 7/23'), await page.getByTestId('evidence-counter').textContent());
  // Kubek nie jest dowodem: "Zabierz" = potrząśnięcie i toast, bez notatki.
  await page.getByRole('button', { name: 'Kubek z kawą' }).click();
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  await dialog().getByRole('status').getByText('To nie jest dowód w tej sprawie.').waitFor();
  step('SCENE_HOTSPOTS: "Zabierz" przy kubku - toast "To nie jest dowód w tej sprawie.", licznik bez zmian', (await page.getByTestId('evidence-counter').textContent())?.includes('Dowody 7/'));
  await putDown();

  // "drzwi" (action:'next', label "Wyjście") kończy blok jak "Dalej" w pasku (który jest ukryty - patrz krok wyżej):
  // gotowe od razu, bo wymagane 4 są już odwiedzone.
  await page.getByRole('button', { name: 'Wyjście' }).click();
  step('SCENE_HOTSPOTS: "drzwi" (Wyjście) kończy blok zamiast "Dalej"', true);

  // --- Blok 3: Rozmowa z Anną (DIALOGUE) ---------------------------------------------------------------------------------
  // Komunikator (D-087): rozmówca "pisze" (wskaźnik), potem kwestia; data-typing na wątku mówi, czy ktoś właśnie pisze.
  const chatIdle = () => page.locator('[role="log"][data-typing="false"]').waitFor();
  await page.getByText('Ja naprawdę nic nie zrobiłam').waitFor();
  step('DIALOGUE: character.opening pokazuje się przed jakimkolwiek pytaniem', true);
  step('DIALOGUE: bez przycisku "Następna kwestia"', (await page.getByRole('button', { name: 'Następna kwestia' }).count()) === 0);
  const askAll = async (questions) => {
    for (const text of questions) {
      await chatIdle();
      await page.getByRole('button', { name: text, exact: true }).click();
      await chatIdle();
    }
  };
  await askAll(['Opowiedz o tym mailu z banku.', 'Kto dzwonił o 9:05?', 'To hasło na karteczce…']);
  await reactionText('Hasło, kod SMS, presja czasu. Trzy rzeczy, których prawdziwy bank nigdy nie połączy w jednej rozmowie. Zobaczmy ten mail.');
  step('DIALOGUE (Anna): reactions.complete po 3 wymaganych pytaniach', true);
  await askAll(['Dlaczego działałaś tak szybko?', 'Pomyślałaś, żeby to komuś zgłosić?']);
  await nextEnabled().click();

  // --- Blok 4: Ten mail (EMAIL_ANALYSIS, waga 3) -------------------------------------------------------------------------
  await page.getByTestId('mail-client').waitFor();
  step('EMAIL_ANALYSIS: adresat "Do:" (schemaVersion 4, email.to) w makiecie', (await page.getByTestId('mail-client').textContent())?.includes('a.kowalska@unfooly.com'));
  // Fragmenty maila są prawdziwymi <button>-ami inline (aria-pressed) - klikamy bezpośrednio, bez osobnej "Listy
  // elementów (dla klawiatury)" (usunięta, feedback z produkcji). "presja" (groźba blokady) NIE ma fragmentu w treści
  // (nie sąsiaduje z licznikiem "Pozostało: 01:12:33", który dostał WŁASNE, anchorowalne kryterium "odliczanie") -
  // jedyna droga do zaznaczenia go to lista pod mailem, teraz pokazująca wyłącznie kryteria bez fragmentu.
  const mail = page.getByTestId('mail-client');
  await mail.getByRole('button', { name: /Dział Bezpieczeństwa/ }).click(); // domena (nadawca)
  await mail.getByRole('button', { name: 'Przejdź do weryfikacji' }).click(); // link
  await mail.getByRole('button', { name: /Załącznik: Regulamin_weryfikacji\.pdf\.exe/ }).click(); // zalacznik
  await mail.getByRole('button', { name: 'Pozostało: 01:12:33' }).click(); // odliczanie
  await mail.getByRole('button', { name: 'Szanowna Kliencie' }).click(); // zwrot
  await page.getByRole('group', { name: /Inne elementy/ }).getByRole('checkbox', { name: /Groźba zablokowania/ }).check(); // presja
  const emailAnswered = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź odpowiedź' }).click();
  const emailBody = await (await emailAnswered).json();
  // D-096: reakcja to sam tekst (bez pose).
  step(
    'EMAIL_ANALYSIS: wszystkie 6 poprawnych kryteriów -> 100%, reakcja na wynik (bez pose)',
    emailBody.lastResult?.points === 1 && emailBody.lastResult?.reaction?.text === 'Czytasz maile jak detektyw.' && emailBody.lastResult?.reaction?.pose === undefined,
    JSON.stringify(emailBody.lastResult),
  );
  await page.getByText(/Wynik: 100%/).waitFor();
  await nextEnabled().click();

  // --- Blok 5: Teczka sprawy (DOSSIER, D-083) -----------------------------------------------------------------------------
  // Zwykła linijka: komunikat bez zaznaczenia; wiersze-dowody: zakreślenie = notatka + licznik. Wymagane: 3 z 5 (✱), zbieramy wszystkie 5.
  await page.getByRole('tablist', { name: 'Dokumenty w teczce' }).waitFor();
  const row = (text) => page.getByRole('button', { name: new RegExp(text) });
  await row('Opłata za prowadzenie rachunku').click();
  step('DOSSIER: zwykła linijka - komunikat, bez zaznaczenia', (await page.getByRole('status').textContent())?.includes('Ta linijka wygląda na zwykłą operację.') && (await row('Opłata za prowadzenie rachunku').getAttribute('aria-pressed')) === 'false');
  step('DOSSIER: "Dalej" nieaktywne przed wymaganymi', (await nextEnabled().count()) === 0);
  // Przelew 9:12 zna gracz z odprawy - zwykła linijka z własnym komunikatem (`message`), dowodem jest nowy odbiorca 9:04.
  await row('Przelew: Wektor Rozliczenia').click();
  step('DOSSIER: przelew 9:12 - własny komunikat, bez zaznaczenia', (await page.getByRole('status').textContent())?.includes('Ten przelew już znasz.') && (await row('Przelew: Wektor Rozliczenia').getAttribute('aria-pressed')) === 'false');
  await row('Dodano nowego odbiorcę').click();
  step('DOSSIER: wiersz-dowód zakreślony (aria-pressed)', (await row('Dodano nowego odbiorcę').getAttribute('aria-pressed')) === 'true');
  await page.getByRole('tab', { name: 'Logi logowania' }).click();
  // 09:02 (fix/login-2fa-timeline): SMS z kodem logowania - zwykły wiersz z własnym komunikatem, NIE dowód.
  await row('Wysłano SMS: kod logowania').click();
  step(
    'DOSSIER: 09:02 SMS z kodem logowania - własny komunikat, bez zaznaczenia (nie dowód)',
    (await page.getByRole('status').textContent())?.includes('Bank wysłał Annie kod do logowania') && (await row('Wysłano SMS: kod logowania').getAttribute('aria-pressed')) === 'false',
  );
  step('DOSSIER: 09:03 - logowanie z poprawnym kodem SMS', (await row('Logowanie, kod SMS poprawny').filter({ hasText: '09:03' }).count()) === 1);
  await row('Logowanie').filter({ hasText: '09:03' }).click();
  // row() buduje regex - fragment bez nawiasów z etykiety „Kod SMS (autoryzacja przelewu) wpisany”.
  await row('autoryzacja przelewu').click();
  await page.getByRole('tab', { name: 'Notatka IT' }).click();
  await row('Nagłówki maila').click();
  await row('zarejestrowana 2 dni przed atakiem').click();
  await page.getByRole('tab', { name: 'Procedury' }).click();
  step('DOSSIER: procedury z dawnych akt (zdanie o przycisku "Zgłoś podejrzany mail")', (await row('Zgłoś podejrzany mail').count()) === 1);
  step('DOSSIER: licznik 5 dowodów z teczki (razem 20 po korytarzu, biurze, rozmowie z Anną, mailu i teczce)', (await page.getByTestId('evidence-counter').textContent())?.includes('Dowody 20/23'), await page.getByTestId('evidence-counter').textContent());
  await nextEnabled().click();

  // --- Blok 6: Rozmowa z Markiem z IT (DIALOGUE) ---------------------------------------------------------------------------
  await page.getByText('Nie mów mi, że karteczka').waitFor();
  await askAll(['Co mówią logi banku?', 'Ktoś z IT dzwonił do Anny o 9:05?']);
  await reactionText('Masz już wszystko. Ułóżmy to w kolejności.');
  step('DIALOGUE (Marek): reactions.complete po 2 wymaganych pytaniach', true);
  await askAll(['Czy ktoś jeszcze dostał ten mail?', 'Co robimy teraz?']);
  await nextEnabled().click();

  // --- Blok 7: Rekonstrukcja zdarzeń (ORDERING, waga 2) --------------------------------------------------------------------
  // Tablica śledcza (D-088): ślady z tacki na pola 1..6 - klawiaturą (Enter na śladzie, Enter na polu), jak gracz bez myszy.
  await page.getByTestId('evidence-board').waitFor();
  step('ORDERING: tablica śledcza z numerem sprawy i zdjęciami początku/końca', (await page.getByRole('region', { name: 'Tablica śledcza · CS/2026/0915' }).count()) === 1 && (await page.getByText('−14 000 zł').count()) === 1);
  // Bez godzin w treści (usunięte z module.json) - z samymi godzinami układanie kolejności byłoby odczytem zegara,
  // nie rekonstrukcją zdarzeń.
  const wanted = [
    'Do skrzynki Anny trafia mail z domeny bankwektor-weryfikacja.pl.',
    'Anna wpisuje login, hasło i kod z SMS na fałszywej stronie.',
    'Oszust loguje się do prawdziwego banku danymi Anny.',
    '„Informatyk” dzwoni po kod SMS, żeby anulować operację.',
    'Anna podaje kod; oszust zatwierdza przelew.',
    '14 000 zł wychodzi na konto „Wektor Rozliczenia”.',
  ];
  const boardTray = page.getByRole('group', { name: 'Ślady do przypięcia' });
  step('ORDERING: 6 śladów na tacce, bez "Sprawdź trop" przed zapełnieniem', (await boardTray.getByRole('button', { name: /^Ślad: / }).count()) === 6 && (await page.getByRole('button', { name: 'Sprawdź trop' }).count()) === 0);
  for (const [index, text] of wanted.entries()) {
    const card = boardTray.getByRole('button', { name: `Ślad: ${text}` });
    await card.focus();
    await card.press('Enter');
    const slot = page.getByRole('button', { name: new RegExp(`^Pole ${index + 1}, puste`) });
    await slot.focus();
    await slot.press('Enter');
  }
  step('ORDERING: pełna tablica - nić ciągła, "Sprawdź trop" widoczne', (await page.locator('[data-yarn="dashed"]').count()) === 0 && (await page.getByRole('button', { name: 'Sprawdź trop' }).count()) === 1);
  const orderingAnswered = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź trop' }).click();
  const orderingBody = await (await orderingAnswered).json();
  step(
    'ORDERING: pełna poprawna kolejność (6/6) -> reakcja na wynik (bez pose)',
    orderingBody.lastResult?.points === 1 && orderingBody.lastResult?.reaction?.text?.startsWith('Dokładnie tak.') && orderingBody.lastResult?.reaction?.pose === undefined,
    JSON.stringify(orderingBody.lastResult),
  );
  await page.locator('[data-testid="evidence-board"][data-phase="settled"]').waitFor();
  step('ORDERING: po sprawdzeniu 6 zielonych pinezek i zdanie pod tablicą (bez listy "Poprawna kolejność")', (await page.locator('.board-pin--good').count()) === 6 && ((await page.getByTestId('board-feedback').textContent()) ?? '').length > 0 && (await page.getByRole('region', { name: 'Poprawna kolejność' }).count()) === 0);
  await nextEnabled().click();

  // --- Blok 8: Ostatnie pytanie (TEXT_INPUT_GUIDED, waga 1) ----------------------------------------------------------------
  await page.getByLabel('Wpisz domenę, z której przyszedł fałszywy mail (samą domenę, bez https:// i bez adresu e-mail).').waitFor();
  await page.getByLabel('Wpisz domenę, z której przyszedł fałszywy mail (samą domenę, bez https:// i bez adresu e-mail).').fill('bankwektor-weryfikacja.pl');
  await page.getByRole('button', { name: 'Sprawdź' }).click();
  await page.getByText(/Poprawna odpowiedź!/).waitFor();
  step('TEXT_INPUT_GUIDED: poprawna odpowiedź za pierwszym razem -> reakcja „Domena, nie napis”', (await page.getByText('To jest to. Domena, nie napis.').count()) === 1);
  // Wynik już jest widoczny w bloku (TextInputBlock, stan `done`): jedyny klik to "Dalej" pod wynikiem, który zapisuje
  // postęp I OD RAZU przechodzi dalej, bez osobnego ekranu "Blok ukończony." (isExploratory/TEXT_INPUT_GUIDED,
  // CoursePlayer.tsx::handleAnswer) - ten sam label co "Dalej" (nieaktywne) w pasku powłoki, stąd nextEnabled()
  // (wybiera włączony przycisk, pierwszy w DOM).
  const textDone = progressResponse();
  await nextEnabled().click();
  const textBody = await (await textDone).json();
  step('TEXT_INPUT_GUIDED: pełne punkty za pierwszą próbę (bez kary)', textBody.lastResult?.points === 1, JSON.stringify(textBody.lastResult?.points));

  // --- Blok 9: Rozwiązanie sprawy (SUMMARY) --------------------------------------------------------------------------------
  await page.getByTestId('case-evidence').waitFor();
  const summaryText = (await page.getByTestId('case-evidence').textContent()) ?? '';
  step('SUMMARY: wszystkie 23 dowody zebrane (1+6+4+4+5+3)', summaryText.includes('Zebrane dowody: 23 z 23'), summaryText.slice(0, 120));
  step('SUMMARY: numerowana lista "Trzy rzeczy do zapamiętania" renderuje się jako <ol>', (await page.locator('ol li', { hasText: 'Domena, nie napis.' }).count()) === 1);
  step(
    'SUMMARY: podpowiedź z treści ("Sprawa zamknięta..."), bez maskotki (D-093)',
    (await page.getByText('Sprawa zamknięta. Dobra robota, detektywie.', { exact: true }).count()) === 1 && (await noMascot()),
  );

  const completion = progressResponse();
  await page.getByRole('button', { name: 'Zakończ sprawę' }).click();
  const completionBody = await (await completion).json();
  // score to skala 0-100 (progress.ts computeScore: Math.round((weighted/total)*100)), nie ułamek 0-1.
  step('Kurs ukończony po stronie serwera ze 100% wyniku (3+2+1 wag, wszystko poprawne)', completionBody.status === 'COMPLETED' && completionBody.score === 100, JSON.stringify({ status: completionBody.status, score: completionBody.score }));

  // --- Zamknięcie sprawy (feat/case-closed, D-089): zapis kończący kurs OD RAZU przełącza na raport końcowy (bez ekranu pośredniego
  // "Blok ukończony."/"Zobacz podsumowanie"); ceremonia: liczby, wnioski, podpis, pieczęć, liścik ---------------------------------
  await page.getByRole('heading', { level: 2, name: 'Sprawa zamknięta' }).waitFor();
  step('Zamknięcie: brak przycisku "Zobacz podsumowanie" (ekran pośredni usunięty)', (await page.getByRole('button', { name: 'Zobacz podsumowanie' }).count()) === 0);
  step('Zamknięcie: "Wynik zadań: 100%" widoczny od razu', ((await page.getByText(/Wynik zadań:/).textContent()) ?? '').includes('100%'));
  await page.locator('[data-testid="case-closed"][data-stage="sign"]').waitFor({ timeout: 20000 });
  const slotText = async (testId) => ((await page.getByTestId(testId).textContent()) ?? '').trim();
  step('Zamknięcie: dowody 23/23 w raporcie', (await slotText('closing-evidence')) === '23/23', await slotText('closing-evidence'));
  // startedAt (nowa kolumna przypisania) -> czas sprawy w minutach; pierwsze ukończenie dolicza XP (COURSE_COMPLETION_XP >= 100).
  step('Zamknięcie: czas sprawy w minutach (startedAt z /start)', /^\d+ min$/.test(await slotText('closing-time')), await slotText('closing-time'));
  step('Zamknięcie: +XP w raporcie', /^\+[1-9]\d*$/.test(await slotText('closing-xp')), await slotText('closing-xp'));
  step('Zamknięcie: trzy wnioski śledczego wpisane', ((await slotText('closing-lessons')).match(/\d\. /g) ?? []).length === 3, await slotText('closing-lessons'));
  await page.getByRole('button', { name: 'Podpisz raport' }).click();
  await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor();
  step('Zamknięcie: po podpisie pieczęć i liścik, bez modala (role=dialog)', (await page.getByTestId('closing-stamp').count()) === 1 && (await page.getByTestId('closing-note').count()) === 1 && (await page.getByRole('dialog').count()) === 0);
  step('Zamknięcie: "Następna sprawa" zamknięta (wkrótce)', (await page.getByRole('button', { name: /Następna sprawa/ }).getAttribute('aria-disabled')) === 'true');

  // Powrót do ukończonego kursu: stan końcowy od razu (bez ceremonii), czas sprawy nadal znany (startedAt/completedAt z /start).
  await page.reload();
  await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor();
  step('Zamknięcie po odświeżeniu: stan końcowy od razu, czas sprawy z /start', /^\d+ min$/.test(await slotText('closing-time')), await slotText('closing-time'));

  console.log(`\nWSZYSTKIE KROKI OK (${results.length})`);
} catch (error) {
  console.error(`\nBŁĄD: ${error.message}`);
  if (page) {
    console.error('--- URL w chwili błędu ---', page.url());
    console.error('--- treść strony (pierwsze 2000 znaków) ---\n' + (await page.locator('body').innerText().catch(() => '(brak)')).slice(0, 2000));
  }
  console.error('--- ostatnie logi API/web ---\n' + apiLog.split('\n').slice(-40).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  try {
    prisma ??= new PrismaClient();
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    // Kurs po organizacji (przypisania znikają kaskadowo z organizacją; kurs z przypisaniami jest chroniony - RESTRICT, B-032).
    // TYLKO gdy ten przebieg go stworzył (courseCreatedByThisRun) - inaczej to cudzy, wcześniej zaimportowany kurs (patrz
    // deklaracja courseCreatedByThisRun wyżej), którego ten skrypt nie ma prawa skasować.
    if (courseId && courseCreatedByThisRun) await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  } catch (error) {
    console.error('Sprzątanie bazy nie powiodło się:', error.message);
  }
}
