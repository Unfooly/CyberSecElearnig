// Prawdziwy test UKŁADU karty hotspotu (i sceny) W PRZEGLĄDARCE, BEZ backendu (bez Postgresa/Redisa/apps/api) -
// druga runda code review fix/hotspot-card-fit/B-101 znalazła bugi, których żaden test jsdom (Investigation.test.tsx)
// nie mógł wykryć, bo jsdom nie liczy layoutu CSS (container query, grid, cqw/cqh) - tylko prawdziwy Chromium to
// widzi. Użycie: `node scripts/layout-check.mjs` (spawnuje `next dev` z NEXT_PUBLIC_DEV_HARNESS=1, strona
// apps/web/src/app/dev/player-harness/page.dev.tsx renderuje PlayerStage z prawdziwą treścią modułu 1 - wyłącznie
// packages/content, bez importu do bazy). NIE jest częścią CI (B-101 w backlogu: "layout-check w CI") - uruchamiany
// RĘCZNIE, lokalnie, przed pushem każdego PR-a zmieniającego układ odtwarzacza (CLAUDE.md, reguła 12).
//
// Sprawdza dla każdej kombinacji (viewport x hotspot) pięć rzeczy (a-e w opisie zadania/PR fix/hotspot-card-fit):
//  a) <html> się nie przewija (scrollHeight/Width <= innerHeight/Width) - cała strona, nie tylko ramka.
//  b) karta hotspotu (.hotspot-card) się nie przewija (scrollHeight <= clientHeight) - poza kartą BEZ mediów, gdzie
//     "karta się nie przewija" nie ma sensu sprawdzać tak samo (auto-size do treści, patrz .hotspot-card--no-media).
//  c) obszar mediów karty (.hotspot-card-media) ma wysokość >0 i >=35% wysokości karty (łapie regresję z drugiej
//     rundy review: scena zagnieżdżona/media wychodziły zerowej albo miniaturowej wysokości) - dla karty BEZ mediów
//     (case "karteczka-bez-mediow", ?stripMedia=1), gdzie obszar mediów w ogóle nie istnieje, ZASTĄPIONE przez
//     checkNoMediaCardSizing: karta auto-size do treści (bez dużej pustej przestrzeni) i przyciski o naturalnej
//     wysokości - bez tego (a)/(d) nie łapały ani rozciągniętych przycisków, ani karty zostającej przy 92% wysokości
//     (oba mieszczą się w karcie/ramce) - czwarta runda code review, znalezione dopiero pomiarem w przeglądarce.
//  d) przyciski karty (.hotspot-card-buttons button) są W CAŁOŚCI wewnątrz karty i wewnątrz ramki odtwarzacza
//     (.player-frame) - nie wychodzą poza żadną z tych dwóch granic.
//  e) (raz na viewport, przed otwarciem jakiejkolwiek karty) obraz GŁÓWNEJ sceny mieści się w obszarze bloku - bez
//     paska przewijania w tym obszarze (hotfix fix/player-scene-fit/B-100, ta sama rodzina bugów).
// Dla telefonu w pionie (390x844/360x800, feat/player-portrait, sekcja B) DODATKOWO (f-j), przez
// PORTRAIT_VIEWPORT_NAMES:
//  f) scena panuje WYŁĄCZNIE w poziomie (.scene-pan-container: scrollWidth>clientWidth, scrollHeight<=clientHeight) -
//     panorama faktycznie się włączyła, nie cichy fallback do "contain" (checkScenePansHorizontallyOnly).
//  g) startowa pozycja panoramy (scrollLeft) odpowiada data-initial-pan-x, które ScenePanContainer.tsx sam ustawił
//     na sobie (checkInitialPanX - nie duplikuje formuły centroidu hotspotów w tym skrypcie).
//  h) każdy hotspot (`[data-testid^="hotspot-overlay-"]`) ma cel dotyku >=44x44px (checkTouchTargetSize).
//  i) po otwarciu karty: bottom sheet (.hotspot-card) ma wysokość <=85% wysokości viewportu i NIE nachodzi na
//     górny/dolny pasek odtwarzacza, przyciski w całości wewnątrz karty I viewportu (checkBottomSheetFits) - te
//     same HOTSPOT_CASES co dla innych viewportów.
//  j) cienie krawędzi panoramy/podpowiedź "przesuń" mieszczą się w viewporcie, nie przewijają się razem ze sceną
//     (checkPanoramaChromeInViewport - regresja znaleziona w code review, patrz ScenePanContainer.tsx).
// Zrzuty każdej sprawdzonej kombinacji trafiają do docs/brand/screens/layout-check/ (poza gitem, jak resztka
// docs/brand/screens/) - do wizualnej weryfikacji, niezależnie od wyniku. Pierwsze niepowodzenie zatrzymuje skrypt
// (kod wyjścia 1) z opisem: viewport, hotspot, który warunek i jakie wartości.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const WEB_PORT = process.env.LAYOUT_CHECK_WEB_PORT ?? '3112';
const WEB = `http://localhost:${WEB_PORT}`;
const OUT_DIR = join(process.cwd(), 'docs', 'brand', 'screens', 'layout-check');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '844x390', width: 844, height: 390 }, // telefon w poziomie, niska wysokość (globals.css: pełny ekran bez marginesów)
  // Telefon w pionie (feat/player-portrait, sekcja B) - panorama sceny + bottom sheet. isMobile:true (nie tylko
  // hasTouch) - Playwright ustawia wtedy też meta viewport/user-agent mobilny, bliżej prawdziwego telefonu niż
  // samo emulowanie dotyku na zwykłym oknie desktopowym (844x390 wyżej celowo NIE ma isMobile - to inny, wcześniej
  // ustalony przypadek testowy "wąskie okno desktopu z dotykiem", kod review PR #44).
  { name: '390x844', width: 390, height: 844, isMobile: true },
  { name: '360x800', width: 360, height: 800, isMobile: true },
];
const PORTRAIT_VIEWPORT_NAMES = new Set(['390x844', '360x800']);

// hotspotId: parametr ?hotspot= strony harnessu (HarnessAutoOpen.tsx klika przez niego, drilling w głąb dla
// zagnieżdżonych - "outlook" samo dociera do karty maila przez monitor). postOpen: dodatkowa interakcja PO otwarciu
// karty (transkrypcja audio nie ma własnego ?parametru - to zwykła interakcja w karcie, jak zrobiłby to gracz).
// noMedia: hotspot BEZ mediów (.hotspot-card--no-media) - treść modułu 1 nie ma dziś takiego, który otwiera kartę
// ("drzwi" jej w ogóle nie otwierają), więc ?stripMedia=1 (page.tsx) bierze prawdziwy hotspot i usuwa mu media na
// serwerze przed renderem - żeby sprawdzić DOKŁADNIE tę gałąź CSS, która miała krytyczny błąd w trzeciej rundzie
// code review (karta zapadała się do 32x32px). Obszar mediów w ogóle nie istnieje w tym przypadku - sprawdzenie
// (c) pomija go celowo (patrz pętla niżej), nie tylko "nie wymaga 35%".
const HOTSPOT_CASES = [
  { name: 'karteczka', hotspotId: 'karteczka' },
  { name: 'kalendarz', hotspotId: 'kalendarz' },
  { name: 'drukarka', hotspotId: 'drukarka' },
  { name: 'kubek', hotspotId: 'kubek' },
  { name: 'telefon', hotspotId: 'telefon' },
  {
    name: 'telefon+transkrypcja',
    hotspotId: 'telefon',
    async postOpen(page) {
      // Scoped do dialogu: NarrationBar.tsx (pasek lektora, dolny pasek ramki) ma WŁASNY przycisk "Transkrypcja"
      // (transkrypcja narracji bloku, inna funkcja) - bez scope'owania getByRole złapałby OBA (strict mode).
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Transkrypcja' }).click();
      await dialog.getByRole('region', { name: 'Transkrypcja' }).waitFor();
    },
  },
  { name: 'monitor-pulpit', hotspotId: 'monitor' },
  { name: 'outlook-mail', hotspotId: 'outlook' },
  { name: 'karteczka-bez-mediow', hotspotId: 'karteczka', extraQuery: 'stripMedia=1', noMedia: true },
];

async function waitForServer(url, what, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout: ${what}`);
}

function fail(message) {
  const error = new Error(message);
  error.isLayoutCheckFailure = true;
  throw error;
}

async function boxOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) fail(`Nie znaleziono elementu "${selector}" albo jest niewidoczny.`);
  return box;
}

async function checkNoPageScroll(page, label) {
  const { scrollHeight, scrollWidth, innerHeight, innerWidth } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));
  if (scrollHeight > innerHeight || scrollWidth > innerWidth) {
    fail(`${label}: (a) strona się przewija - scrollHeight=${scrollHeight} innerHeight=${innerHeight}, scrollWidth=${scrollWidth} innerWidth=${innerWidth}.`);
  }
}

async function checkCardDoesNotScroll(page, label) {
  const card = page.locator('.hotspot-card').first();
  const { scrollHeight, clientHeight, hasNoMedia } = await card.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    hasNoMedia: el.classList.contains('hotspot-card--no-media'),
  }));
  // Karta bez mediów jest auto-size do treści (.hotspot-card--no-media, globals.css) - "się nie przewija" nie
  // dotyczy jej w ten sam sposób (nic tam nie ma do przewijania z definicji), pomijamy w tym przypadku.
  if (!hasNoMedia && scrollHeight > clientHeight) {
    fail(`${label}: (b) karta (.hotspot-card) się przewija - scrollHeight=${scrollHeight} clientHeight=${clientHeight}.`);
  }
}

async function checkMediaHeight(page, label) {
  const cardBox = await boxOf(page, '.hotspot-card');
  const mediaBox = await boxOf(page, '.hotspot-card-media');
  if (mediaBox.height <= 0) {
    fail(`${label}: (c) obszar mediów (.hotspot-card-media) ma wysokość ${mediaBox.height} (<=0).`);
  }
  const ratio = mediaBox.height / cardBox.height;
  if (ratio < 0.35) {
    fail(`${label}: (c) obszar mediów ma ${(ratio * 100).toFixed(1)}% wysokości karty (${mediaBox.height}px z ${cardBox.height}px) - poniżej wymaganych 35%.`);
  }
}

// Karta BEZ mediów (.hotspot-card--no-media) ma auto-size do treści - checkMediaHeight (c) i część checkCardDoesNotScroll
// (b) jej nie dotyczą z definicji (nie ma obszaru mediów, "się nie przewija" nie ma sensu tak samo). Bez WŁASNEGO
// sprawdzenia żaden z dwóch bugów czwartej rundy code review nie miałby stałej ochrony przed regresją - oba mieściły
// się w kartę/ramkę, więc (a)/(d) by ich nie złapały:
//  - przyciski rozciągnięte przez align-content (grid "auto auto" bez fr) do ~148px zamiast naturalnych ~44px;
//  - `.hotspot-card--no-media { height:auto }` przegrywający z Tailwind `sm:h-[92%]` (karta zostawała 92%-wysoka z
//    dużą pustą przestrzenią pod treścią, mimo że treść była już poprawnego rozmiaru).
async function checkNoMediaCardSizing(page, label) {
  const cardBox = await boxOf(page, '.hotspot-card');
  const layoutBox = await boxOf(page, '.hotspot-card-layout');
  // Różnica karta-treść to góra/dół paddingu karty (p-4 x2 = 32px) - duży naddatek ponad to zdradza, że height:auto
  // nie wygrał (karta zostaje przy 92% wysokości sceny, treść dużo krótsza).
  const slack = cardBox.height - layoutBox.height;
  if (slack > 80) {
    fail(
      `${label}: karta bez mediów ma dużo pustej przestrzeni pod treścią (karta=${cardBox.height}px, treść=${layoutBox.height}px, różnica=${slack}px > 80px) - podejrzenie, że .hotspot-card--no-media nie wygrywa z sm:h-[92%].`,
    );
  }
  const buttons = await page.locator('.hotspot-card-buttons button').all();
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (box && box.height > 70) {
      const name = (await button.textContent())?.trim() ?? '?';
      fail(`${label}: przycisk "${name}" ma nienaturalną wysokość ${box.height}px (>70px, oczekiwane ~44px) - podejrzenie, że wiersze "auto" siatki są rozciągane (align-content).`);
    }
  }
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

async function checkButtonsInsideCardAndFrame(page, label) {
  const cardBox = await boxOf(page, '.hotspot-card');
  const frameBox = await boxOf(page, '.player-frame');
  const buttons = await page.locator('.hotspot-card-buttons button').all();
  if (buttons.length === 0) fail(`${label}: (d) nie znaleziono żadnego przycisku w .hotspot-card-buttons.`);
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (!box) continue;
    const name = (await button.textContent())?.trim() ?? '?';
    if (!contains(cardBox, box)) {
      fail(`${label}: (d) przycisk "${name}" wychodzi poza kartę - przycisk=${JSON.stringify(box)} karta=${JSON.stringify(cardBox)}.`);
    }
    if (!contains(frameBox, box)) {
      fail(`${label}: (d) przycisk "${name}" wychodzi poza ramkę odtwarzacza - przycisk=${JSON.stringify(box)} ramka=${JSON.stringify(frameBox)}.`);
    }
  }
}

// (e) Scena GŁÓWNA (nie karta) mieści się w obszarze bloku, bez paska przewijania w tym obszarze - hotfix
// fix/player-scene-fit/B-100. Sprawdzane raz na viewport, PRZED otwarciem jakiejkolwiek karty hotspotu.
async function checkMainSceneFits(page, label) {
  const sceneArea = page.getByTestId('player-content-area');
  const { scrollHeight, clientHeight, scrollWidth, clientWidth } = await sceneArea.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  if (scrollHeight > clientHeight || scrollWidth > clientWidth) {
    fail(`${label}: (e) obraz sceny głównej nie mieści się w obszarze bloku - scrollHeight=${scrollHeight} clientHeight=${clientHeight}, scrollWidth=${scrollWidth} clientWidth=${clientWidth}.`);
  }
}

async function shot(page, name) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

// (844x390, "telefon w poziomie") hasTouch:true na kontekście MA sprawić, że (pointer: coarse) faktycznie
// pasuje - bez tego sprawdzenia zmiana emulacji w przyszłej wersji Playwrighta po cichu wyłączyłaby testowaną
// gałąź globals.css (trzecia runda code review), a skrypt nadal zielono przechodziłby zwykłą, wyśrodkowaną ramkę
// biurkową zamiast pełnoekranowej ramki telefonu.
async function checkPointerCoarse(page, label) {
  const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
  if (!coarse) fail(`${label}: (pointer: coarse) nie pasuje mimo hasTouch:true - viewport NIE wchodzi w tryb "telefon w poziomie" (globals.css).`);
}

// (f) Telefon w pionie: scena panuje WYŁĄCZNIE w poziomie - .scene-pan-container (ScenePanContainer.tsx) musi mieć
// scrollWidth>clientWidth (panorama faktycznie włączona przez formułę "fit-height" w globals.css, nie cichy
// fallback do "contain" - w tym drugim przypadku scrollWidth==clientWidth i cała reszta sprawdzeń panoramy (g-i
// część) nie miałaby sensu) i scrollHeight<=clientHeight (bez przewijania w pionie - to strona/karta ma się
// przewijać, nie sama scena).
async function checkScenePansHorizontallyOnly(page, label) {
  const box = page.locator('.scene-pan-container').first();
  const { scrollWidth, clientWidth, scrollHeight, clientHeight } = await box.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  if (scrollWidth <= clientWidth + 1) {
    fail(`${label}: (f) panorama się nie włączyła - .scene-pan-container scrollWidth=${scrollWidth} clientWidth=${clientWidth} (oczekiwano overflow).`);
  }
  if (scrollHeight > clientHeight + 1) {
    fail(`${label}: (f) scena przewija się w PIONIE - scrollHeight=${scrollHeight} clientHeight=${clientHeight} (panorama ma być wyłącznie pozioma).`);
  }
}

// (g) Startowa pozycja panoramy - scrollLeft po starcie ma odpowiadać data-initial-pan-x (fraction 0..1), które
// ScenePanContainer.tsx SAM ustawił na sobie po zmierzeniu WŁASNEGO scrollWidth/clientWidth - to sprawdzenie NIE
// duplikuje formuły centroidu hotspotów (computeHotspotCentroid, SceneHotspotsBlock.tsx) w tym skrypcie, tylko
// potwierdza, że kontener zastosował wartość, którą sam wyliczył.
async function checkInitialPanX(page, label) {
  const box = page.locator('.scene-pan-container').first();
  const { scrollLeft, scrollWidth, clientWidth, initialPanX } = await box.evaluate((el) => ({
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    initialPanX: Number(el.dataset.initialPanX),
  }));
  const expected = initialPanX * (scrollWidth - clientWidth);
  if (Math.abs(scrollLeft - expected) > 2) {
    fail(`${label}: (g) startowy scrollLeft=${scrollLeft} nie odpowiada data-initial-pan-x=${initialPanX} (oczekiwano ~${expected.toFixed(1)}).`);
  }
}

// (h) Touch target >=44x44px (WCAG 2.5.5/2.5.8) - każdy hotspot na scenie głównej, niezależnie od tego, czy jest
// akurat widoczny w scrollowanym obszarze (boundingBox Playwrighta liczy rzeczywisty rozmiar niezależnie od tego,
// czy element jest w danej chwili przescrollowany poza widok - CSS min-width/height, globals.css, obowiązuje
// zawsze, nie tylko dla widocznej części panoramy).
async function checkTouchTargetSize(page, label) {
  const buttons = await page.locator('[data-testid^="hotspot-overlay-"]').all();
  if (buttons.length === 0) fail(`${label}: (h) nie znaleziono żadnego hotspotu na scenie.`);
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (!box) continue;
    if (box.width < 44 || box.height < 44) {
      const name = await button.getAttribute('aria-label');
      fail(`${label}: (h) hotspot "${name}" ma cel dotyku ${box.width}x${box.height}px (<44x44px).`);
    }
  }
}

// (j) Cienie krawędzi panoramy i podpowiedź "przesuń" NIE przewijają się razem ze sceną (kod review - realny bug:
// pierwsza wersja miała je jako dzieci PRZEWIJANEGO kontenera zamiast osobnej, nieprzewijanej ramki dookoła niego,
// więc po starcie ze scrollLeft>0 wypadały w złym miejscu/poza ekranem) - ich bounding boxy muszą mieścić się w
// całości wewnątrz viewportu, niezależnie od aktualnej pozycji panoramy.
async function checkPanoramaChromeInViewport(page, label) {
  const viewport = page.viewportSize();
  const selectors = ['.scene-pan-edge--right', '.scene-pan-hint'];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue; // prawy cień/podpowiedź mogą nie istnieć (canPan=false) - pomijamy.
    const box = await locator.boundingBox();
    if (!box) continue; // element w DOM, ale niewidoczny (np. opacity:0 - cień jeszcze nieujawniony) - nic do sprawdzenia.
    if (box.x < -0.5 || box.x + box.width > viewport.width + 0.5) {
      fail(`${label}: (j) "${selector}" wychodzi poza szerokość viewportu (x=${box.x}, width=${box.width}, viewport=${viewport.width}) - podejrzenie, że przewija się razem ze sceną.`);
    }
  }
}

// (i) Bottom sheet (.hotspot-card, telefon w pionie) mieści się w 85% wysokości viewportu (globals.css:
// position:fixed; height: min(85dvh, ...)) - inny punkt odniesienia niż checkButtonsInsideCardAndFrame
// (.player-frame, który na tym breakpoincie i tak wypełnia cały viewport, więc "wewnątrz ramki" nic dodatkowego by
// nie sprawdziło ponad "wewnątrz viewportu"), stąd osobne sprawdzenie wysokości względem viewportu. DODATKOWO (kod
// review, regresja znaleziona i naprawiona w tej samej sesji): karta nie może nachodzić na .player-bottombar (dół)
// ani wchodzić pod .player-topbar (góra) - .player-frame jako "ramka" tego by nie złapał, bo obie te belki są W
// JEGO OBRĘBIE (position:fixed karty liczy się względem CAŁEGO viewportu, nie samej ramki).
async function checkBottomSheetFits(page, label) {
  const viewport = page.viewportSize();
  const cardBox = await boxOf(page, '.hotspot-card');
  const bottombarBox = await boxOf(page, '.player-bottombar');
  const topbarBox = await boxOf(page, '.player-topbar');
  const maxHeight = viewport.height * 0.85 + 1;
  if (cardBox.height > maxHeight) {
    fail(`${label}: (i) bottom sheet (.hotspot-card) ma wysokość ${cardBox.height}px > 85% viewportu (${maxHeight.toFixed(1)}px, viewport=${viewport.height}px).`);
  }
  if (cardBox.y + cardBox.height > bottombarBox.y + 0.5) {
    fail(`${label}: (i) bottom sheet nachodzi na dolny pasek odtwarzacza - dół karty=${cardBox.y + cardBox.height} góra paska=${bottombarBox.y}.`);
  }
  if (cardBox.y < topbarBox.y + topbarBox.height - 0.5) {
    fail(`${label}: (i) bottom sheet wchodzi pod górny pasek - góra karty=${cardBox.y} dół paska=${topbarBox.y + topbarBox.height}.`);
  }
}

const children = [];
let webLog = '';
function start(command, args, env, cwd) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, shell: false });
  children.push(child);
  child.stdout.on('data', (chunk) => (webLog += chunk.toString()));
  child.stderr.on('data', (chunk) => (webLog += chunk.toString()));
  return child;
}

// next dev (Next 14) forkuje osobny proces serwera i sprząta go WYŁĄCZNIE na SIGTERM/exit - child.kill() na
// Windows to TerminateProcess (nie SIGTERM), więc te handlery się nie wykonują i serwer zostaje osierocony na
// porcie. taskkill /T (drzewo procesów) /F (wymuszony) naprawia to na Windows; gdzie indziej zwykły SIGTERM
// wystarcza (next dev go obsługuje poprawnie).
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
  } else {
    child.kill();
  }
}

const results = [];
function step(label, ok) {
  results.push({ label, ok });
  console.log(`${ok ? 'OK  ' : 'BŁĄD'} ${label}`);
}

let browser;
try {
  await mkdir(OUT_DIR, { recursive: true });

  start(
    process.execPath,
    [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', WEB_PORT],
    { NEXT_PUBLIC_DEV_HARNESS: '1' },
    join(process.cwd(), 'apps', 'web'),
  );

  await waitForServer(`${WEB}/dev/player-harness`, 'start web (dev harness)');

  browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    console.log(`\n--- viewport: ${viewport.name} ---`);
    // hasTouch: true - globals.css rozstrzyga tryb "telefon w poziomie" (844x390) po (pointer: coarse), nie tylko
    // wymiarach (kod review PR #44: wąskie/niskie okno na DESKTOPIE z myszą nie ma łapać tego trybu) - bez emulacji
    // dotyku Playwright zostaje przy (pointer: fine) i 844x390 dostałoby zwykłą, wyśrodkowaną ramkę biurkową zamiast
    // pełnoekranowej ramki telefonu, którą layout-check ma sprawdzać. Nieszkodliwe dla większych viewportów - żaden
    // z pozostałych nie spełnia warunków max-height/max-width tych reguł niezależnie od typu wskaźnika.
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
    });
    const page = await context.newPage();
    const isPortrait = PORTRAIT_VIEWPORT_NAMES.has(viewport.name);

    await page.goto(`${WEB}/dev/player-harness`);
    await page.getByTestId('player-content-area').waitFor();
    await shot(page, `${viewport.name}-00-scena-glowna`);
    await checkMainSceneFits(page, `${viewport.name} / scena główna`);
    step(`${viewport.name} / scena główna: (e) mieści się bez przewijania`, true);
    if (viewport.name === '844x390') {
      await checkPointerCoarse(page, `${viewport.name} / scena główna`);
      step(`${viewport.name}: (pointer: coarse) faktycznie pasuje (hasTouch:true działa)`, true);
    }
    if (isPortrait) {
      await checkPointerCoarse(page, `${viewport.name} / scena główna`);
      await checkScenePansHorizontallyOnly(page, `${viewport.name} / scena główna`);
      await checkInitialPanX(page, `${viewport.name} / scena główna`);
      await checkTouchTargetSize(page, `${viewport.name} / scena główna`);
      await checkPanoramaChromeInViewport(page, `${viewport.name} / scena główna`);
      step(`${viewport.name} / scena główna: (f-h, j) panorama OK`, true);
    }

    for (const testCase of HOTSPOT_CASES) {
      const label = `${viewport.name} / ${testCase.name}`;
      const query = new URLSearchParams({ hotspot: testCase.hotspotId });
      if (testCase.extraQuery) new URLSearchParams(testCase.extraQuery).forEach((v, k) => query.set(k, v));
      await page.goto(`${WEB}/dev/player-harness?${query.toString()}`);
      await page.locator('.hotspot-card').first().waitFor();
      if (testCase.postOpen) await testCase.postOpen(page);
      // Jedna klatka na ustabilizowanie layoutu (przejście paska poziomu/animacje nie dotyczą tej karty, ale kolejne
      // klatki po kliknięciu z HarnessAutoOpen.tsx czasem jeszcze się układają).
      await page.waitForTimeout(200);

      await shot(page, `${viewport.name}-${testCase.name}`);
      await checkNoPageScroll(page, label);
      await checkCardDoesNotScroll(page, label);
      if (testCase.noMedia) {
        // (c) nie dotyczy karty bez mediów - nie ma obszaru mediów do zmierzenia z definicji. WŁASNE sprawdzenie
        // zamiast tego (czwarta runda code review: bez niego (a)/(d) nie łapią ani rozciągniętych przycisków, ani
        // karty zostającej przy 92% z pustą przestrzenią - oba mieszczą się w karcie/ramce).
        await checkNoMediaCardSizing(page, label);
      } else {
        await checkMediaHeight(page, label);
      }
      await checkButtonsInsideCardAndFrame(page, label);
      if (isPortrait) {
        await checkBottomSheetFits(page, label);
      }
      step(`${label}: (a-d${isPortrait ? ', i' : ''}) OK`, true);
    }

    await context.close();
  }

  console.log(`\nWSZYSTKIE SPRAWDZENIA OK (${results.length})`);
} catch (error) {
  const label = results.length > 0 ? results[results.length - 1].label : '(przed pierwszym sprawdzeniem)';
  console.error(`\nBŁĄD po: ${label}`);
  console.error(error.message);
  if (!error.isLayoutCheckFailure) {
    console.error('--- ostatnie logi next dev ---\n' + webLog.split('\n').slice(-60).join('\n'));
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) killTree(child);
}
