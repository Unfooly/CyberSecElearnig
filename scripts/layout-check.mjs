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
//
// DIALOGUE (fix/dialogue-sticky-questions): OSOBNA, mniejsza pętla (DIALOGUE_VIEWPORTS - 1366x768 i 390x844
// wprost z zadania, NIE cała lista VIEWPORTS wyżej) - `?block=rozmowa-anna` (packages/content/modules/wyludzone-haslo,
// 5 pytań, >=8 wiadomości po zadaniu wszystkich). Sprawdza NA STARCIE, W TRAKCIE (po 2 pytaniach) i PO ZAKOŃCZENIU
// (kod review: pierwsza wersja sprawdzała tylko start/koniec - stopka ma NAJWIĘKSZĄ wysokość akurat na starcie
// (wszystkie chipy naraz), więc same skrajne stany razem nie gwarantowały pokrycia stanu pośredniego):
// (j) lista pytań (chipy) w całości widoczna wewnątrz .player-frame ORAZ player-content-area (to drugie faktycznie
// przycina treść - overflow-clip - .player-frame samo nie gwarantuje, że coś w nim widoczne NIE jest obcięte);
// (e/k) obszar bloku (data-testid="player-content-area") się NIE przewija na żadnym z trzech etapów (reuse
// checkMainSceneFits, generyczny, nie SCENE_HOTSPOTS-specyficzny), strona się nie przewija PO zakończeniu (reuse
// checkNoPageScroll) - dokładnie to, co ten branch naprawia: wątek ma WŁASNY scroll, blok/strona nie muszą się już
// przewijać, żeby dotrzeć do kolejnego pytania; (l) PO zakończeniu: wątek faktycznie przewinął się wewnętrznie
// (scrollHeight>clientHeight - dowód, że test w ogóle wygenerował przepełnienie) i jest przewinięty do najnowszej
// wiadomości (<=80px od dołu) - w PRAWDZIWEJ przeglądarce łapie regres autoprzewijania (np. wyścig ze
// `scrollTo({behavior:'smooth'})`), którego jsdom nie jest w stanie zaobserwować.
//
// BRIEFING (feat/module-briefing, D-081): OSOBNA pętla (BRIEFING_VIEWPORTS: 1920x1080, 1366x768, 844x390, 390x844) po
// wszystkich krokach odprawy modułu 1 (`?block=odprawa`) - (m-o) w komentarzu przy checkBriefingStep.
// DOSSIER (feat/dossier-folder, D-083): ta sama lista rozdzielczości, każdy dokument teczki (`?block=akta-sprawy`) - (q-u)
// w komentarzu przy checkDossierDocument.
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

// DIALOGUE (fix/dialogue-sticky-questions) - dwa konkretne viewporty z zadania, NIE cała lista VIEWPORTS wyżej
// (desktop szeroki + telefon w pionie - dwa skrajne kształty, w których lista pytań najłatwiej nie zmieściłaby się
// w całości).
const DIALOGUE_VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844, isMobile: true },
];

// BRIEFING (feat/module-briefing, D-081) - `?block=odprawa`, cztery rozdzielczości z planu PR 1. reducedMotion:'reduce':
// każdy krok od razu w stanie końcowym (pisanie, spadająca karta, pieczątka), więc pomiar nie zależy od czasu animacji.
const BRIEFING_VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '844x390', width: 844, height: 390 },
  { name: '390x844', width: 390, height: 844, isMobile: true },
];
// Przyciski kolejnych kroków modułu 1 (packages/content/modules/wyludzone-haslo, blok "odprawa").
const BRIEFING_CTAS = ['Odbierz', 'Przyjmuję', 'Biorę sprawę', 'Ruszam na miejsce', 'Wchodzę'];

// DOSSIER (feat/dossier-folder, D-083) - `?block=akta-sprawy`, te same cztery rozdzielczości co odprawa, każdy dokument.
const DOSSIER_TABS = ['Wyciąg bankowy', 'Logi logowania', 'Notatka IT', 'Procedury'];

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

// (j) Lista pytań (DialogueBlock.tsx, "Pytania do zadania") w CAŁOŚCI wewnątrz .player-frame ORAZ wewnątrz
// player-content-area (kod review: .player-frame nie odzwierciedla faktycznego przycinania - to
// player-content-area ma `overflow-clip`, więc TO ono jest granicą, która realnie obcina/ukrywa treść; sprawdzamy
// OBA, żeby regres w którymkolwiek złapał test). Sprawdzane na starcie rozmowy (wszystkie chipy naraz, najtrudniejszy
// przypadek). Lista może nie istnieć w DOM wcale (wszystkie pytania już zadane) - to nie jest błąd tego sprawdzenia,
// po prostu nic do sprawdzenia.
async function checkQuestionListVisible(page, label) {
  const list = page.getByRole('list', { name: 'Pytania do zadania' });
  if ((await list.count()) === 0) return;
  const frameBox = await boxOf(page, '.player-frame');
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  const box = await list.first().boundingBox();
  if (!box) fail(`${label}: (j) lista pytań istnieje w DOM, ale nie jest widoczna.`);
  if (!contains(frameBox, box)) {
    fail(`${label}: (j) lista pytań ("Pytania do zadania") wychodzi poza ramkę odtwarzacza - lista=${JSON.stringify(box)} ramka=${JSON.stringify(frameBox)}.`);
  }
  if (!contains(contentAreaBox, box)) {
    fail(`${label}: (j) lista pytań wychodzi poza obszar bloku (player-content-area, overflow-clip) - lista=${JSON.stringify(box)} obszar=${JSON.stringify(contentAreaBox)}.`);
  }
}

// (l) Wątek (DialogueBlock.tsx, role="log"/aria-label="Historia rozmowy") faktycznie przewija się WEWNĘTRZNIE
// (scrollHeight>clientHeight - dowód, że test wygenerował więcej wiadomości niż mieści się na ekranie, inaczej
// pozostałe sprawdzenia przechodziłyby trywialnie na krótkiej treści) i BEZ ZBĘDNEGO OPÓŹNIENIA kończy przewinięty
// BLISKO DOŁU (odległość <=STICK_TO_BOTTOM_THRESHOLD_PX z DialogueBlock.tsx) - to sprawdzenie w PRAWDZIWEJ
// przeglądarce złapałoby regres autoprzewijania (np. wyścig ze `scrollTo({behavior:'smooth'})`, kod review), którego
// jsdom (testy jednostkowe) nie jest w stanie zaobserwować (nie liczy layoutu/animacji scrolla). POLLING zamiast
// jednorazowego odczytu po stałym `waitForTimeout` (kod review, druga runda: stałe opóźnienie jest niestabilne -
// ostatnie kliknięcie odpala `scrollTo({behavior:'smooth'})`, którego czas trwania w Chromium zależy od dystansu i
// wydajności maszyny, więc mogła nie zdążyć dobiec końca w 200ms na wolniejszym CI).
async function checkThreadScrolledToBottom(page, label, timeoutMs = 5000) {
  const log = page.getByRole('log', { name: 'Historia rozmowy' });
  const first = await log.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  if (first.scrollHeight <= first.clientHeight + 1) {
    fail(`${label}: (l) wątek NIE przewija się wewnętrznie (scrollHeight=${first.scrollHeight}, clientHeight=${first.clientHeight}) - test nie wygenerował dość wiadomości, żeby sprawdzić autoprzewijanie.`);
  }
  const start = Date.now();
  let last;
  do {
    last = await log.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop }));
    const distanceFromBottom = last.scrollHeight - last.scrollTop - last.clientHeight;
    if (distanceFromBottom <= 80) return;
    await page.waitForTimeout(50);
  } while (Date.now() - start < timeoutMs);
  const distanceFromBottom = last.scrollHeight - last.scrollTop - last.clientHeight;
  fail(`${label}: (l) wątek nie przewinął się do najnowszej wiadomości w ciągu ${timeoutMs}ms - odległość od dołu ${distanceFromBottom}px (>80px).`);
}

// Klika NAJWYŻEJ `maxQuestions` kolejnych dostępnych pytań (w tym "Następna kwestia" dla pytań wielokwestyjnych,
// pętla wewnętrzna z WŁASNYM limitem iteracji - kod review: dawna wersja nie miała tu żadnego capu, DRUGA runda:
// wyczerpanie limitu ma się głośno zgłosić, nie po cichu przejść dalej z niekompletnym stanem). Kończy wcześniej,
// gdy lista "Pytania do zadania" znika z DOM (wszystkie zadane).
async function clickSomeDialogueQuestions(page, maxQuestions) {
  const nextButton = page.getByRole('button', { name: 'Następna kwestia' });
  const questionList = page.getByRole('list', { name: 'Pytania do zadania' });
  for (let asked = 0; asked < maxQuestions; asked += 1) {
    let innerGuard = 0;
    while ((await nextButton.count()) > 0) {
      if (innerGuard >= 20) {
        fail('clickSomeDialogueQuestions: przekroczono limit iteracji pętli "Następna kwestia" - podejrzenie nieskończonej pętli.');
      }
      await nextButton.click();
      await page.waitForTimeout(30);
      innerGuard += 1;
    }
    if ((await questionList.count()) === 0) return;
    const chips = questionList.getByRole('button');
    if ((await chips.count()) === 0) return;
    await chips.first().click();
    await page.waitForTimeout(30);
  }
}

// Klika WSZYSTKIE dostępne pytania rozmowy po kolei - generuje realną, długą rozmowę (>=8 wiadomości dla
// rozmowa-anna, 5 pytań) do sprawdzenia (k)/(l) niżej.
async function clickAllDialogueQuestions(page) {
  const questionList = page.getByRole('list', { name: 'Pytania do zadania' });
  // Limit iteracji jako zabezpieczenie przed nieskończoną pętlą, gdyby stan się kiedyś nie zgadzał (nigdy nie
  // powinien zostać osiągnięty - rozmowa-anna ma dziś 5 pytań).
  for (let guard = 0; guard < 50; guard += 1) {
    if ((await questionList.count()) === 0) return;
    const chips = questionList.getByRole('button');
    if ((await chips.count()) === 0) return;
    await clickSomeDialogueQuestions(page, 1);
  }
  fail('clickAllDialogueQuestions: przekroczono limit iteracji - podejrzenie nieskończonej pętli.');
}

// BRIEFING (D-081), dla każdego kroku: (m) strona się nie przewija, obszar bloku (overflow-clip) nie przewija się, a
// odprawa nie ma poziomego przewijania (przewija się - jeśli w ogóle - tylko w pionie, wewnątrz siebie); (n) przycisk kroku
// po przewinięciu do niego leży w CAŁOŚCI w obszarze bloku i w ramce (osiągalny, nie przycięty przez overflow-clip);
// (o) "Pomiń odprawę" w całości w górnym pasku, a sam pasek nie wypycha treści poza siebie (tytuł się skraca, nie
// przycisk/Notatnik). Wraca też nazwę kroku, który przewija się wewnętrznie (informacyjnie w wyniku, nie błąd).
async function checkBriefingStep(page, cta, label) {
  await checkNoPageScroll(page, label);
  await checkMainSceneFits(page, label);
  const briefing = page.getByTestId('briefing-block');
  const { scrollWidth, clientWidth, scrollHeight, clientHeight } = await briefing.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  if (scrollWidth > clientWidth + 1) fail(`${label}: (m) odprawa przewija się w poziomie - scrollWidth=${scrollWidth} clientWidth=${clientWidth}.`);

  const button = page.getByRole('button', { name: cta, exact: true });
  await button.scrollIntoViewIfNeeded();
  const buttonBox = await button.boundingBox();
  if (!buttonBox) fail(`${label}: (n) przycisk "${cta}" niewidoczny.`);
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  const frameBox = await boxOf(page, '.player-frame');
  if (!contains(contentAreaBox, buttonBox) || !contains(frameBox, buttonBox)) {
    fail(`${label}: (n) przycisk "${cta}" wychodzi poza obszar bloku/ramkę - przycisk=${JSON.stringify(buttonBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  }

  const skipBox = await page.getByRole('button', { name: 'Pomiń odprawę' }).boundingBox();
  const topbar = page.locator('.player-topbar');
  const topbarBox = await boxOf(page, '.player-topbar');
  if (!skipBox || !contains(topbarBox, skipBox)) {
    fail(`${label}: (o) "Pomiń odprawę" poza górnym paskiem - przycisk=${JSON.stringify(skipBox)} pasek=${JSON.stringify(topbarBox)}.`);
  }
  const topbarOverflow = await topbar.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (topbarOverflow > 1) fail(`${label}: (o) górny pasek przepełniony w poziomie o ${topbarOverflow}px.`);
  return scrollHeight > clientHeight + 1;
}

// DOSSIER (D-083), dla każdego dokumentu: (q) strona i obszar bloku się nie przewijają, a teczka nie ma poziomego
// przewijania; (r) przewija się WYŁĄCZNIE lista wierszy - arkusz jako całość mieści się w teczce, a teczka w obszarze
// bloku; (s) wszystkie przekładki w całości w ramce (na telefonie w pionie pasek przekładek może przewijać się poziomo -
// wtedy każda przekładka ma być osiągalna po przewinięciu); (t) cel dotyku wiersza >= 44px wysokości; (u) błędy strony.
async function checkDossierDocument(page, label) {
  await checkNoPageScroll(page, label);
  await checkMainSceneFits(page, label);
  const dossier = page.getByTestId('dossier-block');
  const overflowX = await dossier.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (overflowX > 1) fail(`${label}: (q) teczka przewija się w poziomie o ${overflowX}px.`);
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  const dossierBox = await boxOf(page, '[data-testid="dossier-block"]');
  const sheetBox = await boxOf(page, '[role="tabpanel"]');
  if (!contains(contentAreaBox, dossierBox)) fail(`${label}: (r) teczka wychodzi poza obszar bloku - teczka=${JSON.stringify(dossierBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  if (!contains(dossierBox, sheetBox)) fail(`${label}: (r) arkusz wychodzi poza teczkę - arkusz=${JSON.stringify(sheetBox)} teczka=${JSON.stringify(dossierBox)}.`);
  for (const tab of await page.getByRole('tab').all()) {
    await tab.scrollIntoViewIfNeeded();
    const box = await tab.boundingBox();
    if (!box || !contains(dossierBox, box)) fail(`${label}: (s) przekładka "${await tab.textContent()}" poza teczką po przewinięciu - ${JSON.stringify(box)}.`);
  }
  const firstRow = await page.getByTestId('dossier-rows').locator('button').first().boundingBox();
  if (!firstRow || firstRow.height < 44) fail(`${label}: (t) wiersz ma cel dotyku ${firstRow?.height}px (<44px).`);
  const rows = page.getByTestId('dossier-rows');
  return rows.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
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

  // DIALOGUE (fix/dialogue-sticky-questions) - patrz komentarz na górze pliku.
  for (const viewport of DIALOGUE_VIEWPORTS) {
    console.log(`\n--- viewport (DIALOGUE): ${viewport.name} ---`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
    });
    const page = await context.newPage();

    await page.goto(`${WEB}/dev/player-harness?block=rozmowa-anna`);
    await page.getByTestId('player-content-area').waitFor();
    await shot(page, `${viewport.name}-dialogue-00-start`);
    await checkQuestionListVisible(page, `${viewport.name} / rozmowa-anna (start)`);
    // (e/k na starcie) sprawdzane też TERAZ, nie tylko po zakończeniu rozmowy (kod review: stopka na starcie ma
    // WSZYSTKIE chipy naraz, czyli NAJWIĘKSZĄ wysokość - "po rozmowie" (poniżej) ma akurat najmniejszą stopkę i sam
    // by nie złapał regresu widocznego tylko przy dużej liczbie chipów).
    await checkMainSceneFits(page, `${viewport.name} / rozmowa-anna (start)`);
    step(`${viewport.name} / rozmowa-anna: (j, e) lista pytań mieści się w ramce/obszarze bloku na starcie`, true);

    // Stan POŚREDNI (kod review: sprawdzenia tylko na starcie i po pełnym zakończeniu pomijały stan "część chipów
    // zadana, część zostaje, wątek już ma kilka wiadomości") - `clickSomeDialogueQuestions(page, 2)` na rozmowa-anna
    // (5 pytań) kończy z JEDNYM pytaniem w pełni zadanym i DRUGIM w trakcie (jego "Następna kwestia" wciąż widoczna) -
    // stopka ma więc na tym etapie 3-4 pozostałe chipy + przycisk "Następna kwestia" naraz, dobry przypadek pośredni.
    await clickSomeDialogueQuestions(page, 2);
    await page.waitForTimeout(200);
    await checkMainSceneFits(page, `${viewport.name} / rozmowa-anna (w trakcie)`);
    step(`${viewport.name} / rozmowa-anna: (e) obszar bloku nie przewija się w trakcie rozmowy`, true);

    await clickAllDialogueQuestions(page);
    await page.waitForTimeout(200);
    await shot(page, `${viewport.name}-dialogue-01-po-rozmowie`);
    await checkNoPageScroll(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    await checkMainSceneFits(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    await checkThreadScrolledToBottom(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    step(`${viewport.name} / rozmowa-anna: (k, l) strona/obszar bloku nie przewijają się, wątek przewinięty do dołu po >=8 wiadomościach`, true);

    await context.close();
  }

  // BRIEFING (feat/module-briefing, D-081) - patrz checkBriefingStep.
  for (const viewport of BRIEFING_VIEWPORTS) {
    console.log(`\n--- viewport (BRIEFING): ${viewport.name} ---`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    // (p) Błędy strony (np. niezgodność hydratacji) - geometria bywa wtedy poprawna, a nakładka błędu next dev i tak wisi
    // (tak było przy pierwszej wersji usePrefersReducedMotion w BriefingBlock.tsx).
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    await page.goto(`${WEB}/dev/player-harness?block=odprawa`);
    await page.getByTestId('briefing-block').waitFor();
    for (const [index, cta] of BRIEFING_CTAS.entries()) {
      const label = `${viewport.name} / odprawa krok ${index + 1} (${cta})`;
      await page.getByRole('button', { name: cta, exact: true }).waitFor();
      await page.waitForTimeout(100);
      await shot(page, `${viewport.name}-odprawa-${index + 1}`);
      if (pageErrors.length > 0) fail(`${label}: (p) błąd strony: ${pageErrors.join(' | ')}`);
      const scrolls = await checkBriefingStep(page, cta, label);
      step(`${label}: (a, e, m-p) OK${scrolls ? ' - krok przewija się wewnątrz odprawy (pionowo)' : ''}`, true);
      // Ostatni krok zapisuje blok - w podglądzie dev nie ma backendu, więc nie klikamy go.
      if (index < BRIEFING_CTAS.length - 1) await page.getByRole('button', { name: cta, exact: true }).click();
    }
    await context.close();
  }

  // DOSSIER (feat/dossier-folder, D-083) - patrz checkDossierDocument.
  for (const viewport of BRIEFING_VIEWPORTS) {
    console.log(`\n--- viewport (DOSSIER): ${viewport.name} ---`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    await page.goto(`${WEB}/dev/player-harness?block=akta-sprawy`);
    await page.getByTestId('dossier-block').waitFor();
    for (const [index, tab] of DOSSIER_TABS.entries()) {
      const label = `${viewport.name} / teczka: ${tab}`;
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(100);
      // Klikamy wiersze po kolei aż do pierwszego zakreślonego (aria-pressed=true) - stan z żółtym tłem i komunikatem
      // „Zakreślone…” też ma się zmieścić. Dokument bez dowodów (Procedury) kończy na komunikacie zwykłej linijki.
      const rowButtons = await page.getByTestId('dossier-rows').locator('button').all();
      for (const rowButton of rowButtons) {
        await rowButton.click();
        if ((await rowButton.getAttribute('aria-pressed')) === 'true') break;
      }
      await shot(page, `${viewport.name}-teczka-${index + 1}`);
      if (pageErrors.length > 0) fail(`${label}: (u) błąd strony: ${pageErrors.join(' | ')}`);
      const scrolls = await checkDossierDocument(page, label);
      step(`${label}: (a, e, q-u) OK${scrolls ? ' - lista wierszy przewija się wewnątrz arkusza' : ''}`, true);
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
