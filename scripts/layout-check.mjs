// Prawdziwy test UKŁADU karty hotspotu (i sceny) W PRZEGLĄDARCE, BEZ backendu (bez Postgresa/Redisa/apps/api) -
// druga runda code review fix/hotspot-card-fit/B-101 znalazła bugi, których żaden test jsdom (Investigation.test.tsx)
// nie mógł wykryć, bo jsdom nie liczy layoutu CSS (container query, grid, cqw/cqh) - tylko prawdziwy Chromium to
// widzi. Użycie: `node scripts/layout-check.mjs` (spawnuje `next dev` z NEXT_PUBLIC_DEV_HARNESS=1, strona
// apps/web/src/app/dev/player-harness/page.dev.tsx renderuje PlayerStage z prawdziwą treścią modułu 1 - wyłącznie
// packages/content, bez importu do bazy). NIE jest częścią CI (B-101 w backlogu: "layout-check w CI") - uruchamiany
// RĘCZNIE, lokalnie, przed pushem każdego PR-a zmieniającego układ odtwarzacza (CLAUDE.md, reguła 12).
//
// Sprawdza dla każdej kombinacji (viewport x przedmiot) stan ZBLIŻENIA przedmiotu (feat/scene-zoom, D-086 - zastąpiło kartę hotspotu):
//  a) <html> się nie przewija (scrollHeight/Width <= innerHeight/Width) - cała strona, nie tylko ramka.
//  b) nakładka zbliżenia ([data-testid="scene-zoom"]) w całości w obszarze bloku i w viewporcie.
//  c) grafika zbliżenia (obraz, dokument, transkrypcja, scena zagnieżdżona, opis przedmiotu bez grafiki) ma wysokość > 0, leży w
//     nakładce i nie przekracza 88% jej wymiarów.
//  d) przyciski nakładki (Zabierz/Odłóż, play/pauza, Transkrypcja, Wróć) W CAŁOŚCI w nakładce, w ramce odtwarzacza i w viewporcie,
//     cel dotyku >= 44px wysokości.
//  k) kamera (bez reduced-motion): środek klikniętego przedmiotu w środku nakładki (±2px), pudełko sceny z transformem.
//  e) (raz na viewport, przed otwarciem jakiegokolwiek zbliżenia) obraz GŁÓWNEJ sceny mieści się w obszarze bloku - bez
//     paska przewijania w tym obszarze (hotfix fix/player-scene-fit/B-100, ta sama rodzina bugów).
// Dla telefonu w pionie (390x844/360x800, feat/player-portrait, sekcja B) DODATKOWO (f-j), przez
// PORTRAIT_VIEWPORT_NAMES:
//  f) scena panuje WYŁĄCZNIE w poziomie (.scene-pan-container: scrollWidth>clientWidth, scrollHeight<=clientHeight) -
//     panorama faktycznie się włączyła, nie cichy fallback do "contain" (checkScenePansHorizontallyOnly).
//  g) startowa pozycja panoramy (scrollLeft) odpowiada data-initial-pan-x, które ScenePanContainer.tsx sam ustawił
//     na sobie (checkInitialPanX - nie duplikuje formuły centroidu hotspotów w tym skrypcie).
//  h) każdy hotspot (`[data-testid^="hotspot-overlay-"]`) ma cel dotyku >=44x44px (checkTouchTargetSize).
//  (b-d, k) jak wyżej - grafika i przyciski zbliżenia mieszczą się w WIDOCZNEJ części sceny (panorama jest szersza od ekranu).
//  j) cienie krawędzi panoramy/podpowiedź "przesuń" mieszczą się w viewporcie, nie przewijają się razem ze sceną
//     (checkPanoramaChromeInViewport - regresja znaleziona w code review, patrz ScenePanContainer.tsx).
// Zrzuty każdej sprawdzonej kombinacji trafiają do docs/brand/screens/layout-check/ (poza gitem, jak resztka
// docs/brand/screens/) - do wizualnej weryfikacji, niezależnie od wyniku. Pierwsze niepowodzenie zatrzymuje skrypt
// (kod wyjścia 1) z opisem: viewport, hotspot, który warunek i jakie wartości.
//
// DIALOGUE (fix/dialogue-sticky-questions, komunikator D-087): OSOBNA pętla (DIALOGUE_VIEWPORTS - 1920x1080, 1366x768, 844x390,
// 390x844) - `?block=rozmowa-anna` (packages/content/modules/wyludzone-haslo, 5 pytań, >= 12 wiadomości po zadaniu wszystkich).
// (g2) kolumna wątku max 760 px, wyśrodkowana; wskaźnik pisania w wątku, chipy nieaktywne, gdy rozmówca pisze. Sprawdza NA STARCIE
// (także w trakcie "pisania" kwestii otwierającej), W TRAKCIE (drugie pytanie, rozmówca pisze) i PO ZAKOŃCZENIU
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
// ZAMKNIĘCIE SPRAWY (feat/case-closed, D-089): ta sama lista rozdzielczości, `?block=rozwiazanie-sprawy` w trakcie ceremonii i w
// stanie końcowym (`&completed=1`) - (z1-z7) w komentarzu przy checkCaseClosed. Tylko ta sekcja: LAYOUT_CHECK_SECTION=closing.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
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

// DIALOGUE (fix/dialogue-sticky-questions; komunikator feat/dialogue-chat, D-087) - cztery rozdzielczości jak odprawa.
const DIALOGUE_VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '844x390', width: 844, height: 390 },
  { name: '390x844', width: 390, height: 844, isMobile: true },
];
const DIALOGUE_MIN_MESSAGES = 12;

// BRIEFING (feat/module-briefing, D-081) - `?block=odprawa`, cztery rozdzielczości z planu PR 1. reducedMotion:'reduce':
// każdy krok od razu w stanie końcowym (pisanie, spadająca karta, pieczątka), więc pomiar nie zależy od czasu animacji.
const BRIEFING_VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '844x390', width: 844, height: 390 },
  { name: '390x844', width: 390, height: 844, isMobile: true },
];
// Sceny odprawy (feat/briefing-scenes, D-084; bez przycisków cta od D-086): kolejne widoki (krok caseFile ma dwie fazy: zamknięta
// teczka -> akta). `item` - etykieta przedmiotu kroku (JEDYNE przejście dalej, przycisk na scenie); `fits` - elementy tekstowe/sloty
// na scenie (FitText), które muszą się zmieścić bez przepełnienia i leżeć w scenie; `clear` - elementy, które NIE mogą nachodzić na
// przedmiot (pasek tekstu nad telefonem, dymek obok czerwonej słuchawki); `image` - fragment nazwy pliku widocznego obrazu
// (reducedMotion:'reduce' w kontekście -> adres z #static, sprawdzane w checkBriefingScene).
const LEGITYMACJA_SLOTS = ['briefing-slot-photo', 'briefing-slot-name', 'briefing-slot-number'];
const BRIEFING_SCENE_VIEWS = [
  { item: 'Odbierz telefon', fits: ['briefing-scene-text'], clear: ['briefing-scene-text'], image: 'odprawa-biurko' },
  { item: 'Rozłącz', fits: ['briefing-bubble'], clear: ['briefing-bubble'], image: 'odprawa-rozmowa' },
  { item: 'Otwórz teczkę', fits: [], clear: [], image: 'odprawa-teczka', phase: 'closed' },
  { item: 'Zamknij teczkę', fits: ['briefing-slot-tasks'], clear: [], image: 'odprawa-akta', phase: 'open' },
  { item: 'Zabierz legitymację', fits: LEGITYMACJA_SLOTS, clear: [], image: 'odprawa-legitymacja', last: true },
];

// Tylko wybrane sekcje (szybka iteracja lokalna): LAYOUT_CHECK_SECTION=board,dialogue. Bez zmiennej - wszystko (tak do opisu PR).
const SECTIONS = ['hotspots', 'dialogue', 'catalog', 'reduced-motion', 'briefing', 'dossier', 'board', 'closing', 'motion', 'home', 'browser', 'bar', 'portrait', 'mobile-summary', 'easter', 'zoom-focus', 'mobile-module', 'single-next', 'achievements', 'module'];

// EASTER EGG (feat/easter-egg-game, D-100): okienka po ikonie gry na pulpicie (`?block=biuro-anny&hotspot=gra`) - cztery rozdzielczości
// i dwa telefony w pionie; uciekający przycisk tylko tam, gdzie jest mysz (desktop). Patrz sekcja w pętli głównej (e1-e8).
const EASTER_VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080, mouse: true },
  { name: '1366x768', width: 1366, height: 768, mouse: true },
  { name: '844x390', width: 844, height: 390 },
  { name: '390x844', width: 390, height: 844, isMobile: true },
  { name: '360x740', width: 360, height: 740, isMobile: true },
];

// KOŃCOWE PODSUMOWANIE NA TELEFONIE (feat/mobile-summary, D-099): dwa telefony w pionie, wszystkie bloki od rekonstrukcji do końca modułu
// (tablica śledcza, ostatnie pytanie w oknie przeglądarki, rozwiązanie sprawy, zamknięcie) w kolejnych stanach - patrz auditMobileView.
const MOBILE_SUMMARY_VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, isMobile: true },
  { name: '360x740', width: 360, height: 740, isMobile: true },
];
const MOBILE_MIN_FONT_PX = 15;
const MOBILE_MIN_TARGET_PX = 44;

// SCENY PIONOWE (feat/portrait-scenes, D-098): dwa telefony w pionie (pionowe grafiki) i telefon w poziomie (stare grafiki 16:9).
const PORTRAIT_SCENE_VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, isMobile: true, portrait: true },
  { name: '360x740', width: 360, height: 740, isMobile: true, portrait: true },
  { name: '844x390', width: 844, height: 390, portrait: false },
];

// DOLNY PASEK NA TELEFONIE (fix/mobile-player-bar): dwa telefony w pionie (scena < 640 px - jeden rząd ikon) i telefon w poziomie
// (scena >= 640 px - układ jak na desktopie). Bloki: scena z narracją, rozmowa (chipy), zadanie tekstowe (slajd).
const BAR_VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, isMobile: true },
  { name: '360x740', width: 360, height: 740, isMobile: true },
  { name: '844x390', width: 844, height: 390 },
];
const BAR_BLOCKS = ['biuro-anny', 'rozmowa-anna', 'ostatnie-pytanie'];
const ONLY = process.env.LAYOUT_CHECK_SECTION?.split(',').filter(Boolean) ?? [];
for (const name of ONLY) if (!SECTIONS.includes(name)) throw new Error(`Nieznana sekcja LAYOUT_CHECK_SECTION: ${name} (są: ${SECTIONS.join(', ')})`);
// Moduł (B-128): LAYOUT_CHECK_MODULE=<slug> - sekcja `module` przechodzi wszystkie bloki TEGO modułu (harness `?module=<slug>`).
// Pozostałe sekcje sprawdzają konkretne elementy treści modułu 1 (id bloków, hotspotów), więc dla innego modułu są pomijane.
const DEFAULT_MODULE = 'wyludzone-haslo';
const MODULE_SLUG = process.env.LAYOUT_CHECK_MODULE || DEFAULT_MODULE;
if (!/^[a-z0-9-]{1,64}$/.test(MODULE_SLUG) || !existsSync(join(process.cwd(), 'packages', 'content', 'modules', MODULE_SLUG, 'module.json'))) {
  throw new Error(`LAYOUT_CHECK_MODULE: nie ma modułu "${MODULE_SLUG}" w packages/content/modules.`);
}
// Dla innego modułu tylko sekcje ogólne: `module` (każdy blok) i `catalog` (miniatura i karta kursu z `?module=`).
const GENERIC_SECTIONS = ['module', 'catalog'];
if (MODULE_SLUG !== DEFAULT_MODULE) {
  const unsupported = ONLY.filter((name) => !GENERIC_SECTIONS.includes(name));
  if (unsupported.length > 0) {
    throw new Error(`LAYOUT_CHECK_MODULE=${MODULE_SLUG}: dostępne są tylko sekcje ${GENERIC_SECTIONS.join(', ')} (pozostałe sprawdzają treść modułu 1): ${unsupported.join(', ')}`);
  }
}
const MODULE_TITLE = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', MODULE_SLUG, 'module.json'), 'utf8')).title;
const runs = (section) =>
  MODULE_SLUG !== DEFAULT_MODULE && !GENERIC_SECTIONS.includes(section) ? false : ONLY.length === 0 || ONLY.includes(section);

// TABLICA ŚLEDCZA (ORDERING, feat/evidence-board, D-088) - `?block=rekonstrukcja`, te same cztery rozdzielczości; stany: pusta, w trakcie
// (3 ślady przypięte), po sprawdzeniu (odpowiedź serwera podstawiona przez page.route - harness nie ma backendu).
const BOARD_CORRECT_ORDER = ['mail', 'link', 'login', 'telefon', 'kod', 'przelew'];

// DOSSIER (feat/dossier-folder, D-083) - `?block=akta-sprawy`, te same cztery rozdzielczości co odprawa, każdy dokument.
const DOSSIER_TABS = ['Wyciąg bankowy', 'Logi logowania', 'Notatka IT', 'Procedury'];

// hotspotId: parametr ?hotspot= strony harnessu (HarnessAutoOpen.tsx klika przez niego, drilling w głąb dla
// zagnieżdżonych - "outlook" samo dociera do zbliżenia maila przez monitor). block: inny blok modułu niż domyślny (biuro).
// postOpen: dodatkowa interakcja PO otwarciu (transkrypcja, "Zabierz" przy przedmiocie bez dowodu - toast). nested: przedmiot
// WEWNĄTRZ sceny zagnieżdżonej (faza "inner-open", kamera na pulpicie - bez sprawdzenia (k) na scenie głównej). scene: zbliżenie
// przechodzi w scenę zagnieżdżoną (bez Zabierz/Odłóż). noMedia: ?stripMedia=1 (page.tsx) usuwa media prawdziwemu przedmiotowi -
// gałąź "opis zamiast grafiki" (treść sprzed D-086).
const HOTSPOT_CASES = [
  { name: 'karteczka', hotspotId: 'karteczka' },
  { name: 'kalendarz', hotspotId: 'kalendarz' },
  { name: 'drukarka', hotspotId: 'drukarka' },
  { name: 'kubek', hotspotId: 'kubek' },
  {
    name: 'kubek+zabierz (nie dowód)',
    hotspotId: 'kubek',
    async postOpen(page) {
      await page.getByRole('dialog').getByRole('button', { name: 'Zabierz' }).click();
      await page.getByRole('dialog').getByRole('status').waitFor();
    },
  },
  { name: 'telefon (audio)', hotspotId: 'telefon' },
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
  { name: 'monitor-pulpit (scena)', hotspotId: 'monitor', scene: true },
  { name: 'outlook-mail', hotspotId: 'outlook', nested: true },
  // Historia przeglądarki (feat/browser-evidence) - druga ikona pulpitu, zbliżenie z Zabierz/Odłóż jak outlook.
  { name: 'przegladarka-historia', hotspotId: 'przegladarka', nested: true },
  { name: 'tablica (korytarz)', hotspotId: 'tablica', block: 'korytarz' },
  { name: 'karteczka-bez-mediow', hotspotId: 'karteczka', extraQuery: 'stripMedia=1' },
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

function contains(outer, inner) {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

// Zbliżenie przedmiotu (D-086) - (b-d) z komentarza na górze pliku. Grafika: ostatni widoczny element treści zbliżenia (dla
// przedmiotu w scenie zagnieżdżonej - jego zbliżenie, nie pulpit pod spodem), dla sceny zagnieżdżonej - pudełko pulpitu.
async function checkZoomFits(page, testCase, label) {
  const viewport = page.viewportSize();
  const viewportBox = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const zoomBox = await boxOf(page, '[data-testid="scene-zoom"]');
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  const frameBox = await boxOf(page, '.player-frame');
  if (!contains(contentAreaBox, zoomBox) || !contains(viewportBox, zoomBox)) {
    fail(`${label}: (b) nakładka zbliżenia poza obszarem bloku/viewportem - nakładka=${JSON.stringify(zoomBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  }

  const dialog = page.getByRole('dialog');
  const graphic = testCase.scene
    ? dialog.locator('.hotspot-nested-scene-box')
    : dialog.getByTestId('scene-zoom-graphic').last().locator(':scope > img, :scope > div, :scope > p, :scope > [role="region"]').first();
  const graphicBox = await graphic.boundingBox();
  if (!graphicBox || graphicBox.height <= 0) fail(`${label}: (c) grafika zbliżenia niewidoczna albo zerowej wysokości - ${JSON.stringify(graphicBox)}.`);
  if (!contains(zoomBox, graphicBox)) fail(`${label}: (c) grafika wychodzi poza nakładkę - grafika=${JSON.stringify(graphicBox)} nakładka=${JSON.stringify(zoomBox)}.`);
  if (graphicBox.height > zoomBox.height * 0.88 + 1 || graphicBox.width > zoomBox.width * 0.88 + 1) {
    fail(`${label}: (c) grafika większa niż 88% nakładki - grafika=${graphicBox.width}x${graphicBox.height} nakładka=${zoomBox.width}x${zoomBox.height}.`);
  }

  const buttons = await dialog.getByRole('button').all();
  const names = [];
  for (const button of buttons) {
    if ((await button.getAttribute('data-testid'))?.startsWith('hotspot-overlay-')) continue; // przedmioty sceny zagnieżdżonej - (h)
    const box = await button.boundingBox();
    if (!box) continue;
    const name = (await button.getAttribute('aria-label')) ?? (await button.textContent())?.trim() ?? '?';
    names.push(name);
    if (!contains(zoomBox, box) || !contains(frameBox, box) || !contains(viewportBox, box)) {
      fail(`${label}: (d) przycisk "${name}" wychodzi poza nakładkę/ramkę/viewport - przycisk=${JSON.stringify(box)} nakładka=${JSON.stringify(zoomBox)}.`);
    }
    if (box.height < 44 - 0.5) fail(`${label}: (d) przycisk "${name}" ma ${box.height}px wysokości (<44px).`);
  }
  const expected = testCase.scene ? ['Wróć'] : ['Odłóż'];
  for (const name of expected) if (!names.includes(name)) fail(`${label}: (d) brak przycisku "${name}" (są: ${names.join(', ')}).`);
  return names;
}

// (k) Kamera: środek klikniętego przedmiotu (sceny głównej) w środku nakładki - przedmiot "podjechał" na środek widoku.
async function checkCameraCentersItem(page, hotspotId, label) {
  const zoomBox = await boxOf(page, '[data-testid="scene-zoom"]');
  const itemBox = await page.getByTestId(`hotspot-overlay-${hotspotId}`).first().boundingBox();
  if (!itemBox) fail(`${label}: (k) przedmiot "${hotspotId}" niewidoczny.`);
  const dx = itemBox.x + itemBox.width / 2 - (zoomBox.x + zoomBox.width / 2);
  const dy = itemBox.y + itemBox.height / 2 - (zoomBox.y + zoomBox.height / 2);
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) fail(`${label}: (k) środek przedmiotu przesunięty względem środka nakładki o (${dx.toFixed(1)}, ${dy.toFixed(1)})px.`);
  const transform = await page.locator('.scene-box').first().evaluate((el) => getComputedStyle(el).transform);
  if (!transform || transform === 'none') fail(`${label}: (k) pudełko sceny bez transformu kamery.`);
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

// Komunikator (D-087): rozmówca "pisze" przed każdą kwestią - `data-typing` na wątku mówi, czy właśnie pisze.
async function waitChatIdle(page) {
  await page.locator('[role="log"][data-typing="false"]').waitFor({ timeout: 20000 });
}

// Klika NAJWYŻEJ `maxQuestions` kolejnych dostępnych pytań, za każdym razem czekając, aż rozmówca skończy pisać (wszystkie kwestie
// pytania). `stopWhileTyping`: po ostatnim kliknięciu NIE czeka - stan pośredni ze wskaźnikiem pisania. Kończy wcześniej, gdy lista
// "Pytania do zadania" znika z DOM (wszystkie zadane).
async function clickSomeDialogueQuestions(page, maxQuestions, { stopWhileTyping = false } = {}) {
  const questionList = page.getByRole('list', { name: 'Pytania do zadania' });
  for (let asked = 0; asked < maxQuestions; asked += 1) {
    await waitChatIdle(page);
    if ((await questionList.count()) === 0) return;
    const chips = questionList.getByRole('button');
    if ((await chips.count()) === 0) return;
    await chips.first().click();
    if (stopWhileTyping && asked === maxQuestions - 1) {
      await page.getByTestId('dialogue-typing').waitFor();
      return;
    }
  }
  await waitChatIdle(page);
}

// (g2) Kolumna wątku: max 760 px i wyśrodkowana w wątku (tolerancja na pasek przewijania); wskaźnik pisania (gdy jest) w obszarze
// wątku; chipy nieaktywne (aria-disabled), gdy rozmówca pisze.
async function checkChatColumn(page, label) {
  const log = await boxOf(page, '[role="log"]');
  const thread = await boxOf(page, '[data-testid="dialogue-thread"]');
  if (thread.width > 760 + 0.5) fail(`${label}: (g2) kolumna wątku ma ${thread.width}px (> 760px).`);
  if (log.height < 80) fail(`${label}: (g2) wątek ma tylko ${log.height}px wysokości (< 80px) - rozmowy nie widać.`);
  const left = thread.x - log.x;
  const right = log.x + log.width - (thread.x + thread.width);
  if (Math.abs(left - right) > 20) fail(`${label}: (g2) kolumna wątku nie jest wyśrodkowana (lewy margines ${left.toFixed(1)}px, prawy ${right.toFixed(1)}px).`);
  const typing = page.getByTestId('dialogue-typing');
  if ((await typing.count()) > 0) {
    // Chipy od razu po wykryciu wskaźnika (krótka kwestia może skończyć się "pisać" w czasie czekania na przewinięcie niżej).
    for (const chip of await page.getByRole('list', { name: 'Pytania do zadania' }).getByRole('button').all()) {
      if ((await typing.count()) === 0) break;
      if ((await chip.getAttribute('aria-disabled')) !== 'true') fail(`${label}: (g2) chip "${await chip.textContent()}" aktywny, gdy rozmówca pisze.`);
    }
    // Autoprzewijanie (smooth) do wskaźnika może jeszcze trwać - do 3 s na dojechanie, zanim zmierzymy.
    await page
      .waitForFunction(
        () => {
          const logEl = document.querySelector('[role="log"]');
          const typingEl = document.querySelector('[data-testid="dialogue-typing"]');
          if (!logEl || !typingEl) return true;
          return typingEl.getBoundingClientRect().bottom <= logEl.getBoundingClientRect().bottom + 0.5;
        },
        undefined,
        { timeout: 3000 },
      )
      .catch(() => {});
    const box = await typing.boundingBox();
    // Wskaźnik mógł w międzyczasie zniknąć (kwestia przyszła) - wtedy nie ma czego mierzyć.
    if (box && !contains(log, box)) fail(`${label}: (g2) wskaźnik pisania poza wątkiem - ${JSON.stringify(box)}, wątek=${JSON.stringify(log)}.`);
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
// (o) "Pomiń odprawę" w całości w górnym pasku (na ostatnim kroku go nie ma - nie ma czego pomijać, D-106), a sam pasek nie wypycha
// treści poza siebie (tytuł się skraca, nie przycisk/Notatnik). Wraca też nazwę kroku, który przewija się wewnętrznie (informacyjnie).
async function checkBriefingStep(page, cta, label, last = false) {
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

  // D-086: jedynym przyciskiem kroku jest przedmiot na scenie (bez osobnego cta pod sceną).
  const button = page.getByRole('button', { name: cta, exact: true });
  if ((await button.count()) !== 1) fail(`${label}: (n) oczekiwany dokładnie jeden przycisk "${cta}" (przedmiot), jest ${await button.count()}.`);
  if ((await button.getAttribute('data-testid')) !== 'briefing-hotspot') fail(`${label}: (n) "${cta}" nie jest przedmiotem na scenie.`);
  await button.scrollIntoViewIfNeeded();
  const buttonBox = await button.boundingBox();
  if (!buttonBox) fail(`${label}: (n) przycisk "${cta}" niewidoczny.`);
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  const frameBox = await boxOf(page, '.player-frame');
  if (!contains(contentAreaBox, buttonBox) || !contains(frameBox, buttonBox)) {
    fail(`${label}: (n) przycisk "${cta}" wychodzi poza obszar bloku/ramkę - przycisk=${JSON.stringify(buttonBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  }

  const skip = page.getByRole('button', { name: 'Pomiń odprawę' });
  const topbar = page.locator('.player-topbar');
  const topbarBox = await boxOf(page, '.player-topbar');
  if (last) {
    if ((await skip.count()) !== 0) fail(`${label}: (o) "Pomiń odprawę" na ostatnim kroku (nie ma czego pomijać).`);
  } else {
    const skipBox = await skip.boundingBox();
    if (!skipBox || !contains(topbarBox, skipBox)) {
      fail(`${label}: (o) "Pomiń odprawę" poza górnym paskiem - przycisk=${JSON.stringify(skipBox)} pasek=${JSON.stringify(topbarBox)}.`);
    }
  }
  const topbarOverflow = await topbar.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (topbarOverflow > 1) fail(`${label}: (o) górny pasek przepełniony w poziomie o ${topbarOverflow}px.`);
  return scrollHeight > clientHeight + 1;
}

// Sceny odprawy (D-084), dla każdego widoku: (v) obraz sceny załadowany (lokalne assets/ przez /dev/module-assets) i to ten
// właściwy (faza teczki), z #static przy reduced-motion; (w) scena w CAŁOŚCI w obszarze bloku, a krok ze sceną nie
// przewija się wcale; (x) każdy tekst/slot (FitText) bez przepełnienia i w granicach sceny; (y) dymek rozmowy w prawej połowie
// sceny (x >= 45%) i bez części wspólnej z telefonem (lewa część sceny, x < 40%); pasek tekstu nad hotspotem telefonu, bez
// części wspólnej; (z) hotspot (gdy jest) w scenie.
async function checkBriefingScene(page, view, label, expectPortrait = false) {
  const scene = page.getByTestId('briefing-scene');
  const sceneBox = await boxOf(page, '[data-testid="briefing-scene"]');
  // (v') Orientacja sceny (D-098): telefon w pionie - pionowa grafika (*-pion.svg, 9:16); poziomo - scena 16:9 jak dotąd.
  const orientation = await scene.getAttribute('data-orientation');
  if (orientation !== (expectPortrait ? 'portrait' : 'landscape')) fail(`${label}: (v') scena "${orientation}" zamiast "${expectPortrait ? 'portrait' : 'landscape'}".`);
  const ratio = sceneBox.width / sceneBox.height;
  if (Math.abs(ratio - (expectPortrait ? 9 / 16 : 16 / 9)) > 0.03) fail(`${label}: (v') proporcje sceny ${ratio.toFixed(3)}.`);
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  if (!contains(contentAreaBox, sceneBox)) fail(`${label}: (w) scena wychodzi poza obszar bloku - scena=${JSON.stringify(sceneBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  const briefingScroll = await page.getByTestId('briefing-block').evaluate((el) => el.scrollHeight - el.clientHeight);
  if (briefingScroll > 1) fail(`${label}: (w) krok ze sceną przewija się o ${briefingScroll}px.`);
  if (view.phase && (await scene.getAttribute('data-phase')) !== view.phase) fail(`${label}: (v) faza teczki inna niż "${view.phase}".`);

  const visibleImage = await scene.evaluate((el) => {
    const images = [...el.querySelectorAll('img')].filter((img) => getComputedStyle(img).opacity !== '0');
    const top = images[images.length - 1];
    return top ? { src: top.getAttribute('src'), loaded: top.complete && top.naturalWidth > 0 } : null;
  });
  if (!visibleImage?.loaded) fail(`${label}: (v) obraz sceny się nie załadował - ${JSON.stringify(visibleImage)}.`);
  const expectedImage = expectPortrait ? `${view.image}-pion` : `${view.image}.`;
  if (!visibleImage.src.includes(expectedImage)) fail(`${label}: (v) widoczny obraz "${visibleImage.src}" zamiast "${expectedImage}".`);
  if (!visibleImage.src.endsWith('#static')) fail(`${label}: (v) reduced-motion, a obraz sceny bez #static: ${visibleImage.src}.`);

  const rel = (box) => ({ x: ((box.x - sceneBox.x) / sceneBox.width) * 100, y: ((box.y - sceneBox.y) / sceneBox.height) * 100, right: ((box.x + box.width - sceneBox.x) / sceneBox.width) * 100, bottom: ((box.y + box.height - sceneBox.y) / sceneBox.height) * 100 });
  const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  for (const testId of view.fits) {
    const element = page.getByTestId(testId);
    if ((await element.count()) !== 1) fail(`${label}: (x) brak elementu "${testId}" na scenie.`);
    const box = await element.boundingBox();
    if (!box || !contains(sceneBox, box)) fail(`${label}: (x) "${testId}" poza sceną - ${JSON.stringify(box)} scena=${JSON.stringify(sceneBox)}.`);
    const overflow = await element.evaluate((el) => ({
      x: el.scrollWidth - el.clientWidth,
      y: el.scrollHeight - el.clientHeight,
      font: parseFloat(getComputedStyle(el).fontSize),
      visible: getComputedStyle(el).overflow === 'visible',
    }));
    // D-103: tekst na czytelnym minimum (FitText minPx, >= 15 px) może być wyższy niż niski slot - jest wtedy widoczny w całości
    // (overflow visible, pudełko elementu i tak musi leżeć w scenie - wyżej). Szerokość zawsze musi się mieścić.
    const readableOverflow = overflow.visible && overflow.font >= 14.9 && overflow.y <= overflow.font * 0.5;
    if (overflow.x > 1 || (overflow.y > 1 && !readableOverflow)) fail(`${label}: (x) "${testId}" przepełniony (x=${overflow.x}px, y=${overflow.y}px, czcionka ${overflow.font}px).`);
    if (testId === 'briefing-bubble') {
      const r = rel(box);
      if (orientation === 'portrait') {
        // Scena pionowa (D-098): dymek komisarza w dolnej części sceny (y >= 62%), pod telefonem; nachodzenie na słuchawkę - `clear` niżej.
        if (r.y < 62 - 0.5) fail(`${label}: (y) dymek zaczyna się na ${r.y.toFixed(1)}% wysokości pionowej sceny (ma być >= 62%).`);
      } else {
        if (r.x < 45 - 0.5) fail(`${label}: (y) dymek zaczyna się na ${r.x.toFixed(1)}% szerokości sceny (ma być >= 45%).`);
        if (overlaps(r, { x: 0, y: 0, right: 40, bottom: 100 })) fail(`${label}: (y) dymek nachodzi na telefon (lewa część sceny).`);
      }
    }
  }
  const hotspotBox = await page.getByTestId('briefing-hotspot').boundingBox();
  if (!hotspotBox || !contains(sceneBox, hotspotBox)) fail(`${label}: (z) przedmiot poza sceną - ${JSON.stringify(hotspotBox)}.`);
  for (const testId of view.clear) {
    if (overlaps(rel(await page.getByTestId(testId).boundingBox()), rel(hotspotBox))) fail(`${label}: (y) "${testId}" nachodzi na przedmiot "${view.item}".`);
  }
}

// Przejście przez kroki odprawy (sceny D-084) z pomiarem każdego widoku. Przedmiot ostatniego kroku to akcja (D-106): aktywuje „Dalej”
// w pasku, nie zapisuje bloku - sprawdzamy, że po nim jest dokładnie jeden, aktywny „Dalej” (w pasku), i na nim kończymy.
async function walkBriefing(page, viewport, pageErrors, expectPortrait) {
  await page.goto(`${WEB}/dev/player-harness?block=odprawa`);
  await page.getByTestId('briefing-block').waitFor();
  for (const [index, view] of BRIEFING_SCENE_VIEWS.entries()) {
    const { item: cta } = view;
    const label = `${viewport.name} / odprawa widok ${index + 1} (${cta})`;
    await page.getByRole('button', { name: cta, exact: true }).waitFor();
    // Obraz sceny i dopasowanie tekstu (ResizeObserver) - chwila na załadowanie przed pomiarem.
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="briefing-scene"] img')].every((img) => img.complete));
    await page.waitForTimeout(150);
    await shot(page, `${viewport.name}-odprawa-${index + 1}`);
    if (pageErrors.length > 0) fail(`${label}: (p) błąd strony: ${pageErrors.join(' | ')}`);
    const scrolls = await checkBriefingStep(page, cta, label, !!view.last);
    await checkBriefingScene(page, view, label, expectPortrait);
    await checkSingleNext(page, label);
    step(`${label}: (a, e, m-p, v-z, j1, j2) OK - ${expectPortrait ? 'pion' : 'poziom'}${scrolls ? ', krok przewija się wewnątrz odprawy (pionowo)' : ''}`, true);
    await page.getByTestId('briefing-hotspot').click();
    if (view.last) {
      await page.getByTestId('player-bottombar').locator('.pbar-next:enabled').waitFor({ timeout: 3000 }).catch(() => fail(`${label}: (j) po „${cta}” „Dalej” w pasku nieaktywny.`));
      await checkSingleNext(page, label);
      step(`${label}: (j1, j2) „${cta}” to akcja - jeden aktywny „Dalej” w pasku`, true);
      break;
    }
  }
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

// TABLICA ŚLEDCZA (D-088), w każdym stanie: (a) strona się nie przewija, (e) obszar bloku się nie przewija; (b1) tablica w całości w
// obszarze bloku, bez przewijania samej tablicy; (b2) każde pole, przypięta karta, zdjęcie i tacka w całości w tablicy, pola i karty
// się nie nakładają; (b3) tekst żadnej karty (na polu i na tacce) nie jest ucięty; (b4) liczba kart na tacce, "Sprawdź trop" tylko przy
// pełnej tablicy, cel dotyku kart >= 24 px; (b5) po sprawdzeniu: nić cała ciągła, zdanie informacji zwrotnej w tacce; (j1, j2) jeden
// „Dalej” - w dolnym pasku, aktywny (D-106). Informacyjnie: najmniejsza czcionka karty w px.
async function checkEvidenceBoard(page, label, { trayCards, result = false }) {
  await checkNoPageScroll(page, label);
  await checkMainSceneFits(page, label);
  const boardBox = await boxOf(page, '[data-testid="evidence-board"]');
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  if (!contains(contentAreaBox, boardBox)) fail(`${label}: (b1) tablica poza obszarem bloku - ${JSON.stringify(boardBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  const info = await page.evaluate(() => {
    const board = document.querySelector('[data-testid="evidence-board"]');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const pieces = [
      ...[...board.querySelectorAll('[data-slot-index]')].map((el) => ({ kind: el.dataset.cardId ? 'karta' : 'pole', index: el.dataset.slotIndex, box: rect(el) })),
      ...[...board.querySelectorAll('[data-board-photo]')].map((el, i) => ({ kind: 'zdjęcie', index: String(i), box: rect(el) })),
    ];
    const texts = [...board.querySelectorAll('.board-card > span')].map((span) => ({
      text: span.textContent.slice(0, 30),
      clipped: span.scrollHeight > span.clientHeight + 1 || span.scrollWidth > span.clientWidth + 1,
      font: parseFloat(getComputedStyle(span).fontSize),
    }));
    const tray = board.querySelector('[data-board-tray]');
    return {
      pieces,
      texts,
      tray: rect(tray),
      trayCards: tray.querySelectorAll('[data-card-id]').length,
      check: !!board.querySelector('button') && [...board.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sprawdź trop'),
      dashed: board.querySelectorAll('[data-yarn="dashed"]').length,
      feedback: board.querySelector('[data-testid="board-feedback"]')?.textContent ?? '',
      barNextEnabled: !document.querySelector('[data-testid="player-bottombar"] .pbar-next')?.disabled,
      overflow: board.scrollHeight - board.clientHeight,
    };
  });
  if (info.overflow > 1) fail(`${label}: (b1) tablica przewija się o ${info.overflow}px.`);
  if (!contains(boardBox, info.tray)) fail(`${label}: (b2) tacka poza tablicą - ${JSON.stringify(info.tray)}.`);
  for (const piece of info.pieces) {
    // Karty są lekko obrócone (±2°) - tolerancja kilku pikseli na narożniki.
    const grown = { x: boardBox.x - 4, y: boardBox.y - 4, width: boardBox.width + 8, height: boardBox.height + 8 };
    if (!contains(grown, piece.box)) fail(`${label}: (b2) ${piece.kind} ${Number(piece.index) + 1} poza tablicą - ${JSON.stringify(piece.box)}.`);
  }
  for (let i = 0; i < info.pieces.length; i += 1) {
    for (let j = i + 1; j < info.pieces.length; j += 1) {
      const a = info.pieces[i].box;
      const b = info.pieces[j].box;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 4 && overlapY > 4) {
        fail(`${label}: (b2) ${info.pieces[i].kind} ${Number(info.pieces[i].index) + 1} i ${info.pieces[j].kind} ${Number(info.pieces[j].index) + 1} nachodzą na siebie.`);
      }
    }
  }
  const clipped = info.texts.filter((t) => t.clipped);
  if (clipped.length > 0) fail(`${label}: (b3) ucięty tekst karty: ${clipped.map((t) => `„${t.text}…” (${t.font}px)`).join(', ')}.`);
  if (info.trayCards !== trayCards) fail(`${label}: (b4) na tacce ${info.trayCards} kart, oczekiwano ${trayCards}.`);
  if (!result && info.check !== (trayCards === 0)) fail(`${label}: (b4) "Sprawdź trop" ${info.check ? 'widoczne' : 'niewidoczne'} przy ${trayCards} kartach na tacce.`);
  for (const piece of info.pieces) {
    if (piece.box.width < 24 || piece.box.height < 24) fail(`${label}: (b4) ${piece.kind} ${Number(piece.index) + 1} ma cel dotyku ${piece.box.width}x${piece.box.height}px.`);
  }
  if (result) {
    if (info.dashed !== 0) fail(`${label}: (b5) po sprawdzeniu nić ma ${info.dashed} przerywanych odcinków.`);
    if (!info.feedback.trim()) fail(`${label}: (b5) brak zdania informacji zwrotnej.`);
    if (!info.barNextEnabled) fail(`${label}: (b5) „Dalej” w dolnym pasku nieaktywny po sprawdzeniu.`);
  }
  await checkSingleNext(page, label);
  const minFont = Math.min(...info.texts.map((t) => t.font));
  if (Number.isFinite(minFont)) console.log(`     (informacyjnie) najmniejsza czcionka karty: ${minFont.toFixed(1)}px`);
}

// JEDEN „DALEJ” (D-106): (j1) w obszarze bloku (treść, scena, nakładki, wynik) nie ma ŻADNEGO przycisku/linku nawigacji dalej
// („Dalej”, „Kontynuuj”, „Przejdź dalej”, „Zakończ scenę”, „Sprawdź i dalej”, „Zakończ sprawę/szkolenie”, „Wróć do biblioteki”,
// „Wchodzę”); (j2) w dolnym pasku jest dokładnie jeden przycisk dalej (.pbar-next). Akcje w bloku („Sprawdź trop”, „Zatwierdź”,
// Zabierz/Odłóż, krzyżyki okienek) są dozwolone.
const IN_BLOCK_NEXT = '^(Dalej|Kontynuuj|Przejdź dalej|Zakończ scenę|Sprawdź i dalej|Zakończ sprawę|Zakończ szkolenie|Wróć do biblioteki|Wchodzę)$';
async function checkSingleNext(page, label) {
  const info = await page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    const content = document.querySelector('[data-testid="player-content-area"]');
    const bar = document.querySelector('[data-testid="player-bottombar"]');
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    const inBlock = content ? [...content.querySelectorAll('button, a[href], [role="button"], [role="link"]')].filter((el) => re.test(name(el))).map(name) : ['brak obszaru bloku'];
    return { inBlock, forward: bar ? [...bar.querySelectorAll('.pbar-next')].map(name) : [] };
  }, IN_BLOCK_NEXT);
  if (info.inBlock.length > 0) fail(`${label}: (j1) przycisk nawigacji dalej w bloku: ${info.inBlock.join(', ')}.`);
  if (info.forward.length !== 1) fail(`${label}: (j2) w dolnym pasku ${info.forward.length} przycisków dalej (oczekiwany 1): ${info.forward.join(', ')}.`);
  return info.forward[0];
}

// TABLICA ZYGZAKIEM (telefon w pionie, D-105, zastępuje listę z D-099): (a) strona się nie przewija; (s1-s5) audyt telefonu (pasek tacki
// przewija się w poziomie celowo); (g1) tablica z korkiem i nicią (data-layout=zigzag), pola na przemian przy lewej i prawej krawędzi,
// każde pod poprzednim (bez nakładania); (g2) tekst każdej karty na scenie >= 15 px i nieucięty; (g3) w trakcie: tacka to pasek POD
// przewijaną sceną (nie w niej), w ekranie, z oczekiwaną liczbą śladów, „Sprawdź trop” tylko przy pustej tacce; (g4) po sprawdzeniu:
// nić ciągła, zdanie informacji zwrotnej NAD sceną, w ekranie (widoczne bez przewijania), „Dalej” w dolnym pasku aktywny; (j1, j2)
// jeden „Dalej” (D-106).
async function checkEvidenceZigzag(page, label, { trayCards, result = false }) {
  await checkNoPageScroll(page, label);
  await auditMobileView(page, label, { scrollX: '[data-board-tray] ul' });
  const info = await page.evaluate(() => {
    const board = document.querySelector('[data-testid="evidence-board"]');
    const outer = document.querySelector('[data-testid="board-outer"]');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const buttons = [...document.querySelectorAll('[data-testid="player-content-area"] button')];
    const result = document.querySelector('[role="group"][aria-label="Wynik"]');
    const tray = document.querySelector('[data-board-tray]');
    return {
      layout: board.dataset.layout,
      cork: !!board.querySelector('.board-cork'),
      yarn: board.querySelectorAll('[data-yarn]').length,
      dashed: board.querySelectorAll('[data-yarn="dashed"]').length,
      slots: [...board.querySelectorAll('[data-slot-index]')].sort((a, b) => Number(a.dataset.slotIndex) - Number(b.dataset.slotIndex)).map(rect),
      texts: [...board.querySelectorAll('.board-card > span')].map((span) => ({
        text: span.textContent.slice(0, 30),
        clipped: span.scrollHeight > span.clientHeight + 1 || span.scrollWidth > span.clientWidth + 1,
        font: parseFloat(getComputedStyle(span).fontSize),
      })),
      outer: rect(outer),
      tray: tray ? rect(tray) : null,
      trayInBoard: tray ? board.contains(tray) : false,
      trayCards: tray ? tray.querySelectorAll('[data-card-id]').length : 0,
      check: buttons.some((b) => b.textContent.trim() === 'Sprawdź trop'),
      feedback: document.querySelector('[data-testid="board-feedback"]')?.textContent ?? '',
      result: result ? rect(result) : null,
      barNextEnabled: !document.querySelector('[data-testid="player-bottombar"] .pbar-next')?.disabled,
      viewportHeight: innerHeight,
    };
  });
  if (info.layout !== 'zigzag' || !info.cork || info.yarn === 0) fail(`${label}: (g1) nie tablica zygzakiem z korkiem i nicią - ${JSON.stringify({ layout: info.layout, cork: info.cork, yarn: info.yarn })}.`);
  for (let i = 1; i < info.slots.length; i += 1) {
    const [a, b] = [info.slots[i - 1], info.slots[i]];
    if (Math.abs(a.x - b.x) < 10) fail(`${label}: (g1) pola ${i} i ${i + 1} nie na przemian (x ${Math.round(a.x)} i ${Math.round(b.x)}).`);
    // Karty lekko obrócone (±2°) - tolerancja kilku pikseli.
    if (b.y < a.y + a.height - 6) fail(`${label}: (g1) pole ${i + 1} nachodzi na pole ${i}.`);
  }
  const bad = info.texts.filter((t) => t.clipped || t.font < MOBILE_MIN_FONT_PX - 0.05);
  if (bad.length > 0) fail(`${label}: (g2) karty ucięte albo < 15 px: ${bad.map((t) => `„${t.text}…” (${t.font}px${t.clipped ? ', ucięta' : ''})`).join(', ')}.`);
  if (!result) {
    if (!info.tray || info.trayInBoard) fail(`${label}: (g3) tacka nie jest paskiem pod sceną.`);
    else if (info.tray.y < info.outer.y + info.outer.height - 1 || info.tray.y + info.tray.height > info.viewportHeight + 1) fail(`${label}: (g3) tacka nie pod sceną albo poza ekranem - tacka=${JSON.stringify(info.tray)} scena=${JSON.stringify(info.outer)}.`);
    if (info.trayCards !== trayCards) fail(`${label}: (g3) na tacce ${info.trayCards} śladów, oczekiwano ${trayCards}.`);
    if (info.check !== (trayCards === 0)) fail(`${label}: (g3) "Sprawdź trop" ${info.check ? 'widoczne' : 'niewidoczne'} przy ${trayCards} śladach na tacce.`);
  } else {
    if (info.dashed !== 0) fail(`${label}: (g4) po sprawdzeniu nić ma ${info.dashed} przerywanych odcinków.`);
    const resultOk = info.result && info.result.y + info.result.height <= info.outer.y + 1 && info.result.y >= 0 && info.result.y + info.result.height <= info.viewportHeight + 1;
    if (!info.feedback.trim() || !resultOk) fail(`${label}: (g4) wynik - zdanie „${info.feedback}”, panel ${JSON.stringify(info.result)} (oczekiwany nad sceną ${JSON.stringify(info.outer)}, w ekranie).`);
    if (!info.barNextEnabled) fail(`${label}: (g4) „Dalej” w dolnym pasku nieaktywny po sprawdzeniu.`);
  }
  await checkSingleNext(page, label);
  const minFont = Math.min(...info.texts.map((t) => t.font));
  if (Number.isFinite(minFont)) console.log(`     (informacyjnie) najmniejsza czcionka karty: ${minFont.toFixed(1)}px`);
}

// ZAMKNIĘCIE SPRAWY (feat/case-closed, D-089), w trakcie ceremonii (etap podpisu) i w stanie końcowym: (z1) strona i obszar bloku się
// nie przewijają; (z2) raport (16:9) w całości w obszarze bloku, obraz załadowany; (z3) każdy element w slocie (liczby, wnioski, podpis,
// pieczęć, liścik) leży w raporcie; (z4) liczby i każda linijka wniosków bez przepełnienia (tekst w slocie, nowrap - obcięty byłby
// niewidoczny); (z5) cel dotyku podpisu >= 44x44 (niewidoczne rozszerzenie .closing-sign-hit - slot na telefonie jest niższy); (z6)
// "Następna sprawa" w całości w obszarze bloku i w viewporcie, >= 44 px wysokości, "Wróć do biblioteki" - link w dolnym pasku (D-106),
// w viewporcie; (j1, j2) jeden „Dalej”; (z7) błędy strony.
const CLOSING_SLOTS = ['closing-evidence', 'closing-time', 'closing-xp', 'closing-lessons', 'closing-signature', 'closing-stamp', 'closing-note'];
async function checkCaseClosed(page, label, portrait) {
  await checkNoPageScroll(page, label);
  await checkMainSceneFits(page, label);
  const contentAreaBox = await boxOf(page, '[data-testid="player-content-area"]');
  const frameBox = await boxOf(page, '[data-testid="case-closed-frame"]');
  if (!contains(contentAreaBox, frameBox)) fail(`${label}: (z2) ramka raportu wychodzi poza obszar bloku - ramka=${JSON.stringify(frameBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  // Ramka jest kontenerem przewijania tylko w panoramie (telefon w pionie, overflow-x: auto); poza nią nie przycina (D-090: obszar dotyku
  // podpisu może wystawać), więc scrollHeight liczy wystające elementy, ale przewijania nie ma - pilnuje go (e) na obszarze bloku.
  const pan = await page.getByTestId('case-closed-frame').evaluate((el) => {
    const style = getComputedStyle(el);
    const scrolls = (value) => value === 'auto' || value === 'scroll';
    return { x: scrolls(style.overflowX) ? el.scrollWidth - el.clientWidth : 0, y: scrolls(style.overflowY) ? el.scrollHeight - el.clientHeight : 0 };
  });
  if (pan.y > 1) fail(`${label}: (z2) ramka raportu przewija się w pionie o ${pan.y}px.`);
  // Raport pionowy (D-098, D-107, closing.portrait w treści): na telefonie w pionie raport 9:16 w całości (bez panoramy), wypełnia
  // wolną wysokość, dane w slotach grafiki, pod nim tylko „Następna sprawa” na pełną szerokość (z8).
  const orientation = await page.getByTestId('case-closed-frame').getAttribute('data-orientation');
  if (portrait && orientation === 'portrait') {
    if (pan.x > 1) fail(`${label}: (z2) pionowy raport przewija się w poziomie o ${pan.x}px.`);
    const scene = await boxOf(page, '[data-testid="case-closed-scene"]');
    if (!contains(contentAreaBox, scene)) fail(`${label}: (z2) pionowy raport wychodzi poza obszar bloku - ${JSON.stringify(scene)}.`);
    if (Math.abs(scene.width / scene.height - 9 / 16) > 0.02) fail(`${label}: (z2) raport ${scene.width}x${scene.height} - nie 9:16.`);
    const next = await page.getByTestId('case-closed').getByRole('button', { name: /Następna sprawa/ }).boundingBox();
    const actions = await boxOf(page, '[data-testid="case-closed-actions"]');
    if (!next || Math.abs(next.width - actions.width) > 1) fail(`${label}: (z6) „Następna sprawa” nie na pełną szerokość (${next?.width} z ${actions.width}).`);
    // D-107: pod raportem TYLKO „Następna sprawa” (bez liczb, wniosków, wyniku zadań i paska poziomu).
    // Dozwolony też komunikat błędu (pobranie wyniku, restart) - to nie dubel danych z grafiki.
    const under = await page.getByTestId('case-closed-actions').evaluate((el) => ({
      controls: el.querySelectorAll('button, a, [role="progressbar"]').length,
      other: [...el.children].filter((child) => !child.matches('button') && !child.classList.contains('text-danger')).map((child) => child.textContent.trim()),
      text: el.querySelector('button')?.textContent.trim() ?? '',
    }));
    if (under.controls !== 1 || under.other.length > 0 || !/^Następna sprawa/.test(under.text)) fail(`${label}: (z8) pod pionowym raportem coś poza „Następna sprawa” - ${JSON.stringify(under)}.`);
    // D-107: wszystkie dane w slotach grafiki - liczby >= 18 px, wnioski i podpis >= 15 px, w raporcie, bez przepełnienia.
    const data = await page.evaluate(() => {
      const scene = document.querySelector('[data-testid="case-closed-scene"]');
      const info = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? { font: parseFloat(getComputedStyle(el).fontSize), inScene: scene.contains(el), overflowX: el.scrollWidth - el.clientWidth, overflowY: el.scrollHeight - el.clientHeight } : null;
      };
      return { evidence: info('closing-evidence'), time: info('closing-time'), xp: info('closing-xp'), lessons: info('closing-lessons'), signed: info('closing-signed') };
    });
    for (const id of ['evidence', 'time', 'xp']) {
      const d = data[id];
      if (!d || !d.inScene || d.font < 18 - 0.05 || d.overflowX > 1) fail(`${label}: (z4) ${id} w pionie - ${JSON.stringify(d)} (oczekiwane w slocie raportu, >= 18 px, bez przepełnienia).`);
    }
    if (!data.lessons || !data.lessons.inScene || data.lessons.font < 15 - 0.05 || data.lessons.overflowY > 1 || data.lessons.overflowX > 1) fail(`${label}: (z4) wnioski w pionie - ${JSON.stringify(data.lessons)} (oczekiwane w slocie raportu, >= 15 px, bez przepełnienia).`);
    if (data.signed && (!data.signed.inScene || data.signed.font < 16 - 0.05 || data.signed.overflowX > 1)) fail(`${label}: (z4) podpis w pionie - ${JSON.stringify(data.signed)} (oczekiwany w slocie raportu, >= 16 px, bez przepełnienia).`);
    // D-107: grafika wypełnia wolną wysokość ramki (contain - ograniczona wysokością albo szerokością).
    const frame = await boxOf(page, '[data-testid="case-closed-frame"]');
    if (Math.abs(scene.height - frame.height) > 2 && Math.abs(scene.width - frame.width) > 2) fail(`${label}: (z8) raport ${Math.round(scene.width)}x${Math.round(scene.height)} nie wypełnia ramki ${Math.round(frame.width)}x${Math.round(frame.height)}.`);
  } else if (portrait) {
    // Panorama: raport szerszy niż ekran (przewijanie w poziomie), wnioski czytelne (>= 11 px).
    if (pan.x <= 1) fail(`${label}: (z2) telefon w pionie bez panoramy raportu (contain - tekst nieczytelny).`);
    const fontPx = await page.getByTestId('closing-lessons').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (fontPx < 11) fail(`${label}: (z2) wnioski ${fontPx.toFixed(1)} px (< 11 px) w panoramie.`);
  } else {
    if (pan.x > 1) fail(`${label}: (z2) ramka raportu przewija się w poziomie o ${pan.x}px (poza telefonem w pionie raport ma się mieścić).`);
  }
  const sceneBox = await boxOf(page, '[data-testid="case-closed-scene"]');
  if ((!portrait || orientation === 'portrait') && !contains(contentAreaBox, sceneBox)) fail(`${label}: (z2) raport wychodzi poza obszar bloku - raport=${JSON.stringify(sceneBox)} obszar=${JSON.stringify(contentAreaBox)}.`);
  const loaded = await page.locator('[data-testid="case-closed-scene"] img').evaluateAll((els) => els.every((img) => img.naturalWidth > 0));
  if (!loaded) fail(`${label}: (z2) obraz raportu/pieczęci/liściku się nie załadował.`);
  for (const testId of CLOSING_SLOTS) {
    const locator = page.getByTestId(testId);
    if ((await locator.count()) === 0) continue;
    const box = await locator.boundingBox();
    if (!box || !contains(sceneBox, box)) fail(`${label}: (z3) ${testId} poza raportem - ${JSON.stringify(box)} raport=${JSON.stringify(sceneBox)}.`);
  }
  const overflows = await page.evaluate(() => {
    const out = [];
    for (const id of ['closing-evidence', 'closing-time', 'closing-xp']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el && el.scrollWidth > el.clientWidth + 1) out.push(`${id}: ${el.scrollWidth} > ${el.clientWidth}`);
    }
    const list = document.querySelector('[data-testid="closing-lessons"]');
    if (list) {
      if (list.scrollHeight > list.clientHeight + 1) out.push(`wnioski w pionie: ${list.scrollHeight} > ${list.clientHeight}`);
      for (const item of list.querySelectorAll('li')) {
        if (item.scrollWidth > list.clientWidth + 1) out.push(`"${item.textContent}": ${item.scrollWidth} > ${list.clientWidth}`);
      }
    }
    return out;
  });
  if (overflows.length > 0) fail(`${label}: (z4) tekst wychodzi poza slot - ${overflows.join('; ')}.`);
  // (z5) tylko na etapie podpisu (później przycisku już nie ma - sam podpis).
  if ((await page.getByRole('button', { name: 'Podpisz raport' }).count()) > 0) {
    const signBox = await boxOf(page, '[data-testid="closing-signature"]');
    const hits = await page.evaluate(({ x, y }) => [[x, y - 21], [x, y + 21], [x - 21, y], [x + 21, y]].map(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[data-testid="closing-signature"]')), {
      x: signBox.x + signBox.width / 2,
      y: signBox.y + signBox.height / 2,
    });
    if (hits.includes(false)) fail(`${label}: (z5) cel dotyku podpisu < 44x44 (trafienia ±21 px od środka: ${hits.join(', ')}; slot ${JSON.stringify(signBox)}).`);
  }
  const viewport = page.viewportSize();
  const inViewport = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  const nextCase = await page.getByTestId('case-closed').getByRole('button', { name: /Następna sprawa/ }).boundingBox();
  if (!nextCase || !contains(contentAreaBox, nextCase) || !inViewport(nextCase) || nextCase.height < 44) fail(`${label}: (z6) przycisk "Następna sprawa" poza obszarem bloku/viewportem albo < 44 px - ${JSON.stringify(nextCase)}.`);
  // „Wróć do biblioteki” (D-106): link w dolnym pasku, nie pod raportem.
  const library = await page.getByTestId('player-bottombar').getByRole('link', { name: 'Wróć do biblioteki' }).boundingBox();
  if (!library || !inViewport(library) || library.height < 44) fail(`${label}: (z6) „Wróć do biblioteki” w pasku poza viewportem albo < 44 px - ${JSON.stringify(library)}.`);
  if ((await checkSingleNext(page, label)) !== 'Wróć do biblioteki') fail(`${label}: (j2) przycisk dalej w pasku ekranu zamknięcia to nie „Wróć do biblioteki”.`);
}

const children = [];
let webLog = '';
// KOŃCOWE PODSUMOWANIE NA TELEFONIE (D-099) - ogólny audyt jednego stanu bloku w pionie:
//  (s1) strona i obszar bloku bez przewijania w poziomie; żaden element w obszarze bloku nie przewija się w poziomie;
//  (s2) każdy widoczny tekst w obszarze bloku >= 15 px (tekst z DOM - napisy wypalone w grafikach SVG nie są tekstem strony); tekst w
//       slocie grafiki oznaczony [data-graphic-text] jest pominięty TYLKO, gdy ten sam tekst jest też widoczny obok w >= 15 px;
//  (s3) żaden widoczny tekst nie jest ucięty: mieści się w ekranie w poziomie i w każdym przodku, który przycina (overflow inny niż
//       visible); w pionie wolno wyjść poza przodka, który przewija się w pionie (overflow-y auto/scroll) - tekst jest osiągalny - ale
//       każdy taki kontener przewijany musi się mieścić w przycinających przodkach;
//  (s4) każdy widoczny przycisk/link/pole w obszarze bloku i w dolnym pasku >= 44 px wysokości i szerokości;
//  (s5) dolny pasek w całości w ekranie.
// Opcje (D-103, cały moduł): frame - obszar audytu to cała ramka odtwarzacza (paski, notatnik; zamknięty notatnik pomijany);
// scrollX - selektor kontenerów CELOWO przewijanych w poziomie (chipy rozmowy D-097, zakładki teczki, panorama sceny): bez (s1) dla nich
// i bez poziomego (s3) dla ich treści; skipTargets - bez (s4) (cele dotyku poza zakresem B-121, np. fragmenty maila).
async function auditMobileView(page, label, { frame = false, scrollX = null, skipTargets = false } = {}) {
  const all = await page.evaluate(
    ({ minFont, minTarget, frame, scrollX }) => {
      const intentional = (el) => !!scrollX && !!el.closest(scrollX);
      const out = [];
      const doc = document.documentElement;
      const contentArea = document.querySelector('[data-testid="player-content-area"]');
      const bar = document.querySelector('[data-testid="player-bottombar"]');
      if (!contentArea) return ['brak obszaru bloku'];
      const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1;
      const describe = (el, text) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''} „${(text ?? el.textContent ?? '').trim().slice(0, 40)}”`;
      if (doc.scrollWidth > doc.clientWidth + 1) out.push(`(s1) strona przewija się w poziomie o ${doc.scrollWidth - doc.clientWidth}px`);
      // Obszary audytu: treść bloku i - gdy otwarty - notatnik (D-103: tekst min. 15 px w całym module, także w notatniku).
      const drawer = document.querySelector('[data-testid="notes-drawer"]');
      const playerFrame = document.querySelector('.player-frame');
      const roots = frame && playerFrame ? [playerFrame] : [contentArea, ...(drawer && drawer.getAttribute('aria-hidden') !== 'true' && shown(drawer) ? [drawer] : [])];
      for (const area of roots) {
      for (const el of [area, ...area.querySelectorAll('*')]) {
        const s = getComputedStyle(el);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && shown(el) && !intentional(el)) out.push(`(s1) ${describe(el)} przewija się w poziomie (${el.scrollWidth} > ${el.clientWidth})`);
      }
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.trim();
        const el = node.parentElement;
        // [data-graphic-text]: tekst w slocie grafiki z czytelną kopią (>= 15 px) obok - jak napis wypalony w SVG (D-099).
        if (!text || !el || !shown(el) || el.closest('svg, .sr-only, [data-graphic-text], [data-testid="notes-drawer"][aria-hidden="true"]')) continue;
        const scrollsX = intentional(el);
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        if (rects.length === 0) continue;
        const font = parseFloat(getComputedStyle(el).fontSize);
        const key = `${describe(el, text)}`;
        if (font < minFont - 0.05 && !seen.has(`f${key}`)) {
          seen.add(`f${key}`);
          out.push(`(s2) ${key} ma ${font.toFixed(1)}px`);
        }
        for (const r of rects) {
          if (!scrollsX && (r.left < -0.5 || r.right > innerWidth + 0.5)) {
            if (!seen.has(`x${key}`)) out.push(`(s3) ${key} poza ekranem w poziomie (${Math.round(r.left)}..${Math.round(r.right)})`);
            seen.add(`x${key}`);
          }
          let verticalScroller = false;
          for (let anc = el; anc && anc !== doc; anc = anc.parentElement) {
            const s = getComputedStyle(anc);
            const a = anc.getBoundingClientRect();
            if (!scrollsX && s.overflowX !== 'visible' && (r.left < a.left - 1 || r.right > a.right + 1) && !seen.has(`c${key}`)) {
              seen.add(`c${key}`);
              out.push(`(s3) ${key} ucięty w poziomie przez ${describe(anc)}`);
            }
            // Wyjście poza przodka przewijanego w pionie jest dozwolone (tekst osiągalny przewinięciem) - wtedy wyższych przodków w pionie
            // już nie sprawdzamy; sam kontener przewijany musi się mieścić w przodkach, które przycinają (pętla (s3) niżej).
            if (!verticalScroller && s.overflowY !== 'visible' && (r.top < a.top - 1 || r.bottom > a.bottom + 1)) {
              if (s.overflowY === 'auto' || s.overflowY === 'scroll') verticalScroller = true;
              else if (!seen.has(`v${key}`)) {
                seen.add(`v${key}`);
                out.push(`(s3) ${key} ucięty w pionie przez ${describe(anc)}`);
              }
            }
            if (anc === area) break;
          }
        }
      }
      // (s3) kontener przewijany w pionie (w obszarze bloku) w całości w każdym przycinającym przodku - inaczej dół jego treści jest nieosiągalny.
      for (const scroller of [...area.querySelectorAll('*')].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && shown(el))) {
        const r = scroller.getBoundingClientRect();
        for (let anc = scroller.parentElement; anc && anc !== doc; anc = anc.parentElement) {
          const s = getComputedStyle(anc);
          const a = anc.getBoundingClientRect();
          const clipsY = s.overflowY !== 'visible' && !/auto|scroll/.test(s.overflowY);
          if (clipsY && (r.top < a.top - 1 || r.bottom > a.bottom + 1)) {
            out.push(`(s3) kontener przewijany ${describe(scroller)} wystaje poza ${describe(anc)}`);
            break;
          }
          if (/auto|scroll/.test(s.overflowY) || anc === area) break;
        }
      }
      // [data-graphic-text] (pominięty wyżej) wymaga czytelnej kopii: ten sam tekst w widocznym elemencie bez znacznika, >= 15 px.
      // Porównanie po węzłach tekstowych (nie textContent przodków - ten zawierałby sam tekst grafiki).
      const readableTexts = new Set();
      const textWalker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
        const el = node.parentElement;
        if (!el || el.closest('[data-graphic-text], .sr-only, svg') || !shown(el) || parseFloat(getComputedStyle(el).fontSize) < minFont - 0.05) continue;
        readableTexts.add(node.textContent.replace(/\s+/g, ' ').trim());
      }
      for (const graphic of area.querySelectorAll('[data-graphic-text]')) {
        const text = graphic.textContent.replace(/\s+/g, ' ').trim();
        if (!text || !shown(graphic)) continue;
        if (!readableTexts.has(text)) out.push(`(s2) ${describe(graphic)} (tekst grafiki) bez czytelnej kopii >= ${minFont}px`);
      }
      for (const el of area.querySelectorAll('button, a[href], input, textarea, select, [role="button"]')) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < minTarget - 0.5 || r.width < minTarget - 0.5) out.push(`(s4) ${describe(el, el.getAttribute('aria-label') ?? el.textContent)} ${Math.round(r.width)}x${Math.round(r.height)} (< ${minTarget})`);
      }
      }
      for (const el of bar ? bar.querySelectorAll('button, a[href]') : []) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < minTarget - 0.5 || r.width < minTarget - 0.5) out.push(`(s4) ${describe(el, el.getAttribute('aria-label') ?? el.textContent)} ${Math.round(r.width)}x${Math.round(r.height)} (< ${minTarget})`);
      }
      if (bar) {
        const b = bar.getBoundingClientRect();
        if (b.top < -0.5 || b.bottom > innerHeight + 0.5 || b.height < 1) out.push(`(s5) dolny pasek poza ekranem (${Math.round(b.top)}..${Math.round(b.bottom)} z ${innerHeight})`);
      }
      return out;
    },
    { minFont: MOBILE_MIN_FONT_PX, minTarget: MOBILE_MIN_TARGET_PX, frame, scrollX },
  );
  // Bez duplikatów (w trybie frame przyciski paska są i w ramce, i w pętli paska).
  const problems = [...new Set(skipTargets ? all.filter((problem) => !problem.startsWith('(s4)')) : all)];
  if (problems.length > 0) fail(`${label}:\n  ${problems.join('\n  ')}`);
}

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

  for (const viewport of runs('hotspots') ? VIEWPORTS : []) {
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
      if (testCase.block) query.set('block', testCase.block);
      if (testCase.extraQuery) new URLSearchParams(testCase.extraQuery).forEach((v, k) => query.set(k, v));
      await page.goto(`${WEB}/dev/player-harness?${query.toString()}`);
      // Kamera dojeżdża 450 ms (bez reduced-motion) - czekamy na fazę "open" (dla przedmiotu w scenie zagnieżdżonej "inner-open").
      await page.locator(`[data-testid="scene-zoom"][data-phase="${testCase.nested ? 'inner-open' : 'open'}"]`).waitFor();
      if (testCase.postOpen) await testCase.postOpen(page);
      // Crossfade grafiki (200 ms) i ładowanie obrazu zbliżenia.
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="scene-zoom"] img')].every((img) => img.complete));
      await page.waitForTimeout(300);

      await shot(page, `${viewport.name}-${testCase.name}`);
      await checkNoPageScroll(page, label);
      const names = await checkZoomFits(page, testCase, label);
      if (!testCase.nested) await checkCameraCentersItem(page, testCase.hotspotId, label);
      step(`${label}: (a-d${testCase.nested ? '' : ', k'}) OK - przyciski: ${names.join(', ')}`, true);
    }

    await context.close();
  }

  // DIALOGUE (fix/dialogue-sticky-questions) - patrz komentarz na górze pliku.
  for (const viewport of runs('dialogue') ? DIALOGUE_VIEWPORTS : []) {
    console.log(`\n--- viewport (DIALOGUE): ${viewport.name} ---`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
    });
    const page = await context.newPage();

    await page.goto(`${WEB}/dev/player-harness?block=rozmowa-anna`);
    await page.getByTestId('player-content-area').waitFor();
    // Kwestia otwierająca też jest "pisana" (D-087) - stan ze wskaźnikiem, potem start z wiadomością.
    // Wskaźnik otwarcia żyje 0,7-2,2 s - przy wolnym starcie next dev może już zniknąć; wtedy ten stan pomijamy (sprawdza go "w trakcie").
    if (await page.getByTestId('dialogue-typing').waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await shot(page, `${viewport.name}-dialogue-00-pisze-otwarcie`);
      await checkChatColumn(page, `${viewport.name} / rozmowa-anna (pisze - otwarcie)`);
    }
    await waitChatIdle(page);
    await shot(page, `${viewport.name}-dialogue-00-start`);
    await checkQuestionListVisible(page, `${viewport.name} / rozmowa-anna (start)`);
    // (e/k na starcie) sprawdzane też TERAZ, nie tylko po zakończeniu rozmowy (kod review: stopka na starcie ma
    // WSZYSTKIE chipy naraz, czyli NAJWIĘKSZĄ wysokość - "po rozmowie" (poniżej) ma akurat najmniejszą stopkę i sam
    // by nie złapał regresu widocznego tylko przy dużej liczbie chipów).
    await checkMainSceneFits(page, `${viewport.name} / rozmowa-anna (start)`);
    step(`${viewport.name} / rozmowa-anna: (j, e) lista pytań mieści się w ramce/obszarze bloku na starcie`, true);

    // Stan POŚREDNI: jedno pytanie w pełni zadane, drugie w trakcie - rozmówca pisze (wskaźnik), chipy nieaktywne.
    await clickSomeDialogueQuestions(page, 2, { stopWhileTyping: true });
    await shot(page, `${viewport.name}-dialogue-01-pisze`);
    await checkMainSceneFits(page, `${viewport.name} / rozmowa-anna (w trakcie)`);
    await checkChatColumn(page, `${viewport.name} / rozmowa-anna (w trakcie, pisze)`);
    step(`${viewport.name} / rozmowa-anna: (e, g2) w trakcie - obszar bloku bez przewijania, wskaźnik pisania w wątku, chipy nieaktywne`, true);

    await clickAllDialogueQuestions(page);
    await page.waitForTimeout(200);
    await shot(page, `${viewport.name}-dialogue-02-po-rozmowie`);
    const messages = await page.getByTestId('dialogue-thread').getByRole('listitem').count();
    if (messages < DIALOGUE_MIN_MESSAGES) fail(`${viewport.name} / rozmowa-anna: po rozmowie tylko ${messages} wiadomości (< ${DIALOGUE_MIN_MESSAGES}).`);
    await checkNoPageScroll(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    await checkMainSceneFits(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    await checkChatColumn(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    await checkThreadScrolledToBottom(page, `${viewport.name} / rozmowa-anna (po rozmowie)`);
    step(`${viewport.name} / rozmowa-anna: (k, l, g2) ${messages} wiadomości - strona/obszar bloku bez przewijania, kolumna ≤ 760 px wyśrodkowana, wątek na dole`, true);

    await context.close();
  }

  // Dowolny moduł (B-128, LAYOUT_CHECK_MODULE=<slug>, domyślnie moduł 1): KAŻDY blok w harnessie `?module=<slug>&block=<id>` na 4
  // rozdzielczościach + telefonie w pionie: (m1) blok się renderuje (obszar bloku widoczny), obrazy modułu załadowane; (m2) dolny pasek
  // w ekranie; (m3) strona bez poziomego przewijania; (m4) bez błędów strony i konsoli. Minimalna siatka dla nowego modułu - sekcje
  // wyżej sprawdzają szczegóły modułu 1.
  if (runs('module')) {
    const moduleJson = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'content', 'modules', MODULE_SLUG, 'module.json'), 'utf8'));
    const blockIds = moduleJson.blocks.map((block) => block.id);
    for (const viewport of [...BRIEFING_VIEWPORTS, { name: '360x800', width: 360, height: 800, isMobile: true }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: viewport.isMobile ?? false });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text().slice(0, 200));
      });
      for (const blockId of blockIds) {
        const label = `${viewport.name} / moduł ${MODULE_SLUG} / ${blockId}`;
        errors.length = 0;
        await page.goto(`${WEB}/dev/player-harness?module=${MODULE_SLUG}&block=${encodeURIComponent(blockId)}`);
        await page.getByTestId('player-content-area').waitFor({ timeout: 30000 });
        await page.waitForFunction(() => [...document.querySelectorAll('img')].every((img) => img.complete), null, { timeout: 30000 });
        const info = await page.evaluate(() => {
          const broken = [...document.querySelectorAll('img')].filter((img) => /(module-assets|\/assets\/)/.test(img.src) && img.naturalWidth === 0).map((img) => img.src);
          const bar = document.querySelector('[data-testid="player-bottombar"]')?.getBoundingClientRect();
          return {
            broken,
            barInView: !!bar && bar.top >= -1 && bar.bottom <= window.innerHeight + 1,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        if (info.broken.length > 0) fail(`${label}: (m1) obrazy modułu nie załadowane: ${info.broken.join(', ')}`);
        if (!info.barInView) fail(`${label}: (m2) dolny pasek poza ekranem.`);
        if (info.overflowX > 1) fail(`${label}: (m3) strona przewija się w poziomie o ${info.overflowX}px.`);
        if (errors.length > 0) fail(`${label}: (m4) błędy: ${errors.join(' | ')}`);
      }
      step(`${viewport.name} / moduł ${MODULE_SLUG}: ${blockIds.length} bloków (m1-m4) OK`, true);
      await context.close();
    }
  }

  // Miniatury kursów (D-084, /dev/courses-harness): (c1) każda miniatura załadowana, 16:9 (±2%), w całości w swojej karcie;
  // (c2) karta bez miniatury nie ma obrazka (dotychczasowy wygląd); (c3) strona bez poziomego przewijania.
  for (const viewport of runs('catalog') ? BRIEFING_VIEWPORTS : []) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: viewport.isMobile ?? false });
    const page = await context.newPage();
    const label = `${viewport.name} / katalog kursów`;
    await page.goto(`${WEB}/dev/courses-harness?module=${MODULE_SLUG}`);
    const thumbs = page.getByRole('img', { name: MODULE_TITLE, exact: true });
    await thumbs.first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('img')].every((img) => img.complete));
    await shot(page, `${viewport.name}-katalog`);
    const count = await thumbs.count();
    if (count !== 2) fail(`${label}: (c1) oczekiwane 2 miniatury (biblioteka + katalog), jest ${count}.`);
    for (const thumb of await thumbs.all()) {
      const info = await thumb.evaluate((img) => {
        const card = img.closest('.rounded-card:not(img)') ?? img.parentElement;
        const r = img.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return { loaded: img.naturalWidth > 0, ratio: r.width / r.height, inside: r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 };
      });
      if (!info.loaded) fail(`${label}: (c1) miniatura się nie załadowała.`);
      if (Math.abs(info.ratio - 16 / 9) > 0.04) fail(`${label}: (c1) proporcja miniatury ${info.ratio.toFixed(3)} zamiast 16:9.`);
      if (!info.inside) fail(`${label}: (c1) miniatura wychodzi poza kartę.`);
    }
    if ((await page.getByRole('img', { name: 'Kurs bez miniatury' }).count()) !== 0) fail(`${label}: (c2) karta bez miniatury ma obrazek.`);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflowX > 1) fail(`${label}: (c3) strona przewija się w poziomie o ${overflowX}px.`);
    step(`${label}: (c1-c3) OK`, true);
    await context.close();
  }

  // Karty osiągnięć (D-111, /dev/achievements-harness): (a1) trofea załadowane i w kartach, na telefonie w pionie 2 karty w
  // rzędzie; (a2) klik obraca kartę - po obrocie w środku karty widać rewers, rewers w granicach karty, tekst rewersu >= 15 px
  // (dłuższy przewija się w karcie); (a3) klik innej karty odwraca poprzednią z powrotem (jedna naraz); (a4) reduced-motion:
  // bez obrotu (crossfade), rewers widoczny; (a5) strona bez poziomego przewijania.
  for (const viewport of runs('achievements') ? VIEWPORTS.filter((v) => v.name !== '1024x768') : []) {
    for (const reduced of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        isMobile: viewport.isMobile ?? false,
        ...(reduced ? { reducedMotion: 'reduce' } : {}),
      });
      const page = await context.newPage();
      const label = `${viewport.name} / osiągnięcia${reduced ? ' (reduced-motion)' : ''}`;
      await page.goto(`${WEB}/dev/achievements-harness`);
      const cards = page.getByTestId('achievement-card');
      await cards.first().waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('img')].every((img) => img.complete && img.naturalWidth > 0));
      const boxes = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      const imagesInside = await cards.evaluateAll((els) =>
        els.every((el) => {
          const img = el.querySelector('img');
          if (!img) return false;
          const r = img.getBoundingClientRect();
          const c = el.getBoundingClientRect();
          return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
        }),
      );
      if (!imagesInside) fail(`${label}: (a1) trofeum wychodzi poza kartę.`);
      if (PORTRAIT_VIEWPORT_NAMES.has(viewport.name)) {
        if (!(Math.abs(boxes[0].top - boxes[1].top) < 1 && boxes[2].top > boxes[0].bottom - 1)) fail(`${label}: (a1) na telefonie nie 2 karty w rzędzie.`);
      }

      const flip = async (index) => {
        await cards.nth(index).click();
        await page.waitForTimeout(reduced ? 250 : 650);
      };
      const backShown = (index) =>
        cards.nth(index).evaluate((card) => {
          const r = card.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const back = card.querySelector('[data-testid="achievement-back"]');
          const b = back.getBoundingClientRect();
          const texts = [...back.querySelectorAll('span')].filter((s) => s.textContent.trim().length > 0 && !/uppercase/.test(s.className));
          return {
            hitBack: !!hit && back.contains(hit),
            inside: b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1,
            minFont: Math.min(...texts.map((s) => parseFloat(getComputedStyle(s).fontSize))),
            scrollable: back.scrollHeight <= back.clientHeight + 1 || getComputedStyle(back).overflowY === 'auto',
            opacity: parseFloat(getComputedStyle(back).opacity),
            innerTransform: getComputedStyle(back.parentElement).transform,
          };
        });

      await flip(1);
      const back = await backShown(1);
      if ((await cards.nth(1).getAttribute('aria-pressed')) !== 'true') fail(`${label}: (a2) karta po kliknięciu bez aria-pressed=true.`);
      if (!back.hitBack) fail(`${label}: (a2) po obrocie w środku karty nie widać rewersu.`);
      if (!back.inside) fail(`${label}: (a2) rewers wychodzi poza kartę.`);
      if (back.minFont < 15) fail(`${label}: (a2) tekst rewersu ${back.minFont}px (< 15 px).`);
      if (!back.scrollable) fail(`${label}: (a2) dłuższy tekst rewersu nie przewija się w karcie.`);
      if (reduced && (back.innerTransform !== 'none' || back.opacity < 0.99)) fail(`${label}: (a4) reduced-motion: obrót ${back.innerTransform}, krycie rewersu ${back.opacity}.`);
      if (!reduced && back.innerTransform === 'none') fail(`${label}: (a2) karta bez obrotu (transform none).`);
      await shot(page, `${viewport.name}-osiagniecia${reduced ? '-reduced' : ''}`);

      await flip(0);
      if ((await cards.nth(1).getAttribute('aria-pressed')) !== 'false' || (await cards.nth(0).getAttribute('aria-pressed')) !== 'true') {
        fail(`${label}: (a3) odwrócona więcej niż jedna karta.`);
      }
      if ((await backShown(1)).hitBack) fail(`${label}: (a3) poprzednia karta nie wróciła na awers.`);

      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflowX > 1) fail(`${label}: (a5) strona przewija się w poziomie o ${overflowX}px.`);
      step(`${label}: (a1-a5) OK`, true);
      await context.close();
    }
  }

  // Animacje scen (D-084) przy reducedMotion:'reduce': (r1) KAŻDY obraz SVG w obszarze bloku (scena, zagnieżdżona scena
  // pulpitu, zbliżenie maila) ma w adresie #static - zatrzymuje animacje CSS w pliku - i się ładuje; (r2) scena nadal mieści się w
  // obszarze bloku; (r3) zbliżenie bez ruchu kamery (pudełko sceny bez transformu), grafika i przyciski się mieszczą.
  for (const viewport of runs('reduced-motion') ? BRIEFING_VIEWPORTS : []) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    for (const [name, query] of [['scena główna', ''], ['pulpit + mail', '?hotspot=outlook']]) {
      const label = `${viewport.name} / reduced-motion: ${name}`;
      await page.goto(`${WEB}/dev/player-harness${query}`);
      await page.getByTestId('player-content-area').waitFor();
      if (query) {
        await page.locator('[data-testid="scene-zoom"][data-phase="inner-open"]').waitFor();
        const transform = await page.locator('.scene-box').first().evaluate((el) => getComputedStyle(el).transform);
        if (transform !== 'none') fail(`${label}: (r3) reduced-motion, a pudełko sceny ma transform kamery: ${transform}.`);
        await checkZoomFits(page, { nested: true }, label);
      }
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="player-content-area"] img')].every((img) => img.complete));
      const images = await page.locator('[data-testid="player-content-area"] img').evaluateAll((els) =>
        els.map((img) => ({ src: img.getAttribute('src') ?? '', loaded: img.naturalWidth > 0 })),
      );
      // Tylko obrazy scen z modułu (lokalne assets/ przez /dev/module-assets albo magazyn treści) - nie grafiki aplikacji (maskotka).
      const svgs = images.filter((img) => /\.svg(#|$)/i.test(img.src) && /(module-assets|\/assets\/)/.test(img.src));
      if (svgs.length === 0) fail(`${label}: (r1) brak obrazów SVG sceny.`);
      for (const img of svgs) {
        if (!img.src.endsWith('#static')) fail(`${label}: (r1) obraz bez #static: ${img.src}`);
        if (!img.loaded) fail(`${label}: (r1) obraz się nie załadował: ${img.src}`);
      }
      if (!query) await checkMainSceneFits(page, label);
      step(`${label}: (r1-r2) ${svgs.length} obraz(y) z #static OK`, true);
    }
    await context.close();
  }

  // BRIEFING (feat/module-briefing, D-081) - patrz checkBriefingStep.
  for (const viewport of runs('briefing') ? BRIEFING_VIEWPORTS : []) {
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
    await walkBriefing(page, viewport, pageErrors, PORTRAIT_VIEWPORT_NAMES.has(viewport.name));
    await context.close();
  }

  // SCENY PIONOWE (feat/portrait-scenes, D-098): telefon w pionie (390x844, 360x740) - pionowe grafiki odprawy (9:16) i ich hotspoty/sloty,
  // dymek komisarza w dolnej części (y >= 62%), bez nakładania na przedmiot; poziomo (844x390) - stare grafiki 16:9. (r1) Obrót telefonu w
  // trakcie kroku (otwarta teczka): wariant się przełącza (pion <-> poziom), faza kroku zostaje. Zamknięcie sprawy w pionie - raport 9:16,
  // przyciski pod nim jeden pod drugim (checkCaseClosed).
  for (const viewport of runs('portrait') ? PORTRAIT_SCENE_VIEWPORTS : []) {
    console.log(`\n--- viewport (SCENY PIONOWE): ${viewport.name} ---`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    await walkBriefing(page, viewport, pageErrors, viewport.portrait);

    // (r1) Obrót w trakcie kroku: teczka otwarta (faza "open"), obrót do drugiej orientacji i z powrotem - faza bez zmian, wariant zmienia się.
    const label = `${viewport.name} / obrót w trakcie kroku`;
    await page.goto(`${WEB}/dev/player-harness?block=odprawa`);
    await page.getByTestId('briefing-block').waitFor();
    for (const cta of ['Odbierz telefon', 'Rozłącz', 'Otwórz teczkę']) {
      await page.getByRole('button', { name: cta, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Zamknij teczkę', exact: true }).waitFor();
    const scene = page.getByTestId('briefing-scene');
    const rotate = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
    };
    await rotate(viewport.height, viewport.width);
    const rotated = { orientation: await scene.getAttribute('data-orientation'), phase: await scene.getAttribute('data-phase') };
    await rotate(viewport.width, viewport.height);
    const back = { orientation: await scene.getAttribute('data-orientation'), phase: await scene.getAttribute('data-phase') };
    const expected = viewport.portrait ? ['landscape', 'portrait'] : ['portrait', 'landscape'];
    if (rotated.orientation !== expected[0] || back.orientation !== expected[1]) fail(`${label}: (r1) orientacja po obrotach ${rotated.orientation} -> ${back.orientation} zamiast ${expected.join(' -> ')}.`);
    if (rotated.phase !== 'open' || back.phase !== 'open') fail(`${label}: (r1) faza teczki zgubiona przy obrocie (${rotated.phase}, ${back.phase}).`);
    if ((await page.getByTestId('briefing-slot-tasks').count()) !== 1) fail(`${label}: (r1) po obrocie brak zadań w slocie.`);
    step(`${label}: (r1) wariant ${expected.join(' -> ')}, faza teczki "open" zachowana`, true);

    // Zamknięcie sprawy (stan końcowy, `?completed=1`).
    const closingLabel = `${viewport.name} / zamknięcie (pion: raport 9:16)`;
    await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy&completed=1`);
    await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor({ timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="case-closed-scene"] img')].every((img) => img.complete));
    await page.waitForTimeout(300);
    const frameOrientation = await page.getByTestId('case-closed-frame').getAttribute('data-orientation');
    if (frameOrientation !== (viewport.portrait ? 'portrait' : 'landscape')) fail(`${closingLabel}: raport "${frameOrientation}".`);
    await shot(page, `${viewport.name}-pion-zamkniecie`);
    await checkCaseClosed(page, closingLabel, viewport.portrait);
    if (pageErrors.length > 0) fail(`${closingLabel}: błąd strony: ${pageErrors.join(' | ')}`);
    step(`${closingLabel}: (z1-z7) OK - ${frameOrientation}`, true);

    // (f1) Ścieżka zastępcza (moduł bez `portrait`, `?noPortrait=1`) na telefonie w pionie: odprawa 16:9 w pasach, raport jako panorama.
    // Tylko 390x844 - próg czytelności panoramy (11 px) ustalono dla tej wysokości; na niższym ekranie (360x740) panorama daje ~9,7 px
    // (zachowanie sprzed D-098, dla modułów bez `portrait` - B-120).
    if (viewport.portrait && viewport.name === '390x844') {
      const fallback = `${viewport.name} / bez wariantu pionowego`;
      await page.goto(`${WEB}/dev/player-harness?block=odprawa&noPortrait=1`);
      await page.getByRole('button', { name: 'Odbierz telefon', exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="briefing-scene"] img')].every((img) => img.complete));
      await checkBriefingScene(page, BRIEFING_SCENE_VIEWS[0], `${fallback}: odprawa`, false);
      await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy&completed=1&noPortrait=1`);
      await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor({ timeout: 10000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="case-closed-scene"] img')].every((img) => img.complete));
      await page.waitForTimeout(300);
      if ((await page.getByTestId('case-closed-frame').getAttribute('data-orientation')) !== 'landscape') fail(`${fallback}: raport bez portrait nie jest poziomy.`);
      await checkCaseClosed(page, `${fallback}: zamknięcie (panorama)`, true);
      step(`${fallback}: (f1) odprawa 16:9 i panorama raportu OK`, true);
    }
    await context.close();
  }

  // DOSSIER (feat/dossier-folder, D-083) - patrz checkDossierDocument.
  for (const viewport of runs('dossier') ? BRIEFING_VIEWPORTS : []) {
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

  // TABLICA ŚLEDCZA (D-088) - patrz checkEvidenceBoard; telefony w pionie (D-105) - checkEvidenceZigzag.
  for (const viewport of runs('board') ? [...BRIEFING_VIEWPORTS, { name: '360x740', width: 360, height: 740, isMobile: true }] : []) {
    console.log(`\n--- viewport (TABLICA): ${viewport.name} ---`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.isMobile ?? false,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    // Odpowiedź serwera na "Sprawdź trop": 4 z 6 na miejscu (zamienione dwa środkowe), jak z prawdziwego /progress.
    await page.route('**/api/courses/*/progress', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          assignmentId: 'dev-harness',
          status: 'IN_PROGRESS',
          currentBlockIndex: 1,
          score: null,
          completedAt: null,
          lastResult: {
            blockIndex: 0,
            blockId: 'rekonstrukcja',
            type: 'ORDERING',
            points: 4 / 6,
            correct: false,
            detail: { correctOrder: BOARD_CORRECT_ORDER },
            reaction: { pose: 'thinking', text: 'Blisko. Kluczowe: logowanie oszusta było przed telefonem. Dzwonił, bo już był w środku.' },
          },
          gamification: null,
        }),
      }),
    );
    await page.goto(`${WEB}/dev/player-harness?block=rekonstrukcja`);
    const board = page.getByTestId('evidence-board');
    await board.waitFor();
    const expectedOrientation = viewport.height > viewport.width ? 'portrait' : 'landscape';
    await page.waitForFunction((orientation) => document.querySelector('[data-testid="evidence-board"]')?.getAttribute('data-orientation') === orientation, expectedOrientation);
    // Telefon w pionie (D-105): tablica zygzakiem, tacka pod sceną; przypięcie jak na tablicy poziomej - ślad, potem pole.
    const zigzag = expectedOrientation === 'portrait';
    const checkBoard = zigzag ? checkEvidenceZigzag : checkEvidenceBoard;
    const checks = zigzag ? '(a, s1-s5, g1-g3)' : '(a, e, b1-b4)';

    const tray = page.getByRole('group', { name: 'Ślady do przypięcia' });
    const pinFirstTrayCardTo = async (slot) => {
      await tray.getByRole('button', { name: /^Ślad: / }).first().click();
      await page.getByRole('button', { name: new RegExp(`^Pole ${slot}, puste`) }).click();
    };

    await shot(page, `${viewport.name}-tablica-1-pusta`);
    await checkBoard(page, `${viewport.name} / tablica pusta`, { trayCards: 6 });
    step(`${viewport.name} / tablica pusta: ${checks} OK`, true);

    // (b6) Przeciąganie myszą w prawdziwej przeglądarce: klon karty ma tło kartki (tokeny poza drzewem tablicy - portal) i ląduje na polu.
    // Ruch pionowy - na telefonie poziomy ruch na tacce przewija tackę.
    const firstCard = tray.getByRole('button', { name: /^Ślad: / }).first();
    const cardText = ((await firstCard.getAttribute('aria-label')) ?? '').replace(/^Ślad: /, '').replace(/ - przypnij do pola \d+$/, '');
    const from = await firstCard.boundingBox();
    const to = await page.getByRole('button', { name: /^Pole 1, puste/ }).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 40, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    const clone = await page.evaluate(() => {
      const el = document.querySelector('body > .board-card');
      return el ? { background: getComputedStyle(el).backgroundColor, font: parseFloat(getComputedStyle(el.querySelector('span')).fontSize) } : null;
    });
    await shot(page, `${viewport.name}-tablica-1b-przeciaganie`);
    await page.mouse.up();
    if (!clone) fail(`${viewport.name} / tablica: (b6) brak klonu karty w trakcie przeciągania.`);
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(clone.background)) fail(`${viewport.name} / tablica: (b6) klon karty bez tła (${clone.background}).`);
    const pinned = await page.getByRole('button', { name: /^Pole 1: / }).getAttribute('aria-label');
    if (!pinned?.includes(cardText)) fail(`${viewport.name} / tablica: (b6) po upuszczeniu na polu 1 jest „${pinned}”, oczekiwano „${cardText}”.`);
    step(`${viewport.name} / tablica: (b6) przeciąganie myszą - klon z tłem (${clone.background}, ${clone.font.toFixed(1)}px), ślad na polu 1`, true);

    for (const slot of [2, 3]) await pinFirstTrayCardTo(slot);
    await page.waitForTimeout(300);
    await shot(page, `${viewport.name}-tablica-2-w-trakcie`);
    await checkBoard(page, `${viewport.name} / tablica w trakcie`, { trayCards: 3 });
    step(`${viewport.name} / tablica w trakcie (3 z 6): ${checks} OK`, true);

    // Reszta pól po kolei (odpowiedź serwera jest podstawiona - kolejność gracza nie ma tu znaczenia).
    for (const slot of [4, 5, 6]) await pinFirstTrayCardTo(slot);
    await page.getByRole('button', { name: 'Sprawdź trop' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="evidence-board"]')?.getAttribute('data-phase') === 'settled', undefined, { timeout: 10000 });
    await page.waitForTimeout(900); // przelot kart (700 ms)
    await shot(page, `${viewport.name}-tablica-3-po-sprawdzeniu`);
    if (pageErrors.length > 0) fail(`${viewport.name} / tablica: błąd strony: ${pageErrors.join(' | ')}`);
    await checkBoard(page, `${viewport.name} / tablica po sprawdzeniu`, { trayCards: 0, result: true });
    step(`${viewport.name} / tablica po sprawdzeniu: ${zigzag ? '(a, s1-s5, g1, g2, g4)' : '(a, e, b1-b5)'} OK`, true);
    await context.close();
  }

  // ZAMKNIĘCIE SPRAWY (feat/case-closed, D-089) - patrz checkCaseClosed. W trakcie: prawdziwa ceremonia (bez reduced-motion) po
  // "Zakończ sprawę" z odpowiedzią /progress podstawioną przez page.route (harness nie ma backendu) - pomiar na etapie podpisu, potem
  // klik w podpis i stan końcowy po pieczęci i liściku. Końcowe: `?completed=1` (powrót do ukończonego kursu) z reduced-motion.
  for (const viewport of runs('closing') ? BRIEFING_VIEWPORTS : []) {
    console.log(`\n--- viewport (ZAMKNIĘCIE): ${viewport.name} ---`);
    const portrait = PORTRAIT_VIEWPORT_NAMES.has(viewport.name);
    for (const mode of ['ceremonia', 'końcowe']) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        isMobile: viewport.isMobile ?? false,
        reducedMotion: mode === 'końcowe' ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
      await page.route('**/api/courses/*/progress', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            assignmentId: 'dev-harness',
            status: 'COMPLETED',
            currentBlockIndex: 1,
            score: 83,
            completedAt: new Date().toISOString(),
            lastResult: { blockIndex: 0, blockId: 'rozwiazanie-sprawy', type: 'SUMMARY' },
            evidence: { collected: 20, total: 22, perBlock: [] },
            gamification: {
              xpGained: 350,
              newLevel: 2,
              previousLevel: 1,
              leveledUp: true,
              // Najgorszy przypadek dolnego rzędu (D-090, B-116): pasek poziomu + 3 odznaki z długimi nazwami.
              unlockedBadges: [
                { code: 'pierwsza-sprawa', title: 'Pierwsza zamknięta sprawa', icon: 'badge', xpReward: 50 },
                { code: 'tropiciel', title: 'Tropiciel wszystkich dowodów', icon: 'badge', xpReward: 50 },
                { code: 'bez-bledu', title: 'Rekonstrukcja bez jednego błędu', icon: 'badge', xpReward: 50 },
              ],
              levelProgressBeforePercent: 40,
              levelProgressAfterPercent: 100,
            },
          }),
        }),
      );
      const label = `${viewport.name} / zamknięcie: ${mode}`;
      if (mode === 'ceremonia') {
        await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy`);
        // Harness ma jeden blok (bez dowodów w notatniku) - SummaryBlock pokazuje wtedy "Zakończ szkolenie" zamiast "Zakończ sprawę".
        await page.getByRole('button', { name: /^Zakończ (sprawę|szkolenie)$/ }).click();
        await page.locator('[data-testid="case-closed"][data-stage="sign"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(700); // wejście teczki (600 ms) - pomiar bez transformu animacji
        await shot(page, `${viewport.name}-zamkniecie-1-podpis`);
        if (pageErrors.length > 0) fail(`${label}: (z7) błąd strony: ${pageErrors.join(' | ')}`);
        await checkCaseClosed(page, `${label} (podpis)`, portrait);
        step(`${label} (etap podpisu): (z1-z7) OK`, true);
        await page.getByRole('button', { name: 'Podpisz raport' }).click();
        // (z9, D-090) konfetti przy pieczęci: pojawia się, max 30 cząstek, strona i obszar bloku się nie przewijają (konfetti w warstwie przycinanej do raportu).
        const confetti = page.getByTestId('closing-confetti');
        // "attached", nie "visible": warstwa jest aria-hidden i przezroczysta (widoczne są tylko cząstki).
        await confetti.waitFor({ state: 'attached', timeout: 3000 });
        const pieces = await confetti.locator('span').count();
        if (pieces === 0 || pieces > 30) fail(`${label}: (z9) konfetti ma ${pieces} cząstek (oczekiwane 1-30).`);
        await page.waitForTimeout(400);
        await checkNoPageScroll(page, `${label} (konfetti)`);
        await checkMainSceneFits(page, `${label} (konfetti)`);
        step(`${label}: (z9) konfetti (${pieces} cząstek) bez przewijania`, true);
      } else {
        await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy&completed=1`);
      }
      await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(700); // animacje pieczęci/liściku/drgnięcia dobiegają końca
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="case-closed-scene"] img')].every((img) => img.complete));
      await shot(page, `${viewport.name}-zamkniecie-2-${mode === 'ceremonia' ? 'po-ceremonii' : 'koncowe'}`);
      if (pageErrors.length > 0) fail(`${label}: (z7) błąd strony: ${pageErrors.join(' | ')}`);
      if ((await page.getByTestId('closing-stamp').count()) !== 1 || (await page.getByTestId('closing-note').count()) !== 1) fail(`${label}: brak pieczęci albo liściku w stanie końcowym.`);
      if (portrait && mode === 'ceremonia') {
        // (z8) ceremonia w panoramie sama przesunęła widok (a w pionowym raporcie, D-098, wszystko i tak jest widoczne): pieczęć i liścik w
        // całości w widocznej części ramki.
        const frameBox = await boxOf(page, '[data-testid="case-closed-frame"]');
        for (const testId of ['closing-stamp', 'closing-note']) {
          const box = await page.getByTestId(testId).boundingBox();
          if (!box || !contains(frameBox, box)) fail(`${label}: (z8) ${testId} poza widokiem panoramy po ceremonii - ${JSON.stringify(box)} ramka=${JSON.stringify(frameBox)}.`);
        }
        const orientation = await page.getByTestId('case-closed-frame').getAttribute('data-orientation');
        step(`${label}: (z8) ${orientation === 'portrait' ? 'pionowy raport - pieczęć i liścik widoczne' : 'panorama przesunięta na pieczęć i liścik'}`, true);
      }
      await checkCaseClosed(page, label, portrait);
      step(`${label} (stan końcowy): (z1-z7) OK`, true);
      await context.close();
    }
  }

  // RUCH (feat/player-motion, D-090): "Zabierz" przy dowodzie (karteczka) w prawdziwej przeglądarce. Bez reduced-motion: (m1) etykieta
  // lotu pojawia się, leży w viewporcie, a strona się nie przewija w trakcie lotu; (m2) po locie etykieta znika z DOM; (m3) przycisk
  // Notatnika po podskoku wraca do skali 1. Z reduced-motion: (m4) bez etykiety lotu. Zawsze: (m5) liczba wpisów notatnika rośnie; (m6) pasek
  // postępu przesuwa się transformem na pełnej szerokości toru (translateX, nie width); (m7) błędy strony.
  for (const viewport of runs('motion') ? BRIEFING_VIEWPORTS : []) {
    console.log(`\n--- viewport (RUCH): ${viewport.name} ---`);
    for (const reduce of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        isMobile: viewport.isMobile ?? false,
        reducedMotion: reduce ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
      const label = `${viewport.name} / ruch${reduce ? ' (reduced-motion)' : ''}: Zabierz karteczkę`;
      await page.goto(`${WEB}/dev/player-harness?hotspot=karteczka`);
      await page.locator('[data-testid="scene-zoom"][data-phase="open"]').waitFor();
      // Harness nie ma progress.evidence (licznik "Dowody x/N" się nie pokazuje) - wzrost liczy się po etykiecie przycisku Notatnika.
      const notesCount = async () => Number(((await page.locator('[data-evidence-target]').getAttribute('aria-label')) ?? '').match(/\((\d+)\)/)?.[1] ?? NaN);
      const before = await notesCount();
      await page.getByRole('dialog').getByRole('button', { name: 'Zabierz' }).click();
      const chip = page.getByTestId('evidence-flight');
      if (!reduce) {
        // Pomiar w JEDNEJ klatce przeglądarki (polling raf), póki etykieta leci - osobne wywołania mogłyby trafić już po jej zniknięciu (400 ms).
        const flight = await (
          await page.waitForFunction(
            () => {
              const el = document.querySelector('[data-testid="evidence-flight"]');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const doc = document.documentElement;
              return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight, scrollX: doc.scrollWidth - doc.clientWidth, scrollY: doc.scrollHeight - doc.clientHeight };
            },
            null,
            { timeout: 2000, polling: 'raf' },
          )
        ).jsonValue();
        if (flight.scrollX > 1 || flight.scrollY > 1) fail(`${label}: (m1) strona przewija się w trakcie lotu - ${JSON.stringify(flight)}.`);
        if (flight.x < -1 || flight.y < -1 || flight.right > flight.vw + 1 || flight.bottom > flight.vh + 1) fail(`${label}: (m1) etykieta lotu poza viewportem - ${JSON.stringify(flight)}.`);
        await shot(page, `${viewport.name}-ruch-lot`);
        await chip.waitFor({ state: 'detached', timeout: 2000 });
        await page.waitForTimeout(350);
        const transform = await page.locator('[data-evidence-target]').evaluate((el) => getComputedStyle(el).transform);
        if (transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)') fail(`${label}: (m3) przycisk Notatnika po podskoku ma transform ${transform}.`);
      } else {
        await page.waitForTimeout(500);
        if ((await chip.count()) !== 0) fail(`${label}: (m4) reduced-motion, a etykieta lotu jest w DOM.`);
      }
      const after = await notesCount();
      if (after !== before + 1) fail(`${label}: (m5) notatnik ${before} -> ${after} (oczekiwane +1).`);
      const bar = await page.getByTestId('progress-fill').evaluate((el) => ({ width: el.getBoundingClientRect().width, track: el.parentElement.clientWidth, transform: getComputedStyle(el).transform }));
      if (Math.abs(bar.width - 0) > 1 && !bar.transform.startsWith('matrix')) fail(`${label}: (m6) pasek postępu bez transformu: ${JSON.stringify(bar)}.`);
      const layoutWidth = await page.getByTestId('progress-fill').evaluate((el) => el.offsetWidth);
      if (Math.abs(layoutWidth - bar.track) > 1) fail(`${label}: (m6) pasek postępu zmienia szerokość układu (${layoutWidth} px zamiast toru ${bar.track} px).`);
      if (pageErrors.length > 0) fail(`${label}: (m7) błąd strony: ${pageErrors.join(' | ')}`);
      step(`${label}: (m1-m7) OK`, true);
      await context.close();
    }
  }

  // STRONA GŁÓWNA - film (feat/marketing-film, D-091): (f1) strona bez poziomego przewijania; (f2) film w całości w szerokości viewportu,
  // proporcja 16:9 (±2%), plakat i plik filmu serwowane z własnego originu (200); (f3) bez reduced-motion film sam gra (wyciszony), z
  // reduced-motion stoi, a „Odtwórz film” uruchamia go z kontrolkami; (f4) CTA do rejestracji widoczne; (f5) CSP ma media-src 'self';
  // (f6) błędy strony.
  for (const viewport of runs('home') ? BRIEFING_VIEWPORTS : []) {
    console.log(`\n--- viewport (STRONA GŁÓWNA): ${viewport.name} ---`);
    for (const reduce of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        isMobile: viewport.isMobile ?? false,
        reducedMotion: reduce ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
      const label = `${viewport.name} / strona główna, film${reduce ? ' (reduced-motion)' : ''}`;
      const response = await page.goto(`${WEB}/`);
      const csp = response?.headers()['content-security-policy'] ?? '';
      if (!/media-src 'self'/.test(csp)) fail(`${label}: (f5) CSP bez media-src 'self': ${csp.slice(0, 200)}`);
      const video = page.getByTestId('landing-film');
      await video.scrollIntoViewIfNeeded();
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflowX > 1) fail(`${label}: (f1) strona przewija się w poziomie o ${overflowX}px.`);
      const box = await video.boundingBox();
      if (!box || box.x < -1 || box.x + box.width > viewport.width + 1) fail(`${label}: (f2) film poza szerokością viewportu - ${JSON.stringify(box)}.`);
      if (box && Math.abs(box.width / box.height - 16 / 9) > 0.04) fail(`${label}: (f2) proporcja filmu ${(box.width / box.height).toFixed(3)} zamiast 16:9.`);
      for (const attr of ['src', 'poster']) {
        const url = await video.getAttribute(attr);
        const res = await page.request.get(new URL(url, WEB).toString());
        if (!url?.startsWith('/') || res.status() !== 200) fail(`${label}: (f2) ${attr} ${url} -> ${res.status()} (oczekiwany własny origin, 200).`);
      }
      if (!reduce) {
        await page.waitForFunction(() => { const v = document.querySelector('[data-testid="landing-film"]'); return v && !v.paused && v.currentTime > 0.3; }, null, { timeout: 8000 }).catch(() => null);
        const state = await video.evaluate((v) => ({ paused: v.paused, t: v.currentTime, muted: v.muted }));
        if (state.paused || state.t <= 0.3 || !state.muted) fail(`${label}: (f3) film nie gra sam (wyciszony) - ${JSON.stringify(state)}.`);
        // WCAG 2.2.2: autostartujący film da się zatrzymać przyciskiem (cel dotyku >= 44 px, w obrębie filmu).
        const toggle = page.getByRole('button', { name: 'Wstrzymaj film' });
        const toggleBox = await toggle.boundingBox();
        if (!toggleBox || toggleBox.height < 44 || !contains(box, toggleBox)) fail(`${label}: (f3) przycisk pauzy poza filmem albo < 44 px - ${JSON.stringify(toggleBox)}.`);
        await toggle.click();
        await page.waitForFunction(() => document.querySelector('[data-testid="landing-film"]')?.paused === true, null, { timeout: 3000 });
      } else {
        await page.waitForTimeout(1200);
        const state = await video.evaluate((v) => ({ paused: v.paused, t: v.currentTime }));
        if (!state.paused || state.t > 0) fail(`${label}: (f3) reduced-motion, a film gra sam - ${JSON.stringify(state)}.`);
        await page.getByRole('button', { name: 'Odtwórz film' }).click();
        await page.waitForFunction(() => { const v = document.querySelector('[data-testid="landing-film"]'); return v && !v.paused; }, null, { timeout: 5000 });
        if (!(await video.evaluate((v) => v.controls))) fail(`${label}: (f3) po „Odtwórz film” brak kontrolek.`);
      }
      await shot(page, `${viewport.name}-strona-glowna-film${reduce ? '-rm' : ''}`);
      const cta = page.getByRole('link', { name: /Załóż konto firmy/ });
      if (!(await cta.isVisible()) || (await cta.getAttribute('href')) !== '/register') fail(`${label}: (f4) brak CTA do rejestracji.`);
      if (pageErrors.length > 0) fail(`${label}: (f6) błąd strony: ${pageErrors.join(' | ')}`);
      step(`${label}: (f1-f6) OK`, true);
      await context.close();
    }
  }

  // KOŃCOWE PODSUMOWANIE NA TELEFONIE (D-099) - wszystkie bloki od rekonstrukcji do końca modułu, w kolejnych stanach, audyt
  // auditMobileView (s1-s5) + strona bez przewijania i błędy strony. Odpowiedzi API podstawione przez page.route (harness bez backendu).
  // Zbiera wszystkie stany i kończy się błędem dopiero po ostatnim (pełna lista problemów w jednym przebiegu).
  const mobileFailures = [];
  for (const viewport of runs('mobile-summary') ? MOBILE_SUMMARY_VIEWPORTS : []) {
    console.log(`\n--- viewport (PODSUMOWANIE NA TELEFONIE): ${viewport.name} ---`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    let progressBody = null;
    await page.route('**/api/courses/*/progress', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(progressBody) }));
    let attemptBody = null;
    await page.route('**/api/courses/*/blocks/*/attempt', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(attemptBody) }));
    const audit = async (name) => {
      const label = `${viewport.name} / ${name}`;
      await page.waitForTimeout(400);
      await shot(page, `${viewport.name}-podsumowanie-${name.replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-').toLowerCase()}`);
      try {
        if (pageErrors.length > 0) fail(`${label}: błąd strony: ${pageErrors.join(' | ')}`);
        await checkNoPageScroll(page, label);
        // Pasek tacki tablicy (D-105) przewija się w poziomie celowo.
        await auditMobileView(page, label, { scrollX: '[data-board-tray] ul' });
        await checkSingleNext(page, label);
        step(`${label}: (s1-s5, j1, j2) OK`, true);
      } catch (error) {
        if (!error.isLayoutCheckFailure) throw error;
        step(`${label}: ${error.message.replace(`${label}: `, '')}`, false);
        mobileFailures.push(label);
      }
    };

    // Tablica śledcza: pusta, w trakcie, pełna (przed sprawdzeniem), po sprawdzeniu (4 z 6, reakcja).
    progressBody = {
      assignmentId: 'dev-harness',
      status: 'IN_PROGRESS',
      currentBlockIndex: 1,
      score: null,
      completedAt: null,
      lastResult: {
        blockIndex: 0,
        blockId: 'rekonstrukcja',
        type: 'ORDERING',
        points: 4 / 6,
        correct: false,
        detail: { correctOrder: BOARD_CORRECT_ORDER },
        reaction: { text: 'Blisko. Kluczowe: logowanie oszusta było przed telefonem. Dzwonił, bo już był w środku.' },
      },
      gamification: null,
    };
    await page.goto(`${WEB}/dev/player-harness?block=rekonstrukcja`);
    await page.locator('[data-testid="evidence-board"][data-layout="zigzag"]').waitFor();
    await audit('tablica pusta');
    // Tablica zygzakiem (D-105): stuknięcie śladu z tacki, potem pierwszego pustego pola.
    const pin = async () => {
      await page.getByRole('group', { name: 'Ślady do przypięcia' }).getByRole('button', { name: /^Ślad: / }).first().click();
      await page.getByRole('button', { name: /^Pole \d+, puste/ }).first().click();
    };
    for (let i = 0; i < 3; i += 1) await pin();
    // Wybrany przypięty ślad: w pasku tacki pojawia się „Odłóż na tackę”, puste pola podświetlone.
    await page.getByRole('button', { name: /^Pole 1: / }).click();
    await audit('tablica w trakcie (wybrany ślad)');
    await page.getByRole('button', { name: /^Pole 1: / }).click();
    for (let i = 0; i < 3; i += 1) await pin();
    await audit('tablica pełna');
    await page.getByRole('button', { name: 'Sprawdź trop' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="evidence-board"]')?.getAttribute('data-phase') === 'settled', undefined, { timeout: 10000 });
    await audit('tablica po sprawdzeniu');

    // Ostatnie pytanie (okno przeglądarki): start, zła próba z podpowiedzią, poprawna odpowiedź (ostrzeżenie).
    await page.goto(`${WEB}/dev/player-harness?block=ostatnie-pytanie`);
    const win = page.getByTestId('browser-window');
    await win.waitFor();
    await audit('ostatnie pytanie start');
    attemptBody = { correct: false, attempt: 1, attemptsLeft: 2, done: false, hint: { text: 'Spójrz na to, co jest po @ w adresie nadawcy.' } };
    await win.getByRole('textbox').fill('bank.pl');
    await win.getByRole('button', { name: 'Sprawdź' }).click();
    await page.getByTestId('browser-error').waitFor();
    await audit('ostatnie pytanie zła próba');
    attemptBody = { correct: true, attempt: 2, attemptsLeft: 1, done: true, points: 0.75 };
    await win.getByRole('textbox').fill('bankwektor-weryfikacja.pl');
    await win.getByRole('button', { name: 'Sprawdź' }).click();
    await page.getByTestId('browser-deceptive-warning').waitFor();
    await audit('ostatnie pytanie ostrzeżenie');

    // Rozwiązanie sprawy (SUMMARY) i zamknięcie: świeże ukończenie (reduced-motion - od razu stan końcowy, z nagrodą) i powrót do
    // ukończonego kursu. Etap podpisu w pionie sprawdza sekcja portrait/closing.
    progressBody = {
      assignmentId: 'dev-harness',
      status: 'COMPLETED',
      currentBlockIndex: 1,
      score: 83,
      completedAt: new Date().toISOString(),
      lastResult: { blockIndex: 0, blockId: 'rozwiazanie-sprawy', type: 'SUMMARY' },
      evidence: { collected: 20, total: 22, perBlock: [] },
      gamification: {
        xpGained: 350,
        newLevel: 2,
        previousLevel: 1,
        leveledUp: true,
        unlockedBadges: [{ code: 'pierwsza-sprawa', title: 'Pierwsza zamknięta sprawa', icon: 'badge', xpReward: 50 }],
        levelProgressBeforePercent: 40,
        levelProgressAfterPercent: 100,
      },
    };
    await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy`);
    await page.getByRole('button', { name: /^Zakończ (sprawę|szkolenie)$/ }).waitFor();
    await audit('rozwiązanie sprawy');
    await page.getByRole('button', { name: /^Zakończ (sprawę|szkolenie)$/ }).click();
    await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="case-closed-scene"] img')].every((img) => img.complete));
    await audit('zamknięcie sprawy');
    await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy&completed=1`);
    await page.locator('[data-testid="case-closed"][data-stage="done"]').waitFor({ timeout: 10000 });
    await audit('zamknięcie po powrocie');
    await context.close();
  }
  if (mobileFailures.length > 0) fail(`mobile-summary: ${mobileFailures.length} stanów z problemami - ${mobileFailures.join('; ')}`);

  // CAŁY MODUŁ NA TELEFONIE (B-121, D-103): bloki od odprawy do teczki w kolejnych stanach (końcówkę modułu - pełny audyt s1-s5 - sprawdza
  // mobile-summary) w CAŁEJ ramce odtwarzacza (treść, notatnik, górny i dolny pasek): (s2) tekst >= 15 px, (s3) nic nieucięte, (s1) bez
  // poziomego przewijania poza celowo przewijanymi (MODULE_SCROLL_X), (s5) pasek w ekranie; bez (s4). Zbiera wszystkie stany.
  // Celowo przewijane w poziomie (chipy rozmowy, panorama, zakładki teczki) i celowo skracany wielokropkiem tytuł kursu w górnym pasku
  // (pełny tytuł jest w bibliotece kursów; pasek ma jedną linijkę).
  const MODULE_SCROLL_X = '.dialogue-chips, .scene-pan-container, [role="tablist"], .player-topbar h1, [data-board-tray] ul';
  const moduleFailures = [];
  for (const viewport of runs('mobile-module') ? MOBILE_SUMMARY_VIEWPORTS : []) {
    console.log(`\n--- viewport (CAŁY MODUŁ NA TELEFONIE): ${viewport.name} ---`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    // Rozmowy i mail wysyłają odpowiedź dopiero przy „Dalej” - tu jej nie potrzeba; harness bez backendu.
    const audit = async (name) => {
      const label = `${viewport.name} / ${name}`;
      await page.waitForTimeout(400);
      await shot(page, `${viewport.name}-modul-${name.replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-').toLowerCase()}`);
      try {
        if (pageErrors.length > 0) fail(`${label}: błąd strony: ${pageErrors.join(' | ')}`);
        await checkNoPageScroll(page, label);
        await auditMobileView(page, label, { frame: true, scrollX: MODULE_SCROLL_X, skipTargets: true });
        step(`${label}: (s1-s3, s5) OK - cały tekst ramki >= 15 px, nic nieucięte`, true);
      } catch (error) {
        if (!error.isLayoutCheckFailure) throw error;
        step(`${label}: ${error.message.replace(`${label}: `, '')}`, false);
        moduleFailures.push(label);
      }
    };

    // Odprawa: każdy widok (klik w przedmiot kroku prowadzi dalej).
    await page.goto(`${WEB}/dev/player-harness?block=odprawa`);
    await page.getByTestId('briefing-block').waitFor();
    for (const [index, view] of BRIEFING_SCENE_VIEWS.entries()) {
      await page.getByRole('button', { name: view.item, exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="briefing-scene"] img')].every((img) => img.complete));
      await audit(`odprawa ${index + 1} (${view.item})`);
      if (view.last) break;
      await page.getByTestId('briefing-hotspot').click();
    }

    // Sceny: sama scena i każde zbliżenie (?hotspot= - harness sam klika, także w głąb pulpitu).
    for (const [block, hotspots] of [
      ['korytarz', ['', 'tablica']],
      ['biuro-anny', ['', 'karteczka', 'kalendarz', 'drukarka', 'kubek', 'telefon', 'monitor', 'outlook', 'przegladarka', 'gra']],
    ]) {
      for (const hotspot of hotspots) {
        await page.goto(`${WEB}/dev/player-harness?block=${block}${hotspot ? `&hotspot=${hotspot}` : ''}`);
        await page.getByTestId('player-content-area').waitFor();
        if (hotspot) await page.getByTestId('scene-zoom').waitFor();
        if (hotspot === 'gra') await page.getByTestId('easter-popup').first().waitFor();
        await audit(`${block}${hotspot ? ` - ${hotspot}` : ''}`);
        // Okna na ekranie w pionie (D-104): mail i historia przeglądarki w wariancie -pion (duży, zawijany tekst).
        if (hotspot === 'outlook' || hotspot === 'przegladarka') {
          const src = await page.getByTestId('scene-zoom-graphic').locator('img').getAttribute('src');
          if (!src?.includes('-pion')) {
            step(`${viewport.name} / ${block} - ${hotspot}: okno nie w wariancie pionowym (${src})`, false);
            moduleFailures.push(`${viewport.name} / ${hotspot} bez -pion`);
          }
        }
        if (hotspot === 'telefon') {
          await page.getByTestId('scene-zoom').getByRole('button', { name: 'Transkrypcja' }).click();
          await audit(`${block} - telefon + transkrypcja`);
        }
      }
    }
    // Notatnik otwarty (panel nad sceną).
    await page.goto(`${WEB}/dev/player-harness?block=biuro-anny`);
    await page.getByRole('button', { name: /^Notatnik/ }).click();
    await page.waitForTimeout(300);
    await audit('notatnik');

    // Rozmowy: start i po wszystkich pytaniach.
    for (const block of ['rozmowa-anna', 'rozmowa-marek']) {
      await page.goto(`${WEB}/dev/player-harness?block=${block}`);
      await page.getByRole('list', { name: 'Pytania do zadania' }).waitFor();
      await audit(`${block} start`);
      await clickAllDialogueQuestions(page);
      await audit(`${block} koniec`);
    }

    // Mail: start i po zaznaczeniu fragmentu.
    await page.goto(`${WEB}/dev/player-harness?block=ten-mail`);
    await page.getByTestId('player-content-area').waitFor();
    await audit('ten-mail start');
    const fragment = page.getByTestId('player-content-area').locator('[aria-pressed]').first();
    if ((await fragment.count()) > 0) {
      await fragment.click();
      await audit('ten-mail zaznaczony fragment');
    }

    // Teczka: każdy dokument.
    await page.goto(`${WEB}/dev/player-harness?block=akta-sprawy`);
    await page.getByTestId('player-content-area').waitFor();
    for (const tab of DOSSIER_TABS) {
      await page.getByRole('tab', { name: tab }).click();
      await audit(`teczka - ${tab}`);
    }
    await context.close();
  }
  if (moduleFailures.length > 0) fail(`mobile-module: ${moduleFailures.length} stanów z problemami - ${moduleFailures.join('; ')}`);

  // JEDEN „DALEJ” (D-106) - każdy typ bloku modułu 1 na desktopie i telefonie (j1, j2 - checkSingleNext): w obszarze bloku (scena,
  // zbliżenia, pulpit, rozmowa, mail, teczka, tablica, okno przeglądarki, rozwiązanie sprawy, zamknięcie) nie ma przycisku nawigacji
  // dalej, w pasku jest dokładnie jeden. Dodatkowo: (j3) rozstrzygnięte zadanie w oknie przeglądarki - „Dalej” w pasku aktywny;
  // (j4) rozwiązanie sprawy - przycisk w pasku to „Zakończ szkolenie/sprawę”, aktywny; (j5) zamknięcie - „Wróć do biblioteki” w pasku.
  // Stany wyniku tablicy i raportu zamknięcia sprawdzają też sekcje board/closing/mobile-summary (checkSingleNext w ich kontrolach).
  for (const viewport of runs('single-next') ? [{ name: '1366x768', width: 1366, height: 768 }, { name: '390x844', width: 390, height: 844, isMobile: true }] : []) {
    console.log(`\n--- viewport (JEDEN „DALEJ”): ${viewport.name} ---`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: !!viewport.isMobile, isMobile: !!viewport.isMobile, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    await page.route('**/api/courses/*/blocks/*/attempt', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ correct: true, attempt: 1, attemptsLeft: 2, done: true, points: 1 }) }),
    );
    const barNext = () => page.getByTestId('player-bottombar').locator('.pbar-next');
    const states = [
      ['odprawa', null],
      ['korytarz', null],
      ['korytarz', 'tablica'],
      ['biuro-anny', null],
      ['biuro-anny', 'karteczka'],
      ['biuro-anny', 'monitor'],
      ['biuro-anny', 'outlook'],
      ['biuro-anny', 'gra'],
      ['rozmowa-anna', null],
      ['ten-mail', null],
      ['akta-sprawy', null],
      ['rozmowa-marek', null],
      ['rekonstrukcja', null],
      ['ostatnie-pytanie', null],
    ];
    for (const [block, hotspot] of states) {
      const label = `${viewport.name} / ${block}${hotspot ? ` - ${hotspot}` : ''}`;
      await page.goto(`${WEB}/dev/player-harness?block=${block}${hotspot ? `&hotspot=${hotspot}` : ''}`);
      await page.getByTestId('player-content-area').waitFor();
      if (hotspot) await page.getByTestId('scene-zoom').waitFor();
      if (hotspot === 'gra') await page.getByTestId('easter-popup').first().waitFor();
      await page.waitForTimeout(300);
      await checkSingleNext(page, label);
      step(`${label}: (j1, j2) OK - jeden „Dalej”, w pasku`, true);
    }
    // Rozmowa po wszystkich pytaniach: blok gotowy - „Dalej” w pasku aktywny, w wątku brak przycisku dalej.
    await page.goto(`${WEB}/dev/player-harness?block=rozmowa-anna`);
    await page.getByRole('list', { name: 'Pytania do zadania' }).waitFor();
    await clickAllDialogueQuestions(page);
    await checkSingleNext(page, `${viewport.name} / rozmowa-anna koniec`);
    if (await barNext().isDisabled()) fail(`${viewport.name} / rozmowa-anna koniec: (j3) „Dalej” w pasku nieaktywny po wszystkich pytaniach.`);
    step(`${viewport.name} / rozmowa-anna koniec: (j1-j3) OK - „Dalej” w pasku aktywny`, true);
    // Zadanie w oknie przeglądarki rozstrzygnięte (odpowiedź /attempt podstawiona): wynik w oknie, „Dalej” tylko w pasku, aktywny.
    await page.goto(`${WEB}/dev/player-harness?block=ostatnie-pytanie`);
    const win = page.getByTestId('browser-window');
    await win.waitFor();
    await win.getByRole('textbox').fill('bankwektor-weryfikacja.pl');
    await win.getByRole('button', { name: 'Sprawdź' }).click();
    await page.getByTestId('text-input-result').waitFor();
    await checkSingleNext(page, `${viewport.name} / ostatnie-pytanie rozstrzygnięte`);
    if (await barNext().isDisabled()) fail(`${viewport.name} / ostatnie-pytanie rozstrzygnięte: (j3) „Dalej” w pasku nieaktywny.`);
    step(`${viewport.name} / ostatnie-pytanie rozstrzygnięte: (j1-j3) OK`, true);
    // Rozwiązanie sprawy: „Zakończ …” to etykieta przycisku w pasku.
    await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy`);
    await page.getByTestId('player-content-area').waitFor();
    // SUMMARY zgłasza gotowość w efekcie po zamontowaniu - chwila na aktywację przycisku w pasku.
    await barNext().and(page.locator(':enabled')).waitFor({ timeout: 5000 }).catch(() => {});
    const summaryNext = await checkSingleNext(page, `${viewport.name} / rozwiazanie-sprawy`);
    if (!/^Zakończ (sprawę|szkolenie)$/.test(summaryNext ?? '') || (await barNext().isDisabled())) fail(`${viewport.name} / rozwiazanie-sprawy: (j4) przycisk w pasku „${summaryNext}” (oczekiwany aktywny „Zakończ sprawę/szkolenie”).`);
    step(`${viewport.name} / rozwiazanie-sprawy: (j1, j2, j4) OK - „${summaryNext}” w pasku`, true);
    // Zamknięcie sprawy (stan końcowy): „Wróć do biblioteki” wyłącznie w pasku.
    await page.goto(`${WEB}/dev/player-harness?block=rozwiazanie-sprawy&completed=1`);
    await page.getByTestId('case-closed').waitFor();
    const closedNext = await checkSingleNext(page, `${viewport.name} / zamknięcie sprawy`);
    if (closedNext !== 'Wróć do biblioteki') fail(`${viewport.name} / zamknięcie sprawy: (j5) przycisk w pasku „${closedNext}”.`);
    step(`${viewport.name} / zamknięcie sprawy: (j1, j2, j5) OK - „Wróć do biblioteki” w pasku`, true);
    if (pageErrors.length > 0) fail(`${viewport.name} / jeden „Dalej”: błąd strony: ${pageErrors.join(' | ')}`);
    await context.close();
  }

  // EASTER EGG (D-100): (e1) wszystkie okienka w całości w ekranie i w nakładce zbliżenia; (e2) krzyżyk górnego okienka >= 44x44, w ekranie,
  // nieprzykryty (elementFromPoint), z fokusem; (e3) tekst okienek >= 15 px; (e4) Esc zamyka górne okienko, klik w tło niczego nie
  // zamyka; (e5, mysz) przycisk „dodge” ucieka dokładnie 2 razy, klik w przycisk - okienko drga i zostaje; (e6) po ostatnim krzyżyku:
  // outro z wyróżnieniem, „Wróć do pulpitu” >= 44 px, w ekranie; ikona gry na pulpicie obejrzana, wyróżnienie w notatniku; (e7) strona
  // się nie przewija, błędy strony; (e8) reduced-motion (390x844): wszystkie okienka od razu, bez animacji wejścia i mrugnięcia.
  for (const viewport of runs('easter') ? EASTER_VIEWPORTS : []) {
    console.log(`\n--- viewport (EASTER EGG): ${viewport.name} ---`);
    for (const reduced of viewport.name === '390x844' ? [false, true] : [false]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: !viewport.mouse,
        isMobile: viewport.isMobile ?? false,
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
      const label = `${viewport.name} / easter egg${reduced ? ' (reduced-motion)' : ''}`;
      await page.goto(`${WEB}/dev/player-harness?block=biuro-anny&hotspot=gra`);
      const popups = page.getByTestId('easter-popup');
      if (reduced) {
        await popups.first().waitFor({ timeout: 15000 });
        const count = await popups.count();
        const animated = await page.evaluate(() => document.querySelectorAll('.popup-in, .popup-blink').length);
        if (count !== 3 || animated > 0) fail(`${label}: (e8) reduced-motion - okienek ${count} (oczekiwane 3 od razu), animacji ${animated}.`);
      } else {
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="easter-popup"]').length === 3, undefined, { timeout: 15000 });
        await page.waitForTimeout(500); // wejście ostatniego okienka (260 ms)
      }
      await shot(page, `${viewport.name}-easter-1-okienka${reduced ? '-rm' : ''}`);
      const check = async (step) => {
        const info = await page.evaluate(() => {
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          };
          const cards = [...document.querySelectorAll('[data-testid="easter-popup-card"]')].map(rect);
          const closes = [...document.querySelectorAll('[data-popup-close]')];
          const top = closes[closes.length - 1];
          const topRect = top ? top.getBoundingClientRect() : null;
          const hit = topRect ? document.elementFromPoint(topRect.left + topRect.width / 2, topRect.top + topRect.height / 2) : null;
          const fonts = [...document.querySelectorAll('[data-testid="easter-popup"] :is(h2, p, button)')]
            .filter((el) => el.textContent.trim() && !el.closest('.sr-only'))
            .map((el) => parseFloat(getComputedStyle(el).fontSize));
          return {
            cards,
            zoom: rect(document.querySelector('[data-testid="scene-zoom"]')),
            top: topRect ? rect(top) : null,
            topHit: !!hit && top.contains(hit),
            topFocused: !!top && document.activeElement === top,
            minFont: fonts.length ? Math.min(...fonts) : null,
          };
        });
        const screen = { x: 0, y: 0, width: viewport.width, height: viewport.height };
        info.cards.forEach((card, i) => {
          if (!contains(screen, card) || !contains(info.zoom, card)) fail(`${label}: (e1) ${step}: okienko ${i + 1} poza ekranem/nakładką - ${JSON.stringify({ card, zoom: info.zoom })}.`);
        });
        if (info.top) {
          if (info.top.width < 44 || info.top.height < 44 || !contains(screen, info.top)) fail(`${label}: (e2) ${step}: krzyżyk ${JSON.stringify(info.top)}.`);
          if (!info.topHit) fail(`${label}: (e2) ${step}: krzyżyk górnego okienka przykryty.`);
          if (!info.topFocused) fail(`${label}: (e2) ${step}: fokus nie na krzyżyku górnego okienka.`);
        }
        if (info.minFont !== null && info.minFont < 15) fail(`${label}: (e3) ${step}: tekst okienek ${info.minFont}px (< 15).`);
      };
      await check('3 okienka');
      // (e4) Tło nie zamyka; Esc zamyka górne okienko.
      const zoomBox = await boxOf(page, '[data-testid="scene-zoom"]');
      await page.mouse.click(zoomBox.x + zoomBox.width - 6, zoomBox.y + zoomBox.height - 6);
      if ((await popups.count()) !== 3) fail(`${label}: (e4) klik w tło zamknął okienko.`);
      await page.keyboard.press('Escape');
      if ((await popups.count()) !== 2) fail(`${label}: (e4) Esc nie zamknął górnego okienka (${await popups.count()}).`);
      await check('2 okienka');
      await page.locator('[data-popup-index="1"] [data-popup-close]').click();
      await check('1 okienko');
      const action = page.locator('[data-popup-index="0"] [data-testid="easter-popup-action"]');
      if (viewport.mouse && !reduced) {
        // (e5) Uciekanie: dwa najechania przesuwają przycisk, trzecie już nie.
        const positions = [];
        for (let i = 0; i < 3; i += 1) {
          const before = await action.boundingBox();
          await page.mouse.move(5, 5);
          await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2, { steps: 3 });
          await page.waitForTimeout(250);
          const after = await action.boundingBox();
          positions.push(Math.hypot(after.x - before.x, after.y - before.y) > 5);
        }
        if (positions.join() !== 'true,true,false') fail(`${label}: (e5) uciekanie ${positions.join()} (oczekiwane: ucieka 2 razy).`);
        step(`${label}: (e5) przycisk ucieka 2 razy, potem zostaje`, true);
      }
      await action.click();
      if ((await popups.count()) !== 1) fail(`${label}: (e5) klik w przycisk okienka je zamknął.`);
      await shot(page, `${viewport.name}-easter-2-ostatnie${reduced ? '-rm' : ''}`);
      await page.locator('[data-popup-index="0"] [data-popup-close]').click();
      const outro = page.getByTestId('easter-outro');
      await outro.waitFor();
      await shot(page, `${viewport.name}-easter-3-outro${reduced ? '-rm' : ''}`);
      const back = outro.getByRole('button', { name: 'Wróć do pulpitu' });
      const outroBox = await outro.boundingBox();
      const backBox = await back.boundingBox();
      if (!contains({ x: 0, y: 0, width: viewport.width, height: viewport.height }, outroBox) || backBox.height < 44) fail(`${label}: (e6) outro ${JSON.stringify({ outroBox, backBox })}.`);
      if (!(await page.getByTestId('easter-badge').textContent())?.includes('Curious Detective')) fail(`${label}: (e6) brak wyróżnienia w outro.`);
      await back.click();
      await page.getByTestId('easter-outro').waitFor({ state: 'detached' });
      const icon = await page.getByRole('button', { name: /^GTA6_PL\.exe/ }).getAttribute('aria-label');
      if (!icon?.includes('(obejrzane)')) fail(`${label}: (e6) ikona gry nie jest obejrzana („${icon}”).`);
      await page.keyboard.press('Escape'); // pulpit -> scena
      await page.getByRole('button', { name: /^Notatnik/ }).click();
      const distinctions = page.getByTestId('notebook-distinctions');
      await distinctions.waitFor();
      if (!(await distinctions.textContent())?.includes('Curious Detective')) fail(`${label}: (e6) brak wyróżnienia w notatniku.`);
      await shot(page, `${viewport.name}-easter-4-notatnik${reduced ? '-rm' : ''}`);
      await checkNoPageScroll(page, label);
      if (pageErrors.length > 0) fail(`${label}: (e7) błąd strony: ${pageErrors.join(' | ')}`);
      step(`${label}: (e1-e4, e6-e8) OK`, true);
      await context.close();
    }
  }

  // POWRÓT FOKUSU PO ZBLIŻENIU (D-101, code review): punkty pod zbliżeniem są schowane przez CSS (data-zoom-open) - w prawdziwej
  // przeglądarce (jsdom nie ładuje globals.css) fokus po „Odłóż” ma wrócić na przedmiot, na obu poziomach: (o1) scena główna - kalendarz,
  // (o2) pulpit - Poczta; z animacją i przy reduced-motion (zamknięcie synchroniczne).
  for (const viewport of runs('zoom-focus') ? [EASTER_VIEWPORTS[1], EASTER_VIEWPORTS[3]] : []) {
    console.log(`\n--- viewport (FOKUS PO ZBLIŻENIU): ${viewport.name} ---`);
    for (const reduced of [false, true]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: !viewport.mouse, isMobile: viewport.isMobile ?? false, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      const label = `${viewport.name} / fokus po zbliżeniu${reduced ? ' (reduced-motion)' : ''}`;
      const zoom = page.getByTestId('scene-zoom');
      const phase = (value) => page.waitForFunction((v) => document.querySelector('[data-testid="scene-zoom"]')?.getAttribute('data-phase') === v, value, { timeout: 10000 });
      const focused = () => page.evaluate(() => ({ testid: document.activeElement?.getAttribute('data-testid'), label: document.activeElement?.getAttribute('aria-label') }));
      await page.goto(`${WEB}/dev/player-harness?block=biuro-anny`);
      await page.getByTestId('hotspot-overlay-kalendarz').click();
      await phase('open');
      await zoom.getByRole('button', { name: 'Odłóż' }).click();
      await zoom.waitFor({ state: 'detached' });
      const outer = await focused();
      if (outer.testid !== 'hotspot-overlay-kalendarz') fail(`${label}: (o1) po Odłóż fokus na ${JSON.stringify(outer)}, oczekiwany przedmiot „kalendarz”.`);
      await page.getByTestId('hotspot-overlay-monitor').click();
      await phase('open');
      await zoom.getByRole('button', { name: /^Poczta/ }).click();
      await phase('inner-open');
      await zoom.getByRole('button', { name: 'Odłóż' }).click();
      await phase('open');
      await page.waitForTimeout(100);
      const inner = await focused();
      if (!inner.label?.startsWith('Poczta')) fail(`${label}: (o2) po Odłóż w pulpicie fokus na ${JSON.stringify(inner)}, oczekiwana ikona „Poczta”.`);
      step(`${label}: (o1-o2) fokus wraca na przedmiot na obu poziomach`, true);
      await context.close();
    }
  }

  // OKNO PRZEGLĄDARKI (feat/browser-evidence) - `?block=ostatnie-pytanie` (TEXT_INPUT_GUIDED, frame: browser), odpowiedzi /attempt
  // podstawione przez page.route (harness nie ma backendu): (p1) strona i obszar bloku bez poziomego przewijania, okno w szerokości
  // obszaru; (p2) pole adresu i „Sprawdź” w pasku adresu okna, cel dotyku >= 40 px; (p3) zła próba - komunikat w obrębie okna;
  // (p4) poprawna - ostrzeżenie „Ta strona podszywa się pod bank” w obrębie okna, żadnych pól (input/textarea/select) na stronie bloku;
  // (p5) błędy strony.
  for (const viewport of runs('browser') ? BRIEFING_VIEWPORTS : []) {
    console.log(`\n--- viewport (OKNO PRZEGLĄDARKI): ${viewport.name} ---`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: viewport.isMobile ?? false });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    let nextCorrect = false;
    await page.route('**/api/courses/*/blocks/*/attempt', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          nextCorrect
            ? { correct: true, attempt: 2, attemptsLeft: 1, done: true, points: 0.75 }
            : { correct: false, attempt: 1, attemptsLeft: 2, done: false, hint: { text: 'Spójrz na to, co jest po @ w adresie nadawcy.' } },
        ),
      }),
    );
    const label = `${viewport.name} / okno przeglądarki`;
    await page.goto(`${WEB}/dev/player-harness?block=ostatnie-pytanie`);
    const win = page.getByTestId('browser-window');
    await win.waitFor();
    const noOverflow = async (step) => {
      const over = await page.evaluate(() => {
        const area = document.querySelector('[data-testid="player-content-area"]');
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, area: area ? area.scrollWidth - area.clientWidth : 0 };
      });
      if (over.page > 1 || over.area > 1) fail(`${label}: (p1) poziome przewijanie ${step} - ${JSON.stringify(over)}.`);
    };
    await noOverflow('na starcie');
    const areaBox = await boxOf(page, '[data-testid="player-content-area"]');
    const winBox = await win.boundingBox();
    if (!winBox || winBox.x < areaBox.x - 1 || winBox.x + winBox.width > areaBox.x + areaBox.width + 1) fail(`${label}: (p1) okno poza obszarem bloku - ${JSON.stringify({ winBox, areaBox })}.`);
    const input = win.getByRole('textbox');
    const go = win.getByRole('button', { name: 'Sprawdź' });
    for (const [name, loc] of [['pole adresu', input], ['Sprawdź', go]]) {
      const box = await loc.boundingBox();
      if (!box || box.height < 40 || !contains(winBox, box)) fail(`${label}: (p2) ${name} poza oknem albo < 40 px - ${JSON.stringify(box)}.`);
    }
    await shot(page, `${viewport.name}-przegladarka-1-start`);
    await input.fill('bank.pl');
    await go.click();
    const error = page.getByTestId('browser-error');
    await error.waitFor();
    if (!contains(await win.boundingBox(), await error.boundingBox())) fail(`${label}: (p3) komunikat złej próby poza oknem.`);
    await noOverflow('po złej próbie');
    await shot(page, `${viewport.name}-przegladarka-2-zla-proba`);
    nextCorrect = true;
    await input.fill('bankwektor-weryfikacja.pl');
    await go.click();
    const warning = page.getByTestId('browser-deceptive-warning');
    await warning.waitFor();
    const warnBox = await warning.boundingBox();
    if (!contains(await win.boundingBox(), warnBox)) fail(`${label}: (p4) ostrzeżenie poza oknem - ${JSON.stringify(warnBox)}.`);
    if (!(await warning.textContent())?.includes('Ta strona podszywa się pod bank')) fail(`${label}: (p4) brak nagłówka ostrzeżenia.`);
    const fields = await page.getByTestId('player-content-area').locator('input, textarea, select').count();
    if (fields > 0) fail(`${label}: (p4) po odpowiedzi w bloku są pola formularza (${fields}) - nie może być żadnych.`);
    await noOverflow('po poprawnej odpowiedzi');
    await shot(page, `${viewport.name}-przegladarka-3-ostrzezenie`);
    if (pageErrors.length > 0) fail(`${label}: (p5) błąd strony: ${pageErrors.join(' | ')}`);
    step(`${label}: (p1-p5) OK`, true);
    await context.close();
  }

  // DOLNY PASEK (fix/mobile-player-bar): (n1) strona bez poziomego przewijania; (n2) elementy paska (przyciski, linki, linijka napisów)
  // widoczne, w granicach paska i ekranu, BEZ nakładania się parami; (n3) scena < 640 px: Odtwórz/Transkrypcja/Lektor/Wstecz = 44x44,
  // „Dalej” 44 px wysokości i >= 120 px szerokości, jedyny widoczny tekst w rzędzie przycisków, bez ucięcia; rząd przycisków 60 px;
  // napisy (jeśli są) jedną linijką NAD przyciskami; scena >= 640 px: etykieta „Lektor” widoczna (układ bez zmian); (n4) rozmowa na
  // scenie < 640 px: chipy w jednym rzędzie (wspólna górna krawędź, poziome przewijanie), „Zadano x z y pytań” jedną linijką nad nimi;
  // (n5) błędy strony.
  for (const viewport of runs('bar') ? BAR_VIEWPORTS : []) {
    console.log(`\n--- viewport (DOLNY PASEK): ${viewport.name} ---`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: viewport.isMobile ?? false, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0]));
    // Nagranie narracji w harnessie (?narration=1) nie istnieje lokalnie - podstawiamy krótki dźwięk z apps/web/public/sfx, żeby
    // pojawiły się przycisk odtwarzania i linijka napisów. Działa, gdy harness bierze zasoby z /dev/module-assets (bez
    // CONTENT_BASE_URL - tak uruchamia go ten skrypt), a skrypt startuje z katalogu repo (jak next dev wyżej).
    // Zasoby harnessu pod `/dev/module-assets/<slug>/…` (B-128).
    await page.route('**/dev/module-assets/*/audio/**', (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', path: join(process.cwd(), 'apps', 'web', 'public', 'sfx', 'msg-receive.mp3') }));
    const variants = [...BAR_BLOCKS.map((blockId) => ({ blockId, narration: false })), { blockId: 'ostatnie-pytanie', narration: true }, { blockId: 'rozmowa-anna', narration: true }];
    for (const { blockId, narration } of variants) {
      const label = `${viewport.name} / dolny pasek: ${blockId}${narration ? ' (lektor, napisy)' : ''}`;
      await page.goto(`${WEB}/dev/player-harness?block=${blockId}${narration ? '&narration=1' : ''}`);
      const bar = page.getByTestId('player-bottombar');
      await bar.waitFor();
      await page.waitForTimeout(300);
      if (narration) {
        // Odtwórz, poczekaj na linijkę napisów i zatrzymaj - napisy zostają (aktywna linijka z bieżącego czasu nagrania).
        await page.getByRole('button', { name: 'Odtwórz nagranie' }).click();
        await page.waitForFunction(() => (document.querySelector('[data-testid="narration-caption"]')?.textContent ?? '').trim().length > 0, null, { timeout: 5000 });
        const pause = page.getByRole('button', { name: 'Wstrzymaj nagranie' });
        if (await pause.count()) await pause.click();
        await page.waitForTimeout(200);
      }
      const m = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const barEl = document.querySelector('[data-testid="player-bottombar"]');
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const controls = [...barEl.querySelectorAll('button, a')].filter((el) => visible(el) && !el.closest('[data-testid="transcript-panel"], [role="region"]'));
        const caption = barEl.querySelector('[data-testid="narration-caption"]');
        const next = [...barEl.querySelectorAll('.pbar-next')].find(visible);
        const labels = [...barEl.querySelectorAll('.pbar-label')].filter((el) => el.getBoundingClientRect().width > 1).map((el) => el.textContent);
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bar: box(barEl),
          controls: controls.map((el) => ({ name: el.getAttribute('aria-label') || el.textContent.trim(), cls: el.className, ...box(el) })),
          caption: caption && visible(caption) ? box(caption) : null,
          next: next ? { ...box(next), clipped: next.scrollWidth > next.clientWidth + 1, text: next.textContent.trim() } : null,
          labels,
          compact: barEl.closest('.player-bottombar-host').getBoundingClientRect().width < 640,
        };
      });
      if (m.overflowX > 1) fail(`${label}: (n1) strona przewija się w poziomie o ${m.overflowX}px.`);
      const items = [...m.controls, ...(m.caption ? [{ name: 'napisy', ...m.caption }] : [])];
      for (const item of items) {
        if (item.x < -0.5 || item.x + item.w > viewport.width + 0.5) fail(`${label}: (n2) „${item.name}” poza ekranem - ${JSON.stringify(item)}.`);
        if (!contains({ x: m.bar.x, y: m.bar.y, width: m.bar.w, height: m.bar.h }, { x: item.x, y: item.y, width: item.w, height: item.h })) fail(`${label}: (n2) „${item.name}” wystaje poza pasek - ${JSON.stringify({ item, bar: m.bar })}.`);
      }
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
          if (overlap) fail(`${label}: (n2) nakładają się „${a.name}” i „${b.name}” - ${JSON.stringify({ a, b })}.`);
        }
      }
      // Każdy blok ma „Dalej” w pasku (D-106 - także scena z „drzwiami”); `m.next` może brakować tylko przy błędzie układu (n2).
      if (m.next?.clipped) fail(`${label}: (n3) tekst „${m.next.text}” ucięty.`);
      if (m.compact) {
        for (const c of m.controls.filter((c) => !/pbar-next|pbar-text/.test(c.cls))) {
          if (Math.abs(c.w - 44) > 1 || Math.abs(c.h - 44) > 1) fail(`${label}: (n3) przycisk-ikona „${c.name}” nie 44x44 - ${JSON.stringify(c)}.`);
        }
        if (m.next && (Math.abs(m.next.h - 44) > 1 || m.next.w < 119.5)) fail(`${label}: (n3) „Dalej” ${m.next.w}x${m.next.h} (min. 120x44).`);
        if (m.labels.length > 0) fail(`${label}: (n3) widoczne etykiety tekstowe w wąskim pasku: ${m.labels.join(', ')}.`);
        const rowTop = Math.min(...m.controls.map((c) => c.y));
        // Bez napisów pasek to sam rząd przycisków: 60 px razem z górną krawędzią (margines bezpieczeństwa w emulatorze = 0).
        if (!m.caption && Math.abs(m.bar.h - 60) > 0.5) fail(`${label}: (n3) pasek ${m.bar.h.toFixed(1)} px zamiast 60.`);
        if (Math.abs(m.bar.y + m.bar.h - rowTop - 52) > 0.5) fail(`${label}: (n3) rząd przycisków nie 44 + 8 px od dołu paska.`);
        // Jedna linijka napisów 15 px (D-103: line-height 20 + odstępy 6) - dwie linijki miałyby >= 46 px.
        if (m.caption && (m.caption.y + m.caption.h > rowTop + 0.5 || m.caption.h > 28)) fail(`${label}: (n3) napisy nie jedną linijką nad przyciskami - ${JSON.stringify(m.caption)}.`);
      } else if (m.controls.some((c) => c.name === 'Lektor') && !m.labels.includes('Lektor')) {
        fail(`${label}: (n3) scena >= 640 px - etykieta „Lektor” powinna być widoczna (układ bez zmian).`);
      }
      if (narration && (!m.caption || !m.controls.some((c) => /nagranie/.test(c.name)))) fail(`${label}: (n3) brak przycisku odtwarzania albo linijki napisów.`);
      if (blockId === 'rozmowa-anna' && m.compact) {
        const chips = await page.evaluate(() => {
          const ul = document.querySelector('.dialogue-chips');
          const progress = document.querySelector('.dialogue-progress');
          if (!ul || !progress) return null;
          const tops = [...ul.children].map((li) => Math.round(li.getBoundingClientRect().top));
          const u = ul.getBoundingClientRect();
          const p = progress.getBoundingClientRect();
          return { tops, ulTop: u.top, ulH: u.height, pBottom: p.bottom, pH: p.height, scrolls: ul.scrollWidth > ul.clientWidth };
        });
        if (!chips) fail(`${label}: (n4) brak chipów albo licznika pytań.`);
        if (new Set(chips.tops).size !== 1) fail(`${label}: (n4) chipy nie w jednym rzędzie - górne krawędzie ${chips.tops.join(', ')}.`);
        if (chips.ulH > 60) fail(`${label}: (n4) rząd chipów ${chips.ulH}px wysokości.`);
        if (chips.pBottom > chips.ulTop + 0.5 || chips.pH > 20) fail(`${label}: (n4) licznik pytań nie jedną linijką nad chipami - ${JSON.stringify(chips)}.`);
        step(`${label}: (n4) chipy w jednym rzędzie${chips.scrolls ? ' (przewijane w poziomie)' : ''}, licznik nad nimi`, true);
      }
      await shot(page, `${viewport.name}-pasek-${blockId}${narration ? '-lektor' : ''}`);
      if (blockId === 'ostatnie-pytanie' && !narration) {
        // (n6) Otwarty notatnik: tło notatnika przykrywa też dolny pasek (klik w pasek trafia w tło, nie w przycisk).
        await page.getByRole('button', { name: /^Notatnik/ }).click();
        await page.waitForTimeout(400);
        const hit = await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="player-bottombar"]').getBoundingClientRect();
          const el = document.elementFromPoint(bar.x + 30, bar.y + bar.height / 2);
          return el ? { inBar: !!el.closest('[data-testid="player-bottombar"]'), tag: el.tagName } : null;
        });
        if (!hit || hit.inBar) fail(`${label}: (n6) przy otwartym notatniku pasek nie jest przykryty tłem - ${JSON.stringify(hit)}.`);
        await page.keyboard.press('Escape');
        step(`${label}: (n6) otwarty notatnik przykrywa dolny pasek`, true);
      }
      if (pageErrors.length > 0) fail(`${label}: (n5) błąd strony: ${pageErrors.join(' | ')}`);
      step(`${label}: (n1-n3, n5) OK - ${m.compact ? 'wąski' : 'szeroki'}, elementy: ${m.controls.map((c) => c.name).join(', ')}${m.caption ? ' + napisy' : ''}`, true);
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
