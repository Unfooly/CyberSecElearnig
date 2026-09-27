// Zrzuty ekranu pełnego przejścia modułu treści, w dwóch rozdzielczościach (desktop 1440x900, mobile 390x844) -
// jednorazowe narzędzie operatorskie do raportów/opisów PR, NIE część CI. Użycie: `node scripts/screenshot-module.mjs
// [slug]` (domyślnie `wyludzone-haslo` - moduł 1). Zrzuty trafiają do `docs/brand/screens/<slug>/` (poza gitem -
// `.gitignore`), jak reszta `docs/brand/screens/`.
//
// UWAGA: kroki interakcji (selektory, teksty pytań/kryteriów/kolejności) są dziś SPECYFICZNE dla modułu 1 - jedynej
// prawdziwej treści w repo. Dla kolejnego modułu trzeba będzie zaktualizować sekcje 1-8 pod jego treść (inny slug w
// argumencie nie wystarczy sam z siebie) - ten skrypt generalizuje tylko nazwę pliku/argument/katalog wyjściowy,
// żeby nie mnożyć plików `screenshot-module-01.mjs`, `screenshot-module-02.mjs` itd.
//
// Struktura skopiowana z scripts/e2e-module-01.mjs (import przez prawdziwy content-import, next dev zamiast next start
// z tego samego powodu co tam - cookies Secure blokują BFF pod next start). Zamiast asercji: page.screenshot() w 6
// ustalonych momentach (feedback z produkcji po PR #32: korytarz, karteczka/telefon/pulpit/mail w nakładce NA scenie,
// kryterium "odliczanie" zaznaczone w EMAIL_ANALYSIS), dla dwóch niezależnych przebiegów (osobna organizacja/
// pracownik na viewport), żeby uniknąć przełączania rozmiaru okna w trakcie płynięcia bloków. Kurs jest mimo to
// przechodzony DO KOŃCA (nie tylko do ostatniego zrzutu) - kolejne bloki bez zdjęcia trzeba i tak ukończyć.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SLUG = process.argv[2] ?? 'wyludzone-haslo';
const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const PASSWORD = 'E2e-Haslo-Testowe-1!';
const OUT_DIR = join(process.cwd(), 'docs', 'brand', 'screens', SLUG);

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const children = [];
let apiLog = '';

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
const orgIds = [];
const courseCreatedIds = new Set();
let courseId;

async function shot(page, name, viewportName) {
  const path = join(OUT_DIR, `${name}-${viewportName}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`shot: ${path}`);
}

async function runViewport(viewport) {
  const domain = `screenshots-${SLUG}-${viewport.name}-${RUN}.test`;
  const email = `pracownik@${domain}`;
  const orgName = `Screenshots ${SLUG} ${viewport.name} ${RUN}`;

  const org = await prisma.organization.create({ data: { name: orgName, status: 'ACTIVE' } });
  orgIds.push(org.id);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    return tx.user.create({ data: { organizationId: org.id, email, passwordHash, role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    await tx.courseAssignment.create({ data: { organizationId: org.id, userId: user.id, courseId } });
  });

  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();

  const progressResponse = () => page.waitForResponse((r) => r.url().includes(`/api/courses/${courseId}/progress`) && r.request().method() === 'POST');
  const nextEnabled = () => page.getByRole('button', { name: 'Dalej', exact: true }).and(page.locator(':enabled'));
  const reactionText = (text) => page.getByText(text, { exact: true }).waitFor();

  await page.goto(`${WEB}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/courses');

  await page.goto(`${WEB}/courses/${courseId}`);

  // Zbliżenie przedmiotu (D-086): nakładka role="dialog" NA scenie, "Zabierz"/"Odłóż"; kamera 450 ms w, 350 ms z powrotem.
  const dialog = () => page.getByRole('dialog');
  const closed = () => page.getByTestId('scene-zoom').waitFor({ state: 'detached' });
  const opened = () => page.locator('[data-testid="scene-zoom"][data-phase$="open"]').waitFor();
  const take = async () => {
    await dialog().getByRole('button', { name: 'Zabierz' }).click();
    await closed();
  };

  // --- 0. Odprawa (BRIEFING, D-081/D-084/D-086) - każdy krok osobno, postęp klikiem w przedmiot ------------------------------
  await page.getByRole('button', { name: 'Odbierz telefon' }).waitFor();
  await page.waitForTimeout(2500); // maszyna do pisania dopisuje tekst
  await shot(page, '00a-odprawa-telefon', viewport.name);
  await page.getByRole('button', { name: 'Odbierz telefon' }).click();
  await shot(page, '00b-odprawa-komisarz', viewport.name); // komisarz Adam Wolski (postać, bez maskotki)
  await page.getByRole('button', { name: 'Rozłącz' }).click();
  // Karta sprawy w dwóch fazach (D-084): zamknięta teczka, klik w teczkę na scenie -> akta z zadaniami (crossfade).
  await page.getByRole('button', { name: 'Otwórz teczkę' }).waitFor();
  await shot(page, '00c-odprawa-teczka', viewport.name);
  await page.getByRole('button', { name: 'Otwórz teczkę' }).click();
  await page.waitForTimeout(700);
  await shot(page, '00d-odprawa-akta', viewport.name);
  await page.getByRole('button', { name: 'Zamknij teczkę' }).click();
  await page.waitForTimeout(600);
  await shot(page, '00e-odprawa-legitymacja', viewport.name);
  await page.getByRole('button', { name: 'Zabierz legitymację' }).click();

  // --- 1. Korytarz (SCENE_HOTSPOTS: tablica + drzwi, B-086/D-071/D-086) ------------------------------------------------------
  await page.getByRole('button', { name: 'Drzwi do księgowości' }).waitFor();
  await shot(page, '01-korytarz', viewport.name);
  await page.getByRole('button', { name: 'Tablica ogłoszeń' }).click();
  await opened();
  await shot(page, '01b-korytarz-tablica-zoom', viewport.name);
  await take();
  await page.getByRole('button', { name: 'Drzwi do księgowości' }).click();

  // --- 2. Biuro Anny: karteczka - zbliżenie NA scenie ---------------------------------------------------------------------
  await page.getByRole('button', { name: 'Żółta karteczka' }).waitFor();
  await page.getByRole('button', { name: 'Żółta karteczka' }).click();
  await opened();
  await shot(page, '02-biuro-karteczka-zoom', viewport.name);
  await take();

  // --- 3. Biuro Anny: telefon - zbliżenie z play/pauzą ------------------------------------------------------------------
  await page.getByRole('button', { name: 'Telefon stacjonarny' }).click();
  await opened();
  await shot(page, '03-biuro-telefon-audio', viewport.name);
  await take();

  await page.getByRole('button', { name: 'Kalendarz ścienny' }).click();
  await take();

  // --- 4. Biuro Anny: monitor -> zagnieżdżona scena "pulpit" (B-086/D-071) ---------------------------------------------
  await page.getByRole('button', { name: 'Monitor' }).click();
  await reactionText('Cztery ślady. Teraz porozmawiajmy z Anną.');
  await opened();
  await shot(page, '04-biuro-pulpit-zoom', viewport.name);

  // --- 5. Biuro Anny: "Poczta" wewnątrz pulpitu -> mail na ekranie (drugi poziom tej samej nakładki) --------------------
  await dialog().getByRole('button', { name: 'Poczta' }).click();
  await page.locator('[data-testid="scene-zoom"][data-phase="inner-open"]').waitFor();
  await shot(page, '05-biuro-mail-zoom', viewport.name);
  await dialog().getByRole('button', { name: 'Zabierz' }).click(); // mail -> pulpit
  await dialog().getByRole('button', { name: 'Wróć' }).click(); // pulpit -> zamyka nakładkę
  await closed();

  await page.getByRole('button', { name: 'Drukarka' }).click();
  await take();
  // Kubek nie jest dowodem: "Zabierz" = potrząśnięcie i toast.
  await page.getByRole('button', { name: 'Kubek z kawą' }).click();
  await dialog().getByRole('button', { name: 'Zabierz' }).click();
  await dialog().getByRole('status').waitFor();
  await shot(page, '06-biuro-kubek-nie-dowod', viewport.name);
  await dialog().getByRole('button', { name: 'Odłóż' }).click();
  await closed();
  // "drzwi" (Wyjście) kończy blok zamiast "Dalej" paska (ukryty - hideForward).
  await page.getByRole('button', { name: 'Wyjście' }).click();

  // --- DIALOGUE (Anna) - przechodzimy bez zrzutu (poza zakresem tej rundy) ---------------------------------------
  await page.getByText('Ja naprawdę nic nie zrobiłam').waitFor();
  // Komunikator (D-087): czekamy, aż rozmówca skończy "pisać" (data-typing na wątku), przed i po każdym pytaniu.
  const chatIdle = () => page.locator('[role="log"][data-typing="false"]').waitFor();
  const askOne = async (text) => {
    await chatIdle();
    await page.getByRole('button', { name: text, exact: true }).click();
    await chatIdle();
  };
  const askAll = async (questions) => {
    for (const text of questions) await askOne(text);
  };
  await askAll(['Opowiedz o tym mailu z banku.', 'Kto dzwonił o 9:05?', 'To hasło na karteczce…']);
  await reactionText('Hasło, kod SMS, presja czasu. Trzy rzeczy, których prawdziwy bank nigdy nie połączy w jednej rozmowie. Zobaczmy ten mail.');
  await askAll(['Dlaczego działałaś tak szybko?', 'Pomyślałaś, żeby to komuś zgłosić?']);
  await nextEnabled().click();

  // --- 6. EMAIL_ANALYSIS: kryterium "odliczanie" zaznaczone (fragment "Pozostało: 01:12:33" jest już przyciskiem -
  // "Lista elementów (dla klawiatury)" usunięta, feedback z produkcji) --------------------------------------------
  await page.getByTestId('mail-client').waitFor();
  const mail = page.getByTestId('mail-client');
  await mail.getByRole('button', { name: /Dział Bezpieczeństwa/ }).click(); // domena
  await mail.getByRole('button', { name: 'Przejdź do weryfikacji' }).click(); // link
  await mail.getByRole('button', { name: /Załącznik: Regulamin_weryfikacji\.pdf\.exe/ }).click(); // zalacznik
  await mail.getByRole('button', { name: 'Pozostało: 01:12:33' }).click(); // odliczanie
  await shot(page, '06-email-odliczanie', viewport.name);
  await mail.getByRole('button', { name: 'Szanowna Kliencie' }).click(); // zwrot
  await page.getByRole('group', { name: /Inne elementy/ }).getByRole('checkbox', { name: /Groźba zablokowania/ }).check(); // presja
  const emailAnswered = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź odpowiedź' }).click();
  await emailAnswered;
  await page.getByText(/Wynik: 100%/).waitFor();
  await nextEnabled().click();

  // --- DOSSIER (teczka, D-083): zrzut arkusza z zakreśleniem, potem wszystkie dokumenty i wymagane dowody -----------
  await page.getByRole('tablist', { name: 'Dokumenty w teczce' }).waitFor();
  const row = (text) => page.getByRole('button', { name: new RegExp(text) });
  await row('Dodano nowego odbiorcę').click();
  await shot(page, '06-teczka-wyciag', viewport.name);
  await page.getByRole('tab', { name: 'Logi logowania' }).click();
  await row('Logowanie').filter({ hasText: '09:03' }).click();
  await page.getByRole('tab', { name: 'Notatka IT' }).click();
  await row('zarejestrowana 2 dni przed atakiem').click();
  await shot(page, '06-teczka-notatka', viewport.name);
  await page.getByRole('tab', { name: 'Procedury' }).click();
  await nextEnabled().click();

  // --- DIALOGUE (Marek) - przechodzimy bez zrzutu ------------------------------------------------------------------
  await page.getByText('Nie mów mi, że karteczka').waitFor();
  await askAll(['Co mówią logi banku?', 'Ktoś z IT dzwonił do Anny o 9:05?']);
  await reactionText('Masz już wszystko. Ułóżmy to w kolejności.');
  await askAll(['Czy ktoś jeszcze dostał ten mail?', 'Co robimy teraz?']);
  await nextEnabled().click();

  // --- ORDERING (tablica śledcza, D-088) - pusta, pełna i po sprawdzeniu -------------------------------------------
  await page.getByTestId('evidence-board').waitFor();
  await shot(page, '07a-tablica-pusta', viewport.name);
  // Bez godzin w treści (usunięte z module.json) - z samymi godzinami układanie kolejności byłoby odczytem zegara.
  const wanted = [
    'Do skrzynki Anny trafia mail z domeny bankwektor-weryfikacja.pl.',
    'Anna klika link i wpisuje login oraz hasło na fałszywej stronie.',
    'Oszust loguje się do prawdziwego banku danymi Anny.',
    '„Informatyk” dzwoni po kod SMS, żeby anulować operację.',
    'Anna podaje kod; oszust zatwierdza przelew.',
    '14 000 zł wychodzi na konto „Wektor Rozliczenia”.',
  ];
  const boardTray = page.getByRole('group', { name: 'Ślady do przypięcia' });
  for (const [index, text] of wanted.entries()) {
    await boardTray.getByRole('button', { name: `Ślad: ${text}` }).click();
    await page.getByRole('button', { name: new RegExp(`^Pole ${index + 1}, puste`) }).click();
  }
  await shot(page, '07b-tablica-pelna', viewport.name);
  const orderingAnswered = progressResponse();
  await page.getByRole('button', { name: 'Sprawdź trop' }).click();
  await orderingAnswered;
  await page.locator('[data-testid="evidence-board"][data-phase="settled"]').waitFor();
  await page.waitForTimeout(900);
  await shot(page, '07c-tablica-po-sprawdzeniu', viewport.name);
  await nextEnabled().click();

  // --- TEXT_INPUT_GUIDED - przechodzimy bez zrzutu (poza zakresem tej rundy) --------------------------------------
  const prompt = 'Wpisz domenę, z której przyszedł fałszywy mail (samą domenę, bez https:// i bez adresu e-mail).';
  await page.getByLabel(prompt).waitFor();
  await page.getByLabel(prompt).fill('bankwektor-weryfikacja.pl');
  await page.getByRole('button', { name: 'Sprawdź' }).click();
  await page.getByText(/Poprawna odpowiedź!/).waitFor();
  // Wynik już jest widoczny w bloku (bez osobnego ekranu "Blok ukończony."): jedyny klik to "Dalej" pod wynikiem -
  // ten sam label co "Dalej" (nieaktywne) w pasku powłoki, stąd ten sam nextEnabled() (wybiera włączony przycisk).
  await nextEnabled().click();

  // --- SUMMARY (Rozwiązanie sprawy) - kończymy przejście, bez zrzutu (poza zakresem tej rundy) ---------------------
  await page.getByTestId('case-evidence').waitFor();

  await context.close();
}

try {
  await mkdir(OUT_DIR, { recursive: true });

  const apiEnv = { PORT: API_PORT, FRONTEND_URL: WEB, MAILERSEND_API_TOKEN: '', BACKGROUND_JOBS_ENABLED: 'false', NODE_ENV: 'development' };
  start('api', process.execPath, ['apps/api/dist/main.js'], apiEnv, process.cwd());
  start(
    'web',
    process.execPath,
    [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', WEB_PORT],
    { API_URL: API },
    join(process.cwd(), 'apps', 'web'),
  );

  await waitFor(async () => (await fetch(`${API}/`)).status > 0, 'start API');
  await waitFor(async () => (await fetch(`${WEB}/`)).ok, 'start web');

  const contentImport = await import('../apps/api/dist/scripts/content-import.js');
  prisma = new PrismaClient();
  const modules = await contentImport.loadModules(join(process.cwd(), 'packages', 'content', 'modules'));
  const contentModule = modules.find((m) => m.slug === SLUG);
  if (!contentModule) throw new Error(`moduł "${SLUG}" nie znaleziony`);
  const importResult = await prisma.$transaction((tx) => contentImport.importModule(tx, contentModule));
  courseId = importResult.courseId;
  if (importResult.courseCreated) courseCreatedIds.add(courseId);
  console.log('import treści OK:', JSON.stringify(importResult));

  browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    console.log(`\n--- przebieg: ${viewport.name} (${viewport.width}x${viewport.height}) ---`);
    await runViewport(viewport);
  }

  console.log('\nWSZYSTKIE ZRZUTY OK');
} catch (error) {
  console.error(`\nBŁĄD: ${error.message}`);
  console.error('--- ostatnie logi API/web ---\n' + apiLog.split('\n').slice(-60).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  try {
    prisma ??= new PrismaClient();
    for (const orgId of orgIds) await prisma.organization.deleteMany({ where: { id: orgId } });
    if (courseId && courseCreatedIds.has(courseId)) await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  } catch (error) {
    console.error('Sprzątanie bazy nie powiodło się:', error.message);
  }
}
