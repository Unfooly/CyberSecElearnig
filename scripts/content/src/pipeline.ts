import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { alignmentToCues } from './cues.js';
import { audioKey, manifestKey, narrationHash, sidecarKey } from './hash.js';
import { confirm, enforceMaxChars, formatPlan, summarizePlan, type PlannedNarration } from './plan.js';
import { AUDIO_CONTENT_TYPE, IMMUTABLE_CACHE, JSON_CONTENT_TYPE, MUTABLE_CACHE } from './stores/key.js';
import type { ObjectStore, TtsProvider } from './types.js';

// Potok audio narracji dla jednego modułu (packages/content/modules/<slug>/module.json): zbiera narracje, dla każdej liczy skrót wejścia
// (tekst, model, język, głos), sprawdza magazyn (HEAD) i generuje TYLKO to, czego brakuje. Wyniki (audioUrl, durationMs, cues) wpisuje do
// module.json, a `audio.lock.json` (w repo) zapamiętuje skróty, głos i wersję partii: dzięki niemu `--check` działa OFFLINE (bez kluczy i sieci)
// i wykrywa narrację, której tekst zmieniono bez ponownego generowania. Nagrania i sidecary (czasy napisów) są niemutowalne (nazwa z hashem).
// Kolejność kontraktu: walidacja modułu -> plan -> limit znaków -> potwierdzenie -> DOPIERO WTEDY pierwsze wywołanie ElevenLabs.

const requireCjs = createRequire(import.meta.url);
const content = requireCjs('../../../packages/content/dist/node.js') as { parseModule: (input: unknown) => unknown };
const contentSchema = requireCjs('../../../packages/content/dist/index.js') as {
  FIELD_CLASSIFICATION: Record<string, { client: string[]; secret: string[] }>;
};

/**
 * Miejsca narracji, dla których GENERUJEMY audio (wzorce ścieżek; `*` = każdy element tablicy). Pliki audio, sidecary (pełny tekst napisów)
 * i manifest lądują w PUBLICZNYM magazynie bez autoryzacji, więc wolno tu umieszczać wyłącznie pola sklasyfikowane jako `client`
 * (FIELD_CLASSIFICATION w packages/content). Pola `secret` (podpowiedzi) zostają tekstowe: assertNarrationPathsClassified pilnuje tego
 * przy każdym uruchomieniu i w teście. Audio podpowiedzi przez API po odblokowaniu (podpisany URL): backlog B-082.
 */
export const NARRATION_PATHS: string[][] = [
  ['narration'],
  ['hotspots', '*', 'narration'],
  ['questions', '*', 'answerNarration'],
  ['questions', '*', 'lines', '*', 'narration'],
];

/** Narracje w polach `secret`: bez audio (tylko tekst). Wpisane audioUrl/durationMs/cues w takim polu to błąd modułu. */
export const TEXT_ONLY_NARRATION_PATHS: string[][] = [['hints', '*', 'narration']];

const NARRATION_LEAVES = ['text', 'audioUrl', 'durationMs', 'cues[].text', 'cues[].startMs'];
const toClassificationPath = (path: string[]) => path.map((part) => (part === '*' ? '[]' : `.${part}`)).join('').replace(/^\./, '');

/**
 * Wiąże NARRATION_PATHS z klasyfikacją pól: każda ścieżka audio musi w KAŻDYM typie bloku, który ją ma, mieć wszystkie pola narracji jako
 * `client` (i żadnego jako `secret`), a każde pole narracji sklasyfikowane jako `secret` musi być na liście TEXT_ONLY (żadne nie może
 * wisieć poza obiema listami). Rzuca przy niezgodności (nowe pole narracji w schemacie bez decyzji tutaj = błąd, nie ciche audio).
 */
export function assertNarrationPathsClassified(
  classification: Record<string, { client: string[]; secret: string[] }> = contentSchema.FIELD_CLASSIFICATION,
): void {
  const audioPrefixes = NARRATION_PATHS.map(toClassificationPath);
  const textOnlyPrefixes = TEXT_ONLY_NARRATION_PATHS.map(toClassificationPath);
  for (const prefix of audioPrefixes) {
    const owners = Object.entries(classification).filter(([, fields]) => [...fields.client, ...fields.secret].includes(`${prefix}.text`));
    if (owners.length === 0) throw new Error(`NARRATION_PATHS: ścieżka "${prefix}" nie istnieje w klasyfikacji pól (schemat się zmienił?).`);
    for (const [type, fields] of owners) {
      for (const leaf of NARRATION_LEAVES) {
        const path = `${prefix}.${leaf}`;
        if (fields.secret.includes(path) || !fields.client.includes(path)) {
          throw new Error(`NARRATION_PATHS: pole "${path}" (${type}) nie jest polem client: audio publicznego magazynu nie może go zawierać.`);
        }
      }
    }
  }
  for (const [type, fields] of Object.entries(classification)) {
    for (const path of [...fields.client, ...fields.secret]) {
      if (!/(^|\.)(narration|answerNarration)\.audioUrl$/.test(path)) continue;
      const prefix = path.slice(0, -'.audioUrl'.length);
      if (fields.secret.includes(path)) {
        if (!textOnlyPrefixes.includes(prefix)) throw new Error(`Pole narracji "${prefix}" (${type}) jest secret, ale nie ma go w TEXT_ONLY_NARRATION_PATHS.`);
      } else if (!audioPrefixes.includes(prefix)) {
        throw new Error(`Pole narracji "${prefix}" (${type}) jest client, ale nie ma go w NARRATION_PATHS (audio nie zostałoby wygenerowane).`);
      }
    }
  }
}

export interface NarrationRef {
  /** Klucz w lockfile: `<blockId>#<ścieżka>` (np. `rozmowa#questions.0.lines.1.narration`). */
  id: string;
  blockId: string;
  holder: Record<string, unknown>;
  key: string;
  text: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expand(node: unknown, path: string[], trail: string[]): { holder: Json; key: string; trail: string[] }[] {
  const [head, ...rest] = path;
  if (rest.length === 0) return isObject(node) && isObject(node[head]) ? [{ holder: node, key: head, trail: [...trail, head] }] : [];
  if (head === '*') {
    return Array.isArray(node) ? node.flatMap((item, index) => expand(item, rest, [...trail, String(index)])) : [];
  }
  return isObject(node) ? expand(node[head], rest, [...trail, head]) : [];
}

/** Zbiera narracje modułu i dodatkowo pilnuje kompletności: każdy obiekt pod kluczem narration/answerNarration musi być objęty wzorcami. */
export function collectNarrations(raw: Json): NarrationRef[] {
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const refs: NarrationRef[] = [];
  const seen = new Set<unknown>();
  for (const block of blocks) {
    if (!isObject(block) || typeof block.id !== 'string') continue;
    for (const path of NARRATION_PATHS) {
      for (const { holder, key, trail } of expand(block, path, [])) {
        const narration = holder[key] as Json;
        seen.add(narration);
        if (typeof narration.text !== 'string' || narration.text.trim() === '') continue;
        refs.push({ id: `${block.id}#${trail.join('.')}`, blockId: block.id, holder: narration, key: '', text: narration.text });
      }
    }
    // Pola secret (podpowiedzi): tylko tekst; audio w takim polu to błąd (trafiłoby do publicznego magazynu razem z napisami).
    for (const path of TEXT_ONLY_NARRATION_PATHS) {
      for (const { holder, key, trail } of expand(block, path, [])) {
        const narration = holder[key] as Json;
        seen.add(narration);
        if ('audioUrl' in narration || 'durationMs' in narration || 'cues' in narration) {
          throw new Error(`Blok "${block.id}": pole ${trail.join('.')} jest tajne (podpowiedź) i nie może mieć audio; usuń audioUrl, durationMs i cues.`);
        }
      }
    }
    // Zabezpieczenie na przyszłość: nowe pole narracji w schemacie bez wzorca tutaj nie może zostać po cichu bez audio.
    const stack: unknown[] = [block];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (isObject(node)) {
        for (const [name, value] of Object.entries(node)) {
          if ((name === 'narration' || name === 'answerNarration') && isObject(value) && !seen.has(value)) {
            throw new Error(`Blok "${block.id}": narracja w nieznanym miejscu (${name}); dodaj wzorzec do NARRATION_PATHS.`);
          }
          stack.push(value);
        }
      }
    }
  }
  return refs;
}

export interface PipelineParams {
  moduleDir: string;
  version: string;
  model: string;
  language: string;
  voiceId: string;
  store: ObjectStore;
  /** Brak w trybach --dry-run i --check (bez kluczy i sieci). */
  tts?: TtsProvider;
  maxChars: number;
  yes: boolean;
  dryRun: boolean;
  check: boolean;
  only?: string[];
  input?: Readable;
  output: Writable;
}

interface LockEntry {
  hash: string;
  key: string;
  textSha: string;
  durationMs: number;
}

interface Lock {
  lockVersion: 1;
  slug: string;
  audioVersion: string;
  model: string;
  language: string;
  voiceId: string;
  entries: Record<string, LockEntry>;
}

interface Sidecar {
  hash: string;
  model: string;
  language: string;
  voiceId: string;
  bytes: number;
  durationMs: number;
  cues: { text: string; startMs: number }[];
}

export interface PipelineResult {
  generated: number;
  cached: number;
  chars: number;
  /** Tylko --check: problemy (pusta lista = OK). */
  problems: string[];
}

const hashFromKey = (key: string) => key.split('/').pop()!.replace(/\.mp3$/, '');

/** Sidecar z magazynu to dane z zewnątrz: zły JSON albo kształt to "brak" (nagranie zostanie wygenerowane od nowa), nie wpis do modułu. */
function parseSidecar(bytes: Uint8Array, key: string, voiceId: string): Sidecar | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Sidecar;
    const cuesOk =
      Array.isArray(value.cues) &&
      value.cues.length > 0 &&
      value.cues.every((cue) => cue && typeof cue.text === 'string' && Number.isInteger(cue.startMs) && cue.startMs >= 0);
    if (value.hash !== hashFromKey(key) || value.voiceId !== voiceId || !cuesOk || !Number.isInteger(value.durationMs)) return null;
    return value;
  } catch {
    return null;
  }
}

const textSha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const say = (out: Writable, line: string) => void out.write(`${line}\n`);

async function readJsonFile(path: string): Promise<Json | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Json;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Zapis pliku tylko przy zmianie treści (idempotencja: drugi przebieg nie dotyka plików ani czasów modyfikacji), przez plik tymczasowy. */
async function writeIfChanged(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const current = await readFile(path);
    if (Buffer.compare(current, Buffer.from(bytes)) === 0) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return true;
}

export async function runPipeline(params: PipelineParams): Promise<PipelineResult> {
  assertNarrationPathsClassified(); // fail-closed: schemat treści a lista pól z audio muszą się zgadzać, zanim cokolwiek trafi do publicznego magazynu
  const modulePath = join(params.moduleDir, 'module.json');
  const lockPath = join(params.moduleDir, 'audio.lock.json');
  const raw = await readJsonFile(modulePath);
  if (!raw) throw new Error(`Brak pliku ${modulePath}.`);
  // 1. Walidacja PRZED czymkolwiek innym: zły moduł nie zużyje budżetu ani nie trafi do magazynu.
  content.parseModule(raw);
  const slug = String(raw.slug);
  // Klucze audio i manifest powstają ze sluga z modułu: musi to być moduł z tego katalogu, inaczej zapis trafiłby do przestrzeni innego modułu.
  if (slug !== basename(resolve(params.moduleDir))) throw new Error(`Slug w module.json ("${slug}") różni się od nazwy katalogu modułu.`);
  const refs = collectNarrations(raw);
  const lock = (await readJsonFile(lockPath)) as Lock | null;

  if (params.check) return checkOffline(refs, lock, params);

  // Dry-run bez kluczy nie zna głosu z .env.local: bierze go z lockfile (ten sam skrót co przy generowaniu).
  const voiceId = params.voiceId || (params.dryRun ? lock?.voiceId ?? '' : '');
  if (!params.dryRun && !voiceId) throw new Error('Brak ELEVENLABS_VOICE_ID: nie da się policzyć skrótów nagrań.');
  const hashOf = (text: string) => narrationHash({ text, model: params.model, language: params.language, voiceId });
  const only = params.only && params.only.length > 0 ? new Set(params.only) : null;
  const selected = refs.filter((ref) => !only || only.has(ref.blockId));
  if (only) {
    const unknown = [...only].filter((blockId) => !refs.some((ref) => ref.blockId === blockId));
    if (unknown.length > 0) throw new Error(`--only: brak narracji w blokach: ${unknown.join(', ')}.`);
  }
  for (const ref of selected) {
    ref.key = audioKey({ slug, version: params.version, blockId: ref.blockId, hash: hashOf(ref.text) });
  }
  // --only dopisuje do istniejącej partii: wpisy niewybranych narracji zostają ze starego locka, więc parametry partii muszą się zgadzać.
  if (only && lock && !params.dryRun) {
    const same = lock.audioVersion === params.version && lock.model === params.model && lock.language === params.language && lock.voiceId === voiceId;
    if (!same) throw new Error('--only wymaga tej samej wersji partii, modelu, języka i głosu co audio.lock.json; zmiana któregoś wymaga pełnego przebiegu (bez --only).');
  }

  if (lock && lock.audioVersion !== params.version) {
    say(params.output, `Uwaga: moduł ma już audio w wersji partii "${lock.audioVersion}", generujesz "${params.version}" (stare pliki zostają w magazynie: starsze wersje kursu na nie wskazują).`);
  }

  // 2. Które nagrania już są. Dry-run NIE dotyka magazynu ani sieci: za "istniejące" uznaje te, na które moduł już wskazuje (audioUrl + czasy).
  const cachedIds = new Set<string>();
  const sidecars = new Map<string, Sidecar>();
  for (const ref of selected) {
    if (params.dryRun) {
      const current = ref.holder;
      if (current.audioUrl === ref.key && typeof current.durationMs === 'number' && Array.isArray(current.cues)) cachedIds.add(ref.id);
      continue;
    }
    const audio = await params.store.head(ref.key);
    const sidecarBytes = audio ? await params.store.get(sidecarKey(ref.key)) : null;
    const sidecar = sidecarBytes ? parseSidecar(sidecarBytes, ref.key, voiceId) : null;
    if (audio && sidecar) {
      sidecars.set(ref.id, sidecar);
      cachedIds.add(ref.id);
    }
  }

  // Narracje o identycznym tekście w jednym bloku dzielą klucz (ten sam plik): planujemy, liczymy i generujemy je raz.
  const firstOfKey = new Set<string>();
  const unique = selected.filter((ref) => !firstOfKey.has(ref.key) && firstOfKey.add(ref.key));
  const planned: PlannedNarration[] = unique.map((ref) => ({ blockId: ref.blockId, text: ref.text, cached: cachedIds.has(ref.id) }));
  const summary = summarizePlan(planned);
  say(params.output, formatPlan(summary));
  if (params.dryRun) {
    say(params.output, '(--dry-run: bez sieci i bez zapisów; „istniejące” = moduł już wskazuje na to nagranie)');
    return { generated: 0, cached: summary.cached, chars: summary.chars, problems: [] };
  }

  // 3. Limit znaków i potwierdzenie PRZED pierwszym wywołaniem ElevenLabs.
  enforceMaxChars(summary, params.maxChars);
  if (summary.toGenerate > 0) {
    if (!params.tts) throw new Error('Brak dostawcy TTS (klucz ElevenLabs) do wygenerowania brakujących nagrań.');
    const ok = await confirm('Kontynuować?', { yes: params.yes, input: params.input, output: params.output });
    if (!ok) throw new Error('Przerwano: brak potwierdzenia (nic nie wygenerowano).');
  }

  // 4. Generowanie (kolejno). Błąd przerywa przebieg BEZ zmiany module.json; wygenerowane pliki zostają i drugi przebieg ich nie powtórzy.
  let generated = 0;
  let index = 0;
  for (const ref of unique) {
    index += 1;
    if (cachedIds.has(ref.id)) continue;
    say(params.output, `[${index}/${unique.length}] ${ref.id}: ${ref.text.length} znaków -> ${ref.key}`);
    let result;
    try {
      result = await params.tts!.synthesize({ text: ref.text, voiceId, model: params.model, language: params.language });
    } catch (error) {
      throw new Error(`Blok "${ref.blockId}" (${ref.id}): ${(error as Error).message}`);
    }
    let cues;
    try {
      cues = alignmentToCues(ref.text, result.alignment);
    } catch (error) {
      throw new Error(`Blok "${ref.blockId}" (${ref.id}): napisy z timestampów: ${(error as Error).message}`);
    }
    const sidecar: Sidecar = {
      hash: hashFromKey(ref.key),
      model: params.model,
      language: params.language,
      voiceId,
      bytes: result.audio.byteLength,
      durationMs: cues.durationMs,
      cues: cues.cues,
    };
    // Para nagranie + sidecar musi być spójna: gdy któryś z plików istniał (przerwany przebieg, uszkodzony sidecar), zastępujemy OBA nowym wynikiem.
    const stale = (await params.store.head(ref.key)) !== null || (await params.store.head(sidecarKey(ref.key))) !== null;
    if (stale) say(params.output, '  (niepełna para nagranie + sidecar: zastępuję ją spójnym wynikiem)');
    await params.store.put(ref.key, result.audio, { contentType: AUDIO_CONTENT_TYPE, cacheControl: IMMUTABLE_CACHE }, stale);
    await params.store.put(sidecarKey(ref.key), encode(sidecar), { contentType: JSON_CONTENT_TYPE, cacheControl: IMMUTABLE_CACHE }, stale);
    sidecars.set(ref.id, sidecar);
    generated += 1;
  }
  // Duplikaty (ten sam klucz) dostają wynik pierwszej narracji.
  const byKey = new Map(unique.map((ref) => [ref.key, sidecars.get(ref.id)!] as const));

  // 5. Wpis wyników do modułu (walidowany PRZED zapisem), lockfile i manifest.
  for (const ref of selected) {
    const sidecar = byKey.get(ref.key)!;
    sidecars.set(ref.id, sidecar);
    ref.holder.audioUrl = ref.key;
    ref.holder.durationMs = sidecar.durationMs;
    ref.holder.cues = sidecar.cues;
  }
  content.parseModule(raw);
  const entries: Record<string, LockEntry> = only && lock ? { ...lock.entries } : {};
  for (const ref of selected) {
    entries[ref.id] = { hash: hashFromKey(ref.key), key: ref.key, textSha: textSha(ref.text), durationMs: sidecars.get(ref.id)!.durationMs };
  }
  const nextLock: Lock = { lockVersion: 1, slug, audioVersion: params.version, model: params.model, language: params.language, voiceId, entries };
  const moduleChanged = await writeIfChanged(modulePath, encode(raw));
  const lockChanged = await writeIfChanged(lockPath, encode(nextLock));

  // Manifest jest PUBLICZNY: bez ścieżek pól (mapowanie narracja -> plik trzyma tylko module.json i audio.lock.json w repo). Tylko klucze
  // plików (blockId i skrót są w nazwie), posortowane, żeby dwa przebiegi dawały identyczny plik.
  const files = [...new Set(Object.values(entries).map((entry) => entry.key))].sort();
  const manifest = { manifestVersion: 1, slug, audioVersion: params.version, model: params.model, language: params.language, voiceId, files };
  const manifestBytes = encode(manifest);
  const existing = await params.store.get(manifestKey(slug, params.version));
  if (!existing || Buffer.compare(Buffer.from(existing), Buffer.from(manifestBytes)) !== 0) {
    await params.store.put(manifestKey(slug, params.version), manifestBytes, { contentType: JSON_CONTENT_TYPE, cacheControl: MUTABLE_CACHE }, true);
  }
  say(params.output, `Gotowe: wygenerowano ${generated}, istniejących ${summary.cached}. module.json ${moduleChanged ? 'zaktualizowany' : 'bez zmian'}, audio.lock.json ${lockChanged ? 'zaktualizowany' : 'bez zmian'}.`);
  return { generated, cached: summary.cached, chars: summary.chars, problems: [] };
}

/** --check: OFFLINE (bez magazynu, kluczy i sieci). Sprawdza, że każda narracja ma nagranie zgodne z JEJ AKTUALNYM tekstem (skrót z lockfile). */
function checkOffline(refs: NarrationRef[], lock: Lock | null, params: PipelineParams): PipelineResult {
  const problems: string[] = [];
  if (!lock) {
    problems.push('Brak audio.lock.json: uruchom generowanie audio dla modułu.');
  } else {
    for (const ref of refs) {
      const entry = lock.entries[ref.id];
      if (!entry) {
        problems.push(`${ref.id}: brak nagrania w audio.lock.json.`);
        continue;
      }
      const expected = narrationHash({ text: ref.text, model: lock.model, language: lock.language, voiceId: lock.voiceId });
      if (entry.hash !== expected || entry.textSha !== textSha(ref.text)) {
        problems.push(`${ref.id}: tekst narracji zmieniony od ostatniego generowania (nagranie nieaktualne).`);
        continue;
      }
      const holder = ref.holder;
      if (holder.audioUrl !== entry.key || holder.durationMs !== entry.durationMs || !Array.isArray(holder.cues)) {
        problems.push(`${ref.id}: audioUrl/durationMs/cues w module.json nie zgadzają się z audio.lock.json.`);
      }
    }
    const known = new Set(refs.map((ref) => ref.id));
    for (const id of Object.keys(lock.entries)) if (!known.has(id)) problems.push(`${id}: wpis w audio.lock.json bez narracji w module (usuń albo wygeneruj ponownie).`);
  }
  for (const problem of problems) say(params.output, `BŁĄD: ${problem}`);
  if (problems.length === 0) say(params.output, `OK: ${refs.length} narracji ma aktualne nagrania (sprawdzono offline).`);
  return { generated: 0, cached: refs.length - problems.length, chars: 0, problems };
}
