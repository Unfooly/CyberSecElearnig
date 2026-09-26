// Prawdziwy test UKŁADU karty hotspotu (i sceny) W PRZEGLĄDARCE, BEZ backendu (bez Postgresa/Redisa/apps/api) -
// druga runda code review fix/hotspot-card-fit/B-101 znalazła bugi, których żaden test jsdom (Investigation.test.tsx)
// nie mógł wykryć, bo jsdom nie liczy layoutu CSS (container query, grid, cqw/cqh) - tylko prawdziwy Chromium to
// widzi. Użycie: `node scripts/layout-check.mjs` (spawnuje `next dev` z NEXT_PUBLIC_DEV_HARNESS=1, strona
// apps/web/src/app/dev/player-harness/page.tsx renderuje PlayerStage z prawdziwą treścią modułu 1 - wyłącznie
// packages/content, bez importu do bazy). NIE jest częścią CI (B-101 w backlogu: "layout-check w CI") - uruchamiany
// RĘCZNIE, lokalnie, przed pushem każdego PR-a zmieniającego układ odtwarzacza (CLAUDE.md, reguła 12).
//
// Sprawdza dla każdej kombinacji (viewport x hotspot) pięć rzeczy (a-e w opisie zadania/PR):
//  a) <html> się nie przewija (scrollHeight/Width <= innerHeight/Width) - cała strona, nie tylko ramka.
//  b) karta hotspotu (.hotspot-card) się nie przewija (scrollHeight <= clientHeight) - poza kartą BEZ mediów, gdzie
//     "karta się nie przewija" nie ma sensu sprawdzać tak samo (auto-size do treści, patrz .hotspot-card--no-media).
//  c) obszar mediów karty (.hotspot-card-media) ma wysokość >0 i >=35% wysokości karty (łapie regresję z drugiej
//     rundy review: scena zagnieżdżona/media wychodziły zerowej albo miniaturowej wysokości).
//  d) przyciski karty (.hotspot-card-buttons button) są W CAŁOŚCI wewnątrz karty i wewnątrz ramki odtwarzacza
//     (.player-frame) - nie wychodzą poza żadną z tych dwóch granic.
//  e) (raz na viewport, przed otwarciem jakiejkolwiek karty) obraz GŁÓWNEJ sceny mieści się w obszarze bloku - bez
//     paska przewijania w tym obszarze (hotfix fix/player-scene-fit/B-100, ta sama rodzina bugów).
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
];

// hotspotId: parametr ?hotspot= strony harnessu (HarnessAutoOpen.tsx klika przez niego, drilling w głąb dla
// zagnieżdżonych - "outlook" samo dociera do karty maila przez monitor). postOpen: dodatkowa interakcja PO otwarciu
// karty (transkrypcja audio nie ma własnego ?parametru - to zwykła interakcja w karcie, jak zrobiłby to gracz).
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
  const sceneArea = page.locator('[class*="overflow-clip"]').first();
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

const children = [];
let webLog = '';
function start(name, command, args, env, cwd) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, shell: false });
  children.push(child);
  child.stdout.on('data', (chunk) => (webLog += chunk.toString()));
  child.stderr.on('data', (chunk) => (webLog += chunk.toString()));
  return child;
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
    'web',
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
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true });
    const page = await context.newPage();

    await page.goto(`${WEB}/dev/player-harness`);
    await page.locator('[class*="overflow-clip"]').first().waitFor();
    await shot(page, `${viewport.name}-00-scena-glowna`);
    await checkMainSceneFits(page, `${viewport.name} / scena główna`);
    step(`${viewport.name} / scena główna: (e) mieści się bez przewijania`, true);

    for (const testCase of HOTSPOT_CASES) {
      const label = `${viewport.name} / ${testCase.name}`;
      await page.goto(`${WEB}/dev/player-harness?hotspot=${encodeURIComponent(testCase.hotspotId)}`);
      await page.locator('.hotspot-card').first().waitFor();
      if (testCase.postOpen) await testCase.postOpen(page);
      // Jedna klatka na ustabilizowanie layoutu (przejście paska poziomu/animacje nie dotyczą tej karty, ale kolejne
      // klatki po kliknięciu z HarnessAutoOpen.tsx czasem jeszcze się układają).
      await page.waitForTimeout(200);

      await shot(page, `${viewport.name}-${testCase.name}`);
      await checkNoPageScroll(page, label);
      await checkCardDoesNotScroll(page, label);
      await checkMediaHeight(page, label);
      await checkButtonsInsideCardAndFrame(page, label);
      step(`${label}: (a-d) OK`, true);
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
  for (const child of children) child.kill();
}
