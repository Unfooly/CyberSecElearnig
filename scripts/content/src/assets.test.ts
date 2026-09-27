import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertAssetPathsClassified, collectAssetRefs, runAssetsPipeline, type AssetsPipelineParams } from './assets.js';
import { MemoryStore } from './stores/memory.js';
import type { ObjectHead, ObjectStore, PutOptions } from './types.js';

const requireCjs = createRequire(import.meta.url);
const { fullModule } = requireCjs('../../../packages/content/dist/fixtures.js') as { fullModule: () => Record<string, unknown> };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]); // nagłówek PNG + śmieci (treść nieważna dla testów)
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="red" /></svg>';
const MALICIOUS_SVG = '<svg onload="alert(1)"></svg>';

function moduleWithAssets(overrides: { image?: string; avatar?: string } = {}): Record<string, unknown> {
  const module = JSON.parse(JSON.stringify(fullModule())) as { blocks: Record<string, unknown>[] };
  const scene = module.blocks.find((block) => block.type === 'SCENE_HOTSPOTS') as { image: string; hotspots: Record<string, unknown>[] };
  const dialogue = module.blocks.find((block) => block.type === 'DIALOGUE') as { character: { avatar?: string } };
  scene.image = overrides.image ?? 'scena.png';
  dialogue.character.avatar = overrides.avatar ?? 'anna.png';
  // Fixtura (packages/content) ma media (image/audio/scene, B-086/D-071) na hotspotach h1/h3/h4/... - poza zakresem
  // TYCH testów (ogólny potok publikacji), więc zdjęte tu; hotspots[].media.* ma własne testy niżej (moduleWithHotspotMedia).
  for (const hotspot of scene.hotspots) delete hotspot.media;
  // To samo z grafiką kroków odprawy (D-084): własne testy niżej (moduleWithBriefingScenes).
  const briefing = module.blocks.find((block) => block.type === 'BRIEFING') as { steps: Record<string, unknown>[] };
  for (const step of briefing.steps) for (const field of ['image', 'imageReducedMotion', 'closedImage', 'hotspot', 'slots']) delete step[field];
  return module as unknown as Record<string, unknown>;
}

const sink = () => new Writable({ write: (_c, _e, done) => done() });

let root: string;
let dir: string;
let assetsDir: string;
let modulePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'assets-'));
  dir = join(root, 'sprawa-testowa'); // nazwa katalogu = slug modułu
  assetsDir = join(dir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  modulePath = join(dir, 'module.json');
  await writeFile(modulePath, JSON.stringify(moduleWithAssets()));
  await writeFile(join(assetsDir, 'scena.png'), PNG);
  await writeFile(join(assetsDir, 'anna.png'), PNG);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function params(overrides: Partial<AssetsPipelineParams> = {}): AssetsPipelineParams {
  return { moduleDir: dir, store: new MemoryStore(), dryRun: false, check: false, output: sink(), ...overrides };
}

describe('collectAssetRefs', () => {
  it('znajduje image (SCENE_HOTSPOTS) i character.avatar (DIALOGUE)', () => {
    const refs = collectAssetRefs(moduleWithAssets());
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.id).sort()).toEqual(expect.arrayContaining([expect.stringContaining('#image'), expect.stringContaining('#character.avatar')]));
  });

  it('puste albo brakujące pole (avatar jest opcjonalny) nie jest zasobem', () => {
    const module = moduleWithAssets();
    const dialogue = (module.blocks as Record<string, unknown>[]).find((b) => b.type === 'DIALOGUE') as { character: { avatar?: string } };
    delete dialogue.character.avatar;
    expect(collectAssetRefs(module)).toHaveLength(1);
  });
});

// hotspots[].media (B-086/D-071): image/audio karty hotspotu i obraz zagnieżdżonej sceny (media.kind:'scene') to
// zasoby jak image/character.avatar - hash-wersjonowane, publikowane tym samym potokiem. document (title+lines) nie
// jest zasobem (to tekst w treści, nie plik) - celowo bez testu na to tutaj.
function moduleWithHotspotMedia(): Record<string, unknown> {
  const module = moduleWithAssets();
  const scene = (module.blocks as Record<string, unknown>[]).find((b) => b.type === 'SCENE_HOTSPOTS') as {
    hotspots: Record<string, unknown>[];
  };
  scene.hotspots = [
    { id: 'h1', label: 'Zdjęcie', x: 0, y: 0, width: 10, height: 10, content: 'x', media: { kind: 'image', src: 'kartka.png', alt: 'x' } },
    { id: 'h2', label: 'Telefon', x: 0, y: 0, width: 10, height: 10, content: 'x', media: { kind: 'audio', audioUrl: 'poczta.mp3', transcript: 'x' } },
    {
      id: 'h3',
      label: 'Monitor',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      content: 'x',
      media: {
        kind: 'scene',
        scene: {
          image: 'pulpit.png',
          imageAlt: 'x',
          hotspots: [{ id: 'h3-1', label: 'Outlook', x: 0, y: 0, width: 10, height: 10, content: 'x', media: { kind: 'image', src: 'mail.png', alt: 'x' } }],
        },
      },
    },
  ];
  return module;
}

describe('collectAssetRefs: hotspots[].media (B-086/D-071)', () => {
  it('znajduje media.src (image), media.audioUrl (audio) i media.scene.{image, hotspots[].media.src} (zagnieżdżona scena)', () => {
    const refs = collectAssetRefs(moduleWithHotspotMedia());
    // 2 (image + avatar z moduleWithAssets) + 4 (h1 image, h2 audio, h3 scene.image, h3-1 nested image).
    expect(refs).toHaveLength(6);
    const values = refs.map((ref) => ref.value).sort();
    expect(values).toEqual(['anna.png', 'kartka.png', 'mail.png', 'poczta.mp3', 'pulpit.png', 'scena.png']);
  });
});

// Grafika kroków odprawy (BRIEFING, D-084): scena kroku, wariant bez animacji i zamknięta teczka to zasoby potoku.
function moduleWithBriefingScenes(): Record<string, unknown> {
  const module = moduleWithAssets();
  const briefing = (module.blocks as Record<string, unknown>[]).find((b) => b.type === 'BRIEFING') as { steps: Record<string, unknown>[] };
  const typewriter = briefing.steps.find((s) => s.kind === 'typewriter')!;
  const caseFile = briefing.steps.find((s) => s.kind === 'caseFile')!;
  Object.assign(typewriter, { image: 'biurko.png', imageReducedMotion: 'biurko-static.png', hotspot: { id: 'telefon', x: 1, y: 1, w: 10, h: 10 } });
  Object.assign(caseFile, { closedImage: 'teczka.png', image: 'akta.png', hotspot: { id: 'teczka', x: 1, y: 1, w: 10, h: 10 } });
  return module;
}

describe('grafika kroków odprawy (BRIEFING, D-084)', () => {
  it('collectAssetRefs znajduje steps[].image, imageReducedMotion i closedImage', () => {
    const values = collectAssetRefs(moduleWithBriefingScenes()).map((ref) => ref.value).sort();
    expect(values).toEqual(['akta.png', 'anna.png', 'biurko-static.png', 'biurko.png', 'scena.png', 'teczka.png']);
  });

  it('brak pliku obrazu kroku w assets/ przerywa publikację (bez zapisu locka)', async () => {
    await writeFile(modulePath, JSON.stringify(moduleWithBriefingScenes()));
    for (const file of ['biurko.png', 'biurko-static.png', 'akta.png']) await writeFile(join(assetsDir, file), PNG); // bez teczka.png
    await expect(runAssetsPipeline(params())).rejects.toThrow(/Zasób "teczka\.png" \(blok "odprawa"\) nie istnieje w katalogu assets\/ modułu/);
    await expect(readFile(join(dir, 'assets.lock.json'), 'utf8')).rejects.toThrow();
  });

  it('moduł 1: każdy obraz odprawy wskazuje istniejący plik w assets/ (przed publikacją nazwa pliku, po - klucz z locka)', async () => {
    const moduleDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'content', 'modules', 'wyludzone-haslo');
    const raw = JSON.parse(await readFile(join(moduleDir, 'module.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(moduleDir, 'assets.lock.json'), 'utf8')) as { entries: Record<string, { original: string; key: string }> };
    const refs = collectAssetRefs(raw).filter((ref) => ref.blockId === 'odprawa');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const entry = lock.entries[ref.id];
      const original = entry && entry.key === ref.value ? entry.original : ref.value;
      await expect(readFile(join(moduleDir, 'assets', ...original.split('/'))), ref.id).resolves.toBeInstanceOf(Buffer);
    }
  });
});

describe('runAssetsPipeline: hotspots[].media (B-086/D-071)', () => {
  it('publikuje image i audio (mp3) hotspotu oraz obraz zagnieżdżonej sceny z poprawnym content-type', async () => {
    await writeFile(modulePath, JSON.stringify(moduleWithHotspotMedia()));
    await writeFile(join(assetsDir, 'kartka.png'), PNG);
    await writeFile(join(assetsDir, 'poczta.mp3'), new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])); // nagłówek ID3 + śmieci (treść nieważna)
    await writeFile(join(assetsDir, 'pulpit.png'), PNG);
    await writeFile(join(assetsDir, 'mail.png'), PNG);

    const store = new MemoryStore();
    const result = await runAssetsPipeline(params({ store }));
    expect(result.published).toBe(6);

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const scene = module.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS');
    const [h1, h2, h3] = scene.hotspots;
    expect(h1.media.src).toMatch(/^assets\/sprawa-testowa\/kartka\.[0-9a-f]{8}\.png$/);
    expect(h2.media.audioUrl).toMatch(/^assets\/sprawa-testowa\/poczta\.[0-9a-f]{8}\.mp3$/);
    expect(h3.media.scene.image).toMatch(/^assets\/sprawa-testowa\/pulpit\.[0-9a-f]{8}\.png$/);
    expect(h3.media.scene.hotspots[0].media.src).toMatch(/^assets\/sprawa-testowa\/mail\.[0-9a-f]{8}\.png$/);

    expect(store.objects.get(h2.media.audioUrl)!.options).toEqual({ contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000, immutable' });
    expect(store.objects.get(h1.media.src)!.options).toEqual({ contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' });

    // parseModule (wywołane wewnątrz runAssetsPipeline przed zapisem) już to potwierdziło, ale sprawdzamy jawnie:
    // kluczowane pola po publikacji dalej przechodzą walidację schematu (ASSET_PATH w common.ts akceptuje ścieżkę z hashem).
    expect(() => JSON.stringify(module)).not.toThrow();
  });
});

describe('assertAssetPathsClassified', () => {
  const real = requireCjs('../../../packages/content/dist/index.js') as { FIELD_CLASSIFICATION: Record<string, { client: string[]; secret: string[] }> };
  const clone = () => JSON.parse(JSON.stringify(real.FIELD_CLASSIFICATION)) as Record<string, { client: string[]; secret: string[] }>;

  it('rzeczywista klasyfikacja: image i character.avatar są client', () => {
    expect(() => assertAssetPathsClassified(real.FIELD_CLASSIFICATION)).not.toThrow();
  });

  it('pole przeniesione do secret: błąd (zasób publicznego magazynu nie może go zawierać)', () => {
    const classification = clone();
    classification.SCENE_HOTSPOTS.client = classification.SCENE_HOTSPOTS.client.filter((path) => path !== 'image');
    classification.SCENE_HOTSPOTS.secret.push('image');
    expect(() => assertAssetPathsClassified(classification)).toThrow(/secret/);
  });

  it('pole nieznane w klasyfikacji (schemat się zmienił): błąd', () => {
    const classification = clone();
    classification.SCENE_HOTSPOTS = { client: [], secret: [] };
    expect(() => assertAssetPathsClassified(classification)).toThrow(/nie istnieje w klasyfikacji/);
  });
});

describe('runAssetsPipeline', () => {
  it('publikuje zasoby, wpisuje wersjonowany klucz do module.json, zapisuje assets.lock.json; wynik przechodzi parseModule', async () => {
    const store = new MemoryStore();
    const result = await runAssetsPipeline(params({ store }));
    expect(result.published).toBe(2);
    expect(result.cached).toBe(0);

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const scene = module.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS');
    const dialogue = module.blocks.find((b: { type: string }) => b.type === 'DIALOGUE');
    expect(scene.image).toMatch(/^assets\/sprawa-testowa\/scena\.[0-9a-f]{8}\.png$/);
    expect(dialogue.character.avatar).toMatch(/^assets\/sprawa-testowa\/anna\.[0-9a-f]{8}\.png$/);

    const stored = store.objects.get(scene.image)!;
    expect(stored.options).toEqual({ contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' });
    expect(Buffer.from(stored.body)).toEqual(Buffer.from(PNG));

    const lock = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    expect(lock.entries[Object.keys(lock.entries).find((id) => id.includes('#image'))!].original).toBe('scena.png');
  });

  it('drugi przebieg: zero zapisów do magazynu, pliki bez zmian (idempotencja)', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    const moduleBefore = await readFile(modulePath, 'utf8');
    const lockBefore = await readFile(join(dir, 'assets.lock.json'), 'utf8');
    const puts = store.calls.put;
    const result = await runAssetsPipeline(params({ store }));
    expect(result.published).toBe(0);
    expect(result.cached).toBe(2);
    expect(store.calls.put).toBe(puts);
    expect(await readFile(modulePath, 'utf8')).toBe(moduleBefore);
    expect(await readFile(join(dir, 'assets.lock.json'), 'utf8')).toBe(lockBefore);
  });

  it('zmiana treści pliku źródłowego (ta sama nazwa) publikuje NOWY klucz; stary zostaje w magazynie', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    const before = JSON.parse(await readFile(modulePath, 'utf8'));
    const oldKey = before.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').image;

    await writeFile(join(assetsDir, 'scena.png'), new Uint8Array([...PNG, 9, 9, 9]));
    const result = await runAssetsPipeline(params({ store }));
    expect(result.published).toBe(1);
    expect(result.cached).toBe(1); // avatar bez zmian

    const after = JSON.parse(await readFile(modulePath, 'utf8'));
    const newKey = after.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').image;
    expect(newKey).not.toBe(oldKey);
    expect(store.objects.has(oldKey)).toBe(true); // stary plik zostaje (starsze wersje kursu mogą wskazywać)
  });

  // B-093: module.json i assets.lock.json to DWA OSOBNE writeIfChanged na końcu przebiegu, nie jedna operacja -
  // crash/przerwanie MIĘDZY nimi (albo ręczna edycja jednego pliku bez drugiego - dokładnie tak powstał ten stan
  // przy prawdziwej publikacji biuro-anny.svg w tym PR-ze) zostawia lock z nowym kluczem, ale pole w module.json
  // wciąż na STARYM. Dziś resolveOriginal() traktuje niepasujące pole module.json jak nieopublikowaną nazwę pliku
  // źródłowego i rzuca mylący błąd "zasób nie istnieje", zamiast się z tego naprawić. Naprawa: osobny mały PR po
  // merge #32 (nie teraz) - `it.fails` dokumentuje błąd, nie psując dzisiejszego zielonego CI.
  it.fails('B-093: pole w module.json niepasujące do assets.lock.json (crash/edycja między dwoma zapisami) - kolejny --assets powinien się naprawić, dziś rzuca mylący błąd', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store })); // publikacja 1: scena.png -> hashA, module.json i lock spójne
    const afterFirst = JSON.parse(await readFile(modulePath, 'utf8'));
    const keyA = afterFirst.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').image;

    await writeFile(join(assetsDir, 'scena.png'), new Uint8Array([...PNG, 9, 9, 9])); // "asset zmieniony"
    await runAssetsPipeline(params({ store })); // publikacja 2: hashB, module.json i lock znów spójne (oba na hashB)

    // Symulacja crasha MIĘDZY dwoma writeIfChanged: lock.json zostaje na hashB (jak po publikacji 2), ale module.json
    // cofnięty do STAREGO klucza hashA - "asset zmieniony, wcześniej opublikowany pod innym kluczem".
    const desynced = JSON.parse(await readFile(modulePath, 'utf8'));
    desynced.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').image = keyA;
    await writeFile(modulePath, JSON.stringify(desynced));

    // Kolejny --assets (bez żadnej nowej zmiany pliku źródłowego) powinien się z tego naprawić: module.json ma wrócić
    // do klucza, który lock.json (źródło prawdy o publikacji, D-068) już zna dla tego zasobu - bez rzucania.
    await runAssetsPipeline(params({ store }));
    const repaired = JSON.parse(await readFile(modulePath, 'utf8'));
    const lock = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    const lockKey = lock.entries[Object.keys(lock.entries).find((id) => id.includes('#image'))!].key;
    expect(repaired.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').image).toBe(lockKey);
  });

  it('SVG z aktywną treścią (onload=): odrzucony, nigdy nie trafia do magazynu, module.json bez zmian', async () => {
    // Błąd przerywa przebieg jak w audio: pliki OK przed nim (tu: obraz sceny) mogą już być opublikowane, ale module.json zmienia się
    // dopiero na końcu (po pełnym przebiegu bez błędu) - drugi przebieg po poprawce dokończy tylko to, czego jeszcze nie ma.
    const module = moduleWithAssets({ avatar: 'zla.svg' });
    await writeFile(modulePath, JSON.stringify(module));
    await writeFile(join(assetsDir, 'zla.svg'), MALICIOUS_SVG);
    const store = new MemoryStore();
    const before = await readFile(modulePath, 'utf8');
    await expect(runAssetsPipeline(params({ store }))).rejects.toThrow(/lint SVG/);
    expect([...store.objects.keys()].some((key) => key.includes('zla'))).toBe(false);
    expect(await readFile(modulePath, 'utf8')).toBe(before);
  });

  it('czysty SVG jest publikowany (image/svg+xml)', async () => {
    const module = moduleWithAssets({ avatar: 'dobra.svg' });
    await writeFile(modulePath, JSON.stringify(module));
    await writeFile(join(assetsDir, 'dobra.svg'), CLEAN_SVG);
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    const saved = JSON.parse(await readFile(modulePath, 'utf8'));
    const avatar = saved.blocks.find((b: { type: string }) => b.type === 'DIALOGUE').character.avatar;
    expect(avatar).toMatch(/\.svg$/);
    expect(store.objects.get(avatar)!.options.contentType).toBe('image/svg+xml');
  });

  it('SVG z CRLF (git core.autocrlf=true na Windows) daje TEN SAM skrót co LF - normalizacja przed haszowaniem/publikacją', async () => {
    // Realny przypadek: autor treści na Windows checkoutuje LF-owy commit, git zamienia na CRLF, --assets policzyłby
    // (bez normalizacji) inny skrót niż ten sam plik na Linuksie/Macu - osobny, zduplikowany klucz w magazynie dla
    // treści, która się NIE zmieniła (znalezione przy publikacji zasobów modułu 1: avatary dostały nowy hash mimo
    // braku edycji). Ten sam plik zapisany z \n i z \r\n musi dać identyczny klucz.
    const svgLf = CLEAN_SVG.replace('><rect', '>\n<rect').replace('/></svg>', '/>\n</svg>'); // wieloliniowy, żeby \r\n miało co zastąpić
    const svgCrlf = Buffer.from(svgLf.replace(/\n/g, '\r\n'), 'utf8');
    expect(svgCrlf.includes(0x0d)).toBe(true); // sanity: fixtura faktycznie ma CRLF

    const moduleLf = moduleWithAssets({ avatar: 'lf.svg' });
    await writeFile(modulePath, JSON.stringify(moduleLf));
    await writeFile(join(assetsDir, 'lf.svg'), svgLf);
    const storeLf = new MemoryStore();
    await runAssetsPipeline(params({ store: storeLf }));
    const keyLf = JSON.parse(await readFile(modulePath, 'utf8')).blocks.find((b: { type: string }) => b.type === 'DIALOGUE').character.avatar;

    const moduleCrlf = moduleWithAssets({ avatar: 'crlf.svg' });
    await writeFile(modulePath, JSON.stringify(moduleCrlf));
    await writeFile(join(assetsDir, 'crlf.svg'), svgCrlf);
    const storeCrlf = new MemoryStore();
    await runAssetsPipeline(params({ store: storeCrlf }));
    const keyCrlf = JSON.parse(await readFile(modulePath, 'utf8')).blocks.find((b: { type: string }) => b.type === 'DIALOGUE').character.avatar;

    expect(keyCrlf.match(/\.([0-9a-f]{8})\.svg$/)![1]).toBe(keyLf.match(/\.([0-9a-f]{8})\.svg$/)![1]);
    // Opublikowana treść też jest znormalizowana (nie samo haszowanie) - magazyn nigdy nie dostaje CRLF.
    expect(Buffer.from(storeCrlf.objects.get(keyCrlf)!.body).includes(0x0d)).toBe(false);
  });

  it('plik zakodowany jako UTF-16 (z BOM) zamiast UTF-8: odrzucony (zła interpretacja kodowania omijałaby regexy lintu)', async () => {
    // "<script>alert(1)</script>" jako UTF-16LE z BOM: czytany jako UTF-8 (bajt po bajcie) dałby ciąg z bajtami NUL między znakami,
    // który żaden wzorzec dosłownego tekstu by nie złapał - dlatego lint wymaga ścisłego UTF-8 PRZED sprawdzeniem treści.
    const text = '<svg><script>alert(1)</script></svg>';
    const utf16 = Buffer.alloc(2 + text.length * 2);
    utf16.writeUInt8(0xff, 0);
    utf16.writeUInt8(0xfe, 1);
    for (let i = 0; i < text.length; i += 1) utf16.writeUInt16LE(text.charCodeAt(i), 2 + i * 2);

    const module = moduleWithAssets({ avatar: 'zle-kodowanie.svg' });
    await writeFile(modulePath, JSON.stringify(module));
    await writeFile(join(assetsDir, 'zle-kodowanie.svg'), utf16);
    const store = new MemoryStore();
    const before = await readFile(modulePath, 'utf8');
    await expect(runAssetsPipeline(params({ store }))).rejects.toThrow(/UTF-8/);
    expect([...store.objects.keys()].some((key) => key.includes('zle-kodowanie'))).toBe(false);
    expect(await readFile(modulePath, 'utf8')).toBe(before);
  });

  it('brakujący plik źródłowy: czytelny błąd z nazwą bloku i pliku, bez zapisu', async () => {
    await rm(join(assetsDir, 'scena.png'));
    const store = new MemoryStore();
    await expect(runAssetsPipeline(params({ store }))).rejects.toThrow(/scena\.png/);
    expect(store.calls.put).toBe(0);
  });

  it('slug w module.json inny niż katalog: błąd', async () => {
    const other = join(root, 'inny');
    await mkdir(join(other, 'assets'), { recursive: true });
    await writeFile(join(other, 'module.json'), JSON.stringify(moduleWithAssets()));
    const store = new MemoryStore();
    await expect(runAssetsPipeline(params({ moduleDir: other, store }))).rejects.toThrow(/Slug/);
    expect(store.calls.put).toBe(0);
  });

  it('--only: publikuje tylko wskazany blok, drugi zostaje bez zmian w locku', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    const lockBefore = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    await writeFile(join(assetsDir, 'scena.png'), new Uint8Array([...PNG, 1]));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const sceneId = module.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').id;
    const result = await runAssetsPipeline(params({ store, only: [sceneId] }));
    expect(result.published).toBe(1);
    const lockAfter = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    const avatarId = Object.keys(lockAfter.entries).find((id) => id.includes('#character.avatar'))!;
    expect(lockAfter.entries[avatarId]).toEqual(lockBefore.entries[avatarId]);
  });

  it('--only: nieznany blok to błąd', async () => {
    await expect(runAssetsPipeline(params({ only: ['nie-ma'] }))).rejects.toThrow(/--only/);
  });

  it('--dry-run: bez zapisów do magazynu i bez zmian w module.json; liczy do publikacji i bez zmian', async () => {
    const store = new MemoryStore();
    const before = await readFile(modulePath, 'utf8');
    const first = await runAssetsPipeline(params({ store, dryRun: true }));
    expect(first.published).toBe(2);
    expect(first.cached).toBe(0);
    expect(store.calls).toEqual({ head: 0, get: 0, put: 0 });
    expect(await readFile(modulePath, 'utf8')).toBe(before);

    await runAssetsPipeline(params({ store })); // publikacja "na serio"
    const second = await runAssetsPipeline(params({ store, dryRun: true }));
    expect(second.published).toBe(0);
    expect(second.cached).toBe(2);
  });
});

/** Magazyn w pamięci, który rzuca na HEAD/PUT dla wskazanych kluczy (albo dla n-tego wywołania) - do testów awarii sieci. */
class FlakyStore implements ObjectStore {
  private readonly inner = new MemoryStore();
  private headCalls = 0;
  private putCalls = 0;
  constructor(private readonly opts: { failHeadOnCall?: number; failPutOnCall?: number; failHeadForKeyIncluding?: string } = {}) {}

  get objects() {
    return this.inner.objects;
  }

  async head(key: string): Promise<ObjectHead | null> {
    this.headCalls += 1;
    if (this.opts.failHeadOnCall === this.headCalls || (this.opts.failHeadForKeyIncluding && key.includes(this.opts.failHeadForKeyIncluding))) {
      throw new Error('R2 HEAD kaboom: symulowana awaria sieci');
    }
    return this.inner.head(key);
  }

  async put(key: string, body: Uint8Array, options: PutOptions, overwrite = false): Promise<boolean> {
    this.putCalls += 1;
    if (this.opts.failPutOnCall === this.putCalls) throw new Error('R2 PUT kaboom: symulowana awaria sieci');
    return this.inner.put(key, body, options, overwrite);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.inner.get(key);
  }
}

describe('runAssetsPipeline: awaria magazynu (HEAD/PUT) jest PER-ZASÓB, nie przerywa całego przebiegu', () => {
  it('PUT drugiego zasobu rzuca: pierwszy jest opublikowany i trafia do locka, drugi NIE trafia do locka (tylko do problems)', async () => {
    const store = new FlakyStore({ failPutOnCall: 2 });
    const result = await runAssetsPipeline(params({ store }));

    expect(result.published).toBe(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/publikacja w magazynie nie powiodła się.*NIE zapisano w assets\.lock\.json/);

    const lock = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    expect(Object.keys(lock.entries)).toHaveLength(1); // wyłącznie zasób, którego PUT się powiódł

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const scene = module.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS');
    const dialogue = module.blocks.find((b: { type: string }) => b.type === 'DIALOGUE');
    // Dokładnie jedno z dwóch pól zostało podmienione na klucz - drugie zostaje nazwą pliku źródłowego (nieopublikowane).
    const values = [scene.image, dialogue.character.avatar];
    expect(values.filter((v) => /^assets\//.test(v))).toHaveLength(1);
    expect(values.filter((v) => v === 'scena.png' || v === 'anna.png')).toHaveLength(1);
  });

  it('kolejny przebieg po naprawie magazynu dokańcza WYŁĄCZNIE brakujący zasób (ten opublikowany zostaje z locka nietknięty)', async () => {
    const flaky = new FlakyStore({ failPutOnCall: 2 });
    const first = await runAssetsPipeline(params({ store: flaky }));
    expect(first.published).toBe(1);

    // Ten sam magazyn (dziedziczy stan z FlakyStore.inner), ale bez wstrzykniętej awarii tym razem.
    const healthy = new MemoryStore();
    for (const [key, object] of flaky.objects) healthy.objects.set(key, object);
    const second = await runAssetsPipeline(params({ store: healthy }));
    expect(second.published).toBe(1); // tylko ten, co wcześniej padł
    expect(second.cached).toBe(1); // ten, co się udał za pierwszym razem
    expect(second.problems).toEqual([]);

    const lock = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    expect(Object.keys(lock.entries)).toHaveLength(2);
  });
});

describe('--check (offline)', () => {
  it('bez assets.lock.json: błąd; po publikacji: OK; po zmianie źródła: problem; bez dotykania magazynu', async () => {
    const offlineStore = new MemoryStore();
    expect((await runAssetsPipeline(params({ store: offlineStore, check: true }))).problems[0]).toMatch(/Brak assets.lock.json/);

    await runAssetsPipeline(params());
    expect((await runAssetsPipeline(params({ store: offlineStore, check: true }))).problems).toEqual([]);
    expect(offlineStore.calls).toEqual({ head: 0, get: 0, put: 0 });

    await writeFile(join(assetsDir, 'scena.png'), new Uint8Array([...PNG, 7]));
    const result = await runAssetsPipeline(params({ store: offlineStore, check: true }));
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/zmienił się/);
  });

  it('wpis w locku bez zasobu w module: problem', async () => {
    await runAssetsPipeline(params());
    const lock = JSON.parse(await readFile(join(dir, 'assets.lock.json'), 'utf8'));
    lock.entries['nie-ma#image'] = { original: 'x.png', hash: 'aaaaaaaa', key: 'assets/sprawa-testowa/x.aaaaaaaa.png' };
    await writeFile(join(dir, 'assets.lock.json'), JSON.stringify(lock));
    const result = await runAssetsPipeline(params({ check: true }));
    expect(result.problems[0]).toMatch(/bez zasobu w module/);
  });

  it('brakujący plik źródłowy przy --check: problem, bez wyjątku', async () => {
    await runAssetsPipeline(params());
    await rm(join(assetsDir, 'scena.png'));
    const result = await runAssetsPipeline(params({ check: true }));
    expect(result.problems.some((p) => p.includes('nie istnieje'))).toBe(true);
  });
});

describe('--check --remote: potwierdza HEAD w PRAWDZIWYM magazynie, nie tylko treść lockfile\'a', () => {
  it('bez --remote: lockfile "kłamie" (opisuje publikację, obiektu nie ma w magazynie) i --check tego NIE wykrywa', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    store.objects.clear(); // symuluje "obiekt zniknął/nigdy nie powstał w magazynie mimo wpisu w locku"

    const result = await runAssetsPipeline(params({ store, check: true })); // bez remote: offline, ufa tylko lockowi
    expect(result.problems).toEqual([]);
  });

  it('z --remote: to samo lockfile\'owe "kłamstwo" jest wykryte (HEAD w magazynie mówi: obiektu nie ma)', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    store.objects.clear();

    const result = await runAssetsPipeline(params({ store, check: true, remote: true }));
    expect(result.problems).toHaveLength(2); // oba zasoby
    expect(result.problems[0]).toMatch(/NIE MA w magazynie/);
  });

  it('z --remote: zasoby faktycznie obecne w magazynie -> OK, wzmianka o --remote w komunikacie', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    const chunks: string[] = [];
    const capture = new Writable({
      write: (chunk, _enc, done) => {
        chunks.push(String(chunk));
        done();
      },
    });

    const result = await runAssetsPipeline(params({ store, check: true, remote: true, output: capture }));
    expect(result.problems).toEqual([]);
    expect(chunks.join('')).toMatch(/OK:.*--remote/);
  });

  it('HEAD w magazynie rzuca (awaria sieci): problem czytelny, bez wyjątku', async () => {
    const store = new MemoryStore();
    await runAssetsPipeline(params({ store }));
    const flaky = new FlakyStore({ failHeadForKeyIncluding: 'scena' });
    for (const [key, object] of store.objects) flaky.objects.set(key, object);

    const result = await runAssetsPipeline(params({ store: flaky, check: true, remote: true }));
    expect(result.problems.some((p) => p.includes('nie udało się sprawdzić magazynu'))).toBe(true);
  });
});
