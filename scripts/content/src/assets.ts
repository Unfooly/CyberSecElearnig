import { readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';
import { assetExt, assetKey, assertSlug, contentHash } from './hash.js';
import { contentIndex, contentNode, encode, isObject, type Json, readJsonFile, say, writeIfChanged } from './io.js';
import { assertSafeKey, IMMUTABLE_CACHE } from './stores/key.js';
import { formatSvgViolations, lintSvg } from './svg-lint.js';
import type { ObjectStore } from './types.js';

// Potok zasobów modułu (obrazy sceny, avatary postaci): autor trzyma pliki źródłowe w packages/content/modules/<slug>/assets/, a pole w
// module.json (np. "image": "office.svg") wskazuje nazwę pliku. Skrypt liczy skrót TREŚCI pliku, publikuje go pod wersjonowaną nazwą
// (assets/<slug>/<nazwa>.<hash8>.<ext>, niemutowalna: D-060) i PODMIENIA pole w module.json na ten klucz. Przy kolejnym uruchomieniu -
// gdy pole już wskazuje na opublikowany klucz (assets.lock.json) - prawdziwe źródło jest odczytywane z locka, więc plik w assets/ może
// zostać pod swoją oryginalną nazwą na stałe (autor go nie przenosi). Zmiana treści pliku (ta sama nazwa) to NOWY klucz przy następnym
// uruchomieniu; stary zostaje w magazynie, bo starsze wersje kursu mogą na niego wskazywać (D-051).

/**
 * Pola-ścieżki zasobów w blokach (wzorce; `*` = każdy element tablicy). Zgodne ze schematem treści
 * (packages/content/src/blocks.ts). hotspots[].media.{src,audioUrl,image}: obraz/audio/zbliżenie NAD odtwarzaczem
 * audio karty hotspotu (B-086/D-071, image: feat/scene-overlay-fix) - media.audioUrl to GOTOWY plik z --assets (jak
 * obraz), NIE przechodzi przez silnik TTS/cues narracji. Od D-082 media audio może zamiast tego mieć `narration` (nagranie z
 * potoku TTS z własnym głosem, scripts/content/src/pipeline.ts) - to pole NIE jest zasobem tego potoku. Zagnieżdżona
 * scena (media.kind:'scene') ma WŁASNY obraz i własne, wewnętrzne hotspoty - zawsze dokładnie jeden poziom
 * (packages/content's innerHotspotSchema), więc bez rekurencji tutaj też.
 */
export const ASSET_PATHS: string[][] = [
  ['image'],
  ['character', 'avatar'],
  ['hotspots', '*', 'media', 'src'],
  ['hotspots', '*', 'media', 'audioUrl'],
  // image: zbliżenie NAD odtwarzaczem audio (opcjonalne, feat/scene-overlay-fix) - osobne pole od media.src (tamto
  // tylko dla kind:'image'), nie koliduje.
  ['hotspots', '*', 'media', 'image'],
  ['hotspots', '*', 'media', 'scene', 'image'],
  ['hotspots', '*', 'media', 'scene', 'hotspots', '*', 'media', 'src'],
  ['hotspots', '*', 'media', 'scene', 'hotspots', '*', 'media', 'audioUrl'],
  ['hotspots', '*', 'media', 'scene', 'hotspots', '*', 'media', 'image'],
  // Grafika kroków odprawy (BRIEFING, D-084): scena kroku, jej wariant bez animacji i zamknięta teczka kroku caseFile.
  ['steps', '*', 'image'],
  ['steps', '*', 'imageReducedMotion'],
  ['steps', '*', 'closedImage'],
];

// fatal: true - żadnych zastępczych znaków U+FFFD po cichu; plik, który nie jest ścisłym UTF-8, jest odrzucany (nie lintowany na oślep).
const SVG_DECODER = new TextDecoder('utf-8', { fatal: true });

const CONTENT_TYPE: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
};

// Jak w scripts/content/src/pipeline.ts (toClassificationPath): `*` w ASSET_PATHS odpowiada `[]` w zapisie ścieżek
// FIELD_CLASSIFICATION (packages/content/src/blocks.ts) - te dwie konwencje muszą się zgadzać, inaczej sprawdzenie
// niżej zawsze fałszywie by "nie znajdowało" pola z tablicą.
const toClassificationPath = (path: string[]) => path.map((part) => (part === '*' ? '[]' : `.${part}`)).join('').replace(/^\./, '');

/**
 * Wiąże ASSET_PATHS z klasyfikacją pól: każde pole musi istnieć w klasyfikacji i być `client` (publiczny magazyn nie może zawierać pola
 * `secret`). Nie sprawdza kierunku odwrotnego (nowe pole obrazu w schemacie bez wzorca tutaj) - nazwy pól obrazów nie mają wspólnego wzorca
 * jak `*Narration`, więc byłyby same fałszywe alarmy; brak wzorca to najwyżej nieopublikowany zasób, nie wyciek.
 */
export function assertAssetPathsClassified(classification: Record<string, { client: string[]; secret: string[] }> = contentIndex.FIELD_CLASSIFICATION): void {
  for (const path of ASSET_PATHS) {
    const dotted = toClassificationPath(path);
    const owners = Object.entries(classification).filter(([, fields]) => fields.client.includes(dotted) || fields.secret.includes(dotted));
    if (owners.length === 0) throw new Error(`ASSET_PATHS: pole "${dotted}" nie istnieje w klasyfikacji pól (schemat się zmienił?).`);
    for (const [type, fields] of owners) {
      if (fields.secret.includes(dotted)) throw new Error(`ASSET_PATHS: pole "${dotted}" (${type}) jest secret: zasób publicznego magazynu nie może go zawierać.`);
    }
  }
}

export interface AssetRef {
  /** Klucz w lockfile: `<blockId>#<ścieżka>` (np. `intro#character.avatar`). */
  id: string;
  blockId: string;
  holder: Json;
  key: string;
  /** Aktualna wartość pola: nazwa pliku źródłowego (pierwszy przebieg) albo już opublikowany klucz. */
  value: string;
}

function expandAsset(node: unknown, path: string[], trail: string[]): { holder: Json; key: string; trail: string[] }[] {
  const [head, ...rest] = path;
  if (rest.length === 0) return isObject(node) && typeof node[head] === 'string' ? [{ holder: node, key: head, trail: [...trail, head] }] : [];
  if (head === '*') {
    // Jak scripts/content/src/pipeline.ts's expand(): brak dopasowania (np. media.kind inny niż oczekiwany dla tej
    // ścieżki - pole po prostu nie istnieje) to cicho pusta lista, nie błąd - to samo pole może pasować do wielu
    // wzorców ASSET_PATHS (media.src dla image, media.audioUrl dla audio), z których tylko jeden trafi.
    return Array.isArray(node) ? node.flatMap((item, index) => expandAsset(item, rest, [...trail, String(index)])) : [];
  }
  return isObject(node) ? expandAsset((node as Json)[head], rest, [...trail, head]) : [];
}

export function collectAssetRefs(raw: Json): AssetRef[] {
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const refs: AssetRef[] = [];
  for (const block of blocks) {
    if (!isObject(block) || typeof block.id !== 'string') continue;
    for (const path of ASSET_PATHS) {
      for (const { holder, key, trail } of expandAsset(block, path, [])) {
        const value = holder[key] as string;
        if (value.trim() === '') continue;
        refs.push({ id: `${block.id}#${trail.join('.')}`, blockId: block.id, holder, key, value });
      }
    }
  }
  return refs;
}

interface AssetsLockEntry {
  /** Ścieżka źródłowa względem assets/ (np. "scenes/office.svg"); NIGDY klucz publiczny (ten jest w polu `key`). */
  original: string;
  hash: string;
  key: string;
}

interface AssetsLock {
  lockVersion: 1;
  slug: string;
  entries: Record<string, AssetsLockEntry>;
}

export interface AssetsPipelineParams {
  moduleDir: string;
  /** Domyślnie <moduleDir>/assets. */
  assetsDir?: string;
  store: ObjectStore;
  dryRun: boolean;
  check: boolean;
  /** --check --remote: dodatkowo potwierdza HEAD w magazynie skonfigurowanym przez --storage (wymaga sieci/kluczy -
   * bez tego --check zostaje w pełni offline, D-060). Bez tej flagi assets.lock.json jest jedynym źródłem prawdy dla
   * --check, więc nie wykrywa obiektu, który zniknął/nigdy nie powstał w magazynie mimo wpisu w locku. */
  remote?: boolean;
  only?: string[];
  output: Writable;
}

export interface AssetsPipelineResult {
  published: number;
  cached: number;
  problems: string[];
}

/** Prawdziwe źródło pola: jeśli pole już wskazuje na klucz z locka, źródłem jest jego oryginalna nazwa; inaczej pole SAMO jest nazwą pliku. */
function resolveOriginal(ref: AssetRef, lock: AssetsLock | null): string {
  const entry = lock?.entries[ref.id];
  return entry && entry.key === ref.value ? entry.original : ref.value;
}

// \r\n -> \n, bajtowo (bezpieczne dla UTF-8: 0x0D/0x0A nigdy nie występują jako bajt kontynuacji wielobajtowego znaku,
// więc nie trzeba dekodować). Tylko dla plików TEKSTOWYCH (dziś: SVG) - binarne (mp3, png, ...) nigdy nie są dotykane.
function normalizeEol(bytes: Buffer): Buffer {
  const out = Buffer.alloc(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out[j] = bytes[i];
    j += 1;
  }
  return out.subarray(0, j);
}

async function readSource(assetsDir: string, original: string, blockId: string): Promise<Buffer> {
  assertSafeKey(original); // bez "..", bez segmentów spoza wzorca: broni przed wyjściem poza assetsDir
  const target = resolve(assetsDir, ...original.split('/'));
  if (target !== assetsDir && !target.startsWith(`${assetsDir}${sep}`)) {
    throw new Error(`Zasób "${original}" (blok "${blockId}") wychodzi poza katalog zasobów.`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Zasób "${original}" (blok "${blockId}") nie istnieje w katalogu assets/ modułu.`);
    throw error;
  }
  // `git core.autocrlf=true` (domyślne na Windows) zamienia LF -> CRLF przy checkoucie: bez tej normalizacji ten sam
  // commit dawałby RÓŻNY skrót treści (i osobny, zduplikowany klucz w magazynie) zależnie od checkoutu autora treści -
  // realny przypadek, znaleziony przy publikacji zasobów modułu 1 (avatary Anny/Marka dostały nowy hash mimo braku
  // realnej zmiany treści). `.gitattributes` (packages/content) wymusza LF na checkout dla nowych klonów - ta
  // normalizacja jest drugą linią obrony dla checkoutów sprzed tej zmiany.
  return assetExt(original) === 'svg' ? normalizeEol(bytes) : bytes;
}

export async function runAssetsPipeline(params: AssetsPipelineParams): Promise<AssetsPipelineResult> {
  assertAssetPathsClassified(); // fail-closed: schemat treści a lista pól z zasobami muszą się zgadzać, zanim cokolwiek trafi do magazynu
  const modulePath = join(params.moduleDir, 'module.json');
  const lockPath = join(params.moduleDir, 'assets.lock.json');
  const assetsDir = resolve(params.assetsDir ?? join(params.moduleDir, 'assets'));
  const raw = await readJsonFile(modulePath);
  if (!raw) throw new Error(`Brak pliku ${modulePath}.`);
  contentNode.parseModule(raw);
  const slug = String(raw.slug);
  if (slug !== basename(resolve(params.moduleDir))) throw new Error(`Slug w module.json ("${slug}") różni się od nazwy katalogu modułu.`);

  const refs = collectAssetRefs(raw);
  const lock = (await readJsonFile(lockPath)) as AssetsLock | null;
  const only = params.only && params.only.length > 0 ? new Set(params.only) : null;
  const selected = refs.filter((ref) => !only || only.has(ref.blockId));
  if (only) {
    const unknown = [...only].filter((blockId) => !refs.some((ref) => ref.blockId === blockId));
    if (unknown.length > 0) throw new Error(`--only: brak zasobów w blokach: ${unknown.join(', ')}.`);
  }

  if (params.check) return checkAssets(refs, lock, assetsDir, params.remote ? params.store : null, params.output);

  const entries: Record<string, AssetsLockEntry> = only && lock ? { ...lock.entries } : {};
  const problems: string[] = [];
  let published = 0;
  let cached = 0;

  for (const ref of selected) {
    const original = resolveOriginal(ref, lock);
    const ext = assetExt(original);
    if (!CONTENT_TYPE[ext]) throw new Error(`Zasób "${original}" (blok "${ref.blockId}"): nieobsługiwane rozszerzenie ".${ext}".`);
    const bytes = await readSource(assetsDir, original, ref.blockId);
    if (ext === 'svg') {
      let text: string;
      try {
        text = SVG_DECODER.decode(bytes); // ścisły UTF-8 (fatal): odrzuca m.in. plik zakodowany jako UTF-16 (z BOM) czytany bajt-po-bajcie
      } catch {
        throw new Error(`Zasób "${original}" (blok "${ref.blockId}") odrzucony: plik nie jest poprawnym UTF-8 (np. UTF-16/32 z BOM).`);
      }
      const violations = lintSvg(text);
      if (violations.length > 0) throw new Error(`Zasób "${original}" (blok "${ref.blockId}") odrzucony przez lint SVG:\n${formatSvgViolations(violations)}`);
    }
    // Błędy WALIDACJI TREŚCI (rozszerzenie, UTF-8, lint SVG) powyżej zostają TWARDE (rzucają, przerywają cały przebieg,
    // zero zapisu) - to pomyłka autora, nie flaki sieci, i nie powinna dać połowicznej publikacji. Od tego miejsca w dół
    // (magazyn) błędy są per-zasób: jeden padnięty HEAD/PUT nie blokuje reszty i NIE trafia do locka (patrz catch niżej).
    const hash8 = contentHash(bytes, 8);
    const key = assetKey({ slug, relativePath: original, hash8 });

    if (params.dryRun) {
      if (ref.value === key) cached += 1;
      else published += 1;
      continue;
    }

    try {
      // Klucz jest niemutowalny (skrót treści w nazwie): istnienie pod tym kluczem oznacza identyczną zawartość, więc pomijamy zapis (ETag/HEAD).
      if (await params.store.head(key)) {
        cached += 1;
      } else {
        await params.store.put(key, bytes, { contentType: CONTENT_TYPE[ext], cacheControl: IMMUTABLE_CACHE }, false);
        published += 1;
        say(params.output, `${ref.id}: ${original} -> ${key}`);
      }
    } catch (error) {
      const problem = `${ref.id}: publikacja w magazynie nie powiodła się (${(error as Error).message}) - NIE zapisano w assets.lock.json, uruchom ponownie.`;
      problems.push(problem);
      say(params.output, `BŁĄD: ${problem}`);
      continue; // Wpis trafia do locka WYŁĄCZNIE po potwierdzonym HEAD/PUT - żaden błąd magazynu nie może go tam doprowadzić.
    }
    ref.holder[ref.key] = key;
    entries[ref.id] = { original, hash: hash8, key };
  }

  if (params.dryRun) {
    say(params.output, `${published} do publikacji, ${cached} bez zmian (--dry-run: bez sieci i bez zapisów; pliki źródłowe są czytane lokalnie, żeby policzyć skrót).`);
    return { published, cached, problems: [] };
  }

  contentNode.parseModule(raw); // walidacja PRZED zapisem (klucze mają poprawne rozszerzenie i format ścieżki)
  const nextLock: AssetsLock = { lockVersion: 1, slug, entries };
  const moduleChanged = await writeIfChanged(modulePath, encode(raw));
  const lockChanged = await writeIfChanged(lockPath, encode(nextLock));
  say(
    params.output,
    `Gotowe: opublikowano ${published}, bez zmian ${cached}, błędów ${problems.length}. module.json ${moduleChanged ? 'zaktualizowany' : 'bez zmian'}, assets.lock.json ${lockChanged ? 'zaktualizowany' : 'bez zmian'}.`,
  );
  return { published, cached, problems };
}

/**
 * --check: domyślnie OFFLINE (bez magazynu i sieci, D-060) - czyta lokalne pliki źródłowe (assets/), żeby porównać
 * ich skrót z assets.lock.json. Z `store` (--check --remote): dodatkowo HEAD każdego wpisu w PRAWDZIWYM magazynie -
 * jedyny sposób odróżnić "lockfile opisuje publikację" od "obiekt naprawdę tam jest" (bez tego --check ufa wyłącznie
 * treści pliku w repo, nie stanowi dowodu, że PUT się kiedykolwiek powiódł).
 */
async function checkAssets(refs: AssetRef[], lock: AssetsLock | null, assetsDir: string, store: ObjectStore | null, output: Writable): Promise<AssetsPipelineResult> {
  const problems: string[] = [];
  if (!lock) {
    problems.push('Brak assets.lock.json: uruchom publikację zasobów modułu (--assets).');
  } else {
    for (const ref of refs) {
      const entry = lock.entries[ref.id];
      if (!entry) {
        problems.push(`${ref.id}: brak wpisu w assets.lock.json.`);
        continue;
      }
      if (ref.value !== entry.key) {
        problems.push(`${ref.id}: pole w module.json nie wskazuje na opublikowany zasób z assets.lock.json.`);
        continue;
      }
      try {
        const bytes = await readSource(assetsDir, entry.original, ref.blockId);
        if (contentHash(bytes, 8) !== entry.hash) problems.push(`${ref.id}: zasób źródłowy "${entry.original}" zmienił się od ostatniej publikacji (uruchom --assets ponownie).`);
      } catch (error) {
        problems.push(`${ref.id}: ${(error as Error).message}`);
      }
      if (store) {
        try {
          if (!(await store.head(entry.key))) problems.push(`${ref.id}: lockfile opisuje publikację ("${entry.key}"), ale obiektu NIE MA w magazynie (--remote).`);
        } catch (error) {
          problems.push(`${ref.id}: nie udało się sprawdzić magazynu dla "${entry.key}" (${(error as Error).message}).`);
        }
      }
    }
    const known = new Set(refs.map((ref) => ref.id));
    for (const id of Object.keys(lock.entries)) if (!known.has(id)) problems.push(`${id}: wpis w assets.lock.json bez zasobu w module (usuń albo opublikuj ponownie).`);
  }
  for (const problem of problems) say(output, `BŁĄD: ${problem}`);
  if (problems.length === 0) say(output, `OK: ${refs.length} zasobów ma aktualne publikacje (sprawdzono ${store ? 'lokalnie i w magazynie, --remote' : 'offline'}).`);
  return { published: 0, cached: refs.length - problems.length, problems };
}

