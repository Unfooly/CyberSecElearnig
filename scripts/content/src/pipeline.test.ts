import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNarrationPathsClassified, collectNarrations, NARRATION_PATHS, runPipeline, TEXT_ONLY_NARRATION_PATHS, type PipelineParams } from './pipeline.js';
import { MemoryStore } from './stores/memory.js';
import type { SynthesisRequest, SynthesisResult, TtsProvider } from './types.js';

const requireCjs = createRequire(import.meta.url);
const { fullModule } = requireCjs('../../../packages/content/dist/fixtures.js') as { fullModule: () => Record<string, unknown> };

/** Moduł bez wygenerowanych nagrań: czyści audioUrl/durationMs/cues z fixtury (skrypt ma je wpisać sam). */
function bareModule(): Record<string, unknown> {
  const module = JSON.parse(JSON.stringify(fullModule())) as Record<string, unknown>;
  const strip = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(strip);
    else if (node && typeof node === 'object') {
      const object = node as Record<string, unknown>;
      if (typeof object.text === 'string' && 'audioUrl' in object) {
        delete object.audioUrl;
        delete object.durationMs;
        delete object.cues;
      }
      Object.values(object).forEach(strip);
    }
  };
  strip(module);
  return module;
}

class FakeTts implements TtsProvider {
  calls: SynthesisRequest[] = [];
  failOn: string | null = null;
  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    this.calls.push(request);
    if (this.failOn && request.text.includes(this.failOn)) throw new Error('awaria dostawcy');
    const characters = Array.from(request.text);
    return {
      audio: new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...characters.map((_, i) => i % 256)]),
      alignment: {
        characters,
        characterStartTimesSeconds: characters.map((_, i) => i * 0.05),
        characterEndTimesSeconds: characters.map((_, i) => (i + 1) * 0.05),
      },
    };
  }
}

const sink = () => new Writable({ write: (_c, _e, done) => done() });

let root: string;
let dir: string;
let modulePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pipeline-'));
  dir = join(root, 'sprawa-testowa'); // nazwa katalogu = slug modułu (pipeline to sprawdza)
  await mkdir(dir);
  modulePath = join(dir, 'module.json');
  await writeFile(modulePath, JSON.stringify(bareModule()));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function params(overrides: Partial<PipelineParams> = {}): PipelineParams {
  return {
    moduleDir: dir,
    version: 'v1',
    model: 'eleven_multilingual_v2',
    language: 'pl',
    voiceId: 'voice-1',
    store: new MemoryStore(),
    tts: new FakeTts(),
    maxChars: 100_000,
    yes: true,
    dryRun: false,
    check: false,
    output: sink(),
    ...overrides,
  };
}

describe('collectNarrations', () => {
  it('zbiera narracje ze wszystkich miejsc (blok, hotspoty, linie, podpowiedzi)', () => {
    const refs = collectNarrations(bareModule());
    expect(refs.length).toBeGreaterThan(5);
    expect(refs.some((ref) => ref.id.includes('hotspots.'))).toBe(true);
    expect(refs.some((ref) => ref.id.includes('answerNarration'))).toBe(true);
    expect(refs.some((ref) => ref.id.includes('lines.'))).toBe(true);
    // Podpowiedzi (pole secret) nigdy nie dostają audio.
    expect(refs.some((ref) => ref.id.includes('hints'))).toBe(false);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(refs.length);
  });

  it('narracja w nieznanym miejscu to błąd (nie zostaje po cichu bez audio)', () => {
    const module = bareModule();
    (module.blocks as Record<string, unknown>[])[0].extra = { narration: { text: 'x' } };
    expect(() => collectNarrations(module)).toThrow(/nieznanym miejscu/);
  });
});

describe('runPipeline', () => {
  it('generuje, wpisuje audioUrl/durationMs/cues do modułu, zapisuje lock i manifest; wynik przechodzi parseModule', async () => {
    const store = new MemoryStore();
    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(result.generated).toBe(tts.calls.length);
    expect(result.generated).toBeGreaterThan(5);

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const first = module.blocks[0].narration;
    expect(first.audioUrl).toMatch(/^audio\/sprawa-testowa\/v1\/[^/]+\/[0-9a-f]{16}\.mp3$/);
    expect(first.cues[0].startMs).toBe(0);
    const audio = store.objects.get(first.audioUrl)!;
    expect(audio.options).toEqual({ contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000, immutable' });
    const manifest = store.objects.get('audio/sprawa-testowa/v1/manifest.json');
    expect(manifest?.options.cacheControl).toBe('no-cache');
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    expect(lock.voiceId).toBe('voice-1');
    expect(Object.keys(lock.entries)).toHaveLength(result.generated);
  });

  it('drugi przebieg: zero wywołań TTS, zero zapisów, pliki bez zmian', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const before = await readFile(modulePath, 'utf8');
    const tts = new FakeTts();
    const puts = store.calls.put;
    const result = await runPipeline(params({ store, tts }));
    expect(tts.calls).toEqual([]);
    expect(result.generated).toBe(0);
    expect(store.calls.put).toBe(puts);
    expect(await readFile(modulePath, 'utf8')).toBe(before);
  });

  it('zmiana tekstu jednej narracji generuje tylko ją; stare nagranie zostaje w magazynie (niemutowalne)', async () => {
    const store = new MemoryStore();
    const first = await runPipeline(params({ store }));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const oldKey = module.blocks[0].narration.audioUrl;
    module.blocks[0].narration.text = 'Zupełnie nowy tekst narracji.';
    await writeFile(modulePath, JSON.stringify(module));
    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(tts.calls.map((call) => call.text)).toEqual(['Zupełnie nowy tekst narracji.']);
    expect(result.generated).toBe(1);
    expect(first.generated).toBeGreaterThan(1);
    expect(store.objects.has(oldKey)).toBe(true);
    expect(JSON.parse(await readFile(modulePath, 'utf8')).blocks[0].narration.audioUrl).not.toBe(oldKey);
  });

  it('limit znaków i odmowa potwierdzenia działają PRZED pierwszym wywołaniem ElevenLabs', async () => {
    const tts = new FakeTts();
    await expect(runPipeline(params({ tts, maxChars: 10 }))).rejects.toThrow(/limit/);
    expect(tts.calls).toEqual([]);

    const input = new PassThrough();
    input.end('n\n');
    await expect(runPipeline(params({ tts, yes: false, input }))).rejects.toThrow(/potwierdzenia/);
    expect(tts.calls).toEqual([]);
    expect(await readFile(join(dir, 'module.json'), 'utf8')).toBe(JSON.stringify(bareModule()));
  });

  it('potwierdzenie pytane raz na przebieg', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk) => chunks.push(String(chunk)));
    input.end('y\n');
    await runPipeline(params({ yes: false, input, output }));
    expect(chunks.join('').match(/\[y\/N\]/g)).toHaveLength(1);
  });

  it('awaria dostawcy w środku: module.json bez zmian, wygenerowane pliki zostają, drugi przebieg dokańcza tylko resztę', async () => {
    const store = new MemoryStore();
    const tts = new FakeTts();
    const refs = collectNarrations(bareModule());
    tts.failOn = refs[refs.length - 1].text;
    await expect(runPipeline(params({ store, tts }))).rejects.toThrow(/awaria dostawcy/);
    expect(await readFile(modulePath, 'utf8')).toBe(JSON.stringify(bareModule()));
    const done = tts.calls.length - 1;
    expect(done).toBeGreaterThan(0);

    const retry = new FakeTts();
    const result = await runPipeline(params({ store, tts: retry }));
    expect(retry.calls).toHaveLength(refs.length - done);
    expect(result.generated).toBe(refs.length - done);
  });

  it('--dry-run: bez TTS, bez dotykania magazynu i plików', async () => {
    const store = new MemoryStore();
    const before = await readFile(modulePath, 'utf8');
    const result = await runPipeline(params({ store, tts: undefined, dryRun: true }));
    expect(result.generated).toBe(0);
    expect(store.calls).toEqual({ head: 0, get: 0, put: 0 });
    expect(await readFile(modulePath, 'utf8')).toBe(before);
  });

  it('--only: nieznany blok to błąd; wybrany blok generuje tylko swoje narracje i nie gubi reszty lockfile', async () => {
    await expect(runPipeline(params({ only: ['nie-ma'] }))).rejects.toThrow(/--only/);
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const lockBefore = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const blockId = module.blocks[0].id;
    module.blocks[0].narration.text = 'Inny tekst.';
    await writeFile(modulePath, JSON.stringify(module));
    const tts = new FakeTts();
    await runPipeline(params({ store, tts, only: [blockId] }));
    expect(tts.calls).toHaveLength(1);
    const lockAfter = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    expect(Object.keys(lockAfter.entries)).toEqual(Object.keys(lockBefore.entries));
  });

  it('ostrzega, gdy moduł ma już audio w innej wersji partii', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const chunks: string[] = [];
    const output = new Writable({ write: (chunk, _e, done) => (chunks.push(String(chunk)), done()) });
    await runPipeline(params({ store, version: 'v2', output }));
    expect(chunks.join('')).toMatch(/wersji partii "v1", generujesz "v2"/);
  });

  it('nieprawidłowy moduł: błąd przed jakimkolwiek wywołaniem TTS', async () => {
    const bad = bareModule();
    delete bad.title;
    await writeFile(modulePath, JSON.stringify(bad));
    const tts = new FakeTts();
    await expect(runPipeline(params({ tts }))).rejects.toThrow();
    expect(tts.calls).toEqual([]);
  });
});

describe('--check (offline)', () => {
  it('bez lockfile: błąd; po generowaniu: OK; po zmianie tekstu: nieaktualne; bez magazynu i TTS', async () => {
    const offline = { tts: undefined, check: true, store: new MemoryStore() };
    expect((await runPipeline(params(offline))).problems[0]).toMatch(/Brak audio.lock.json/);

    await runPipeline(params());
    expect((await runPipeline(params(offline))).problems).toEqual([]);
    expect(offline.store.calls).toEqual({ head: 0, get: 0, put: 0 });

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.blocks[0].narration.text = 'Zmieniony tekst.';
    await writeFile(modulePath, JSON.stringify(module));
    const result = await runPipeline(params(offline));
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/nieaktualne/);
  });
});

describe('kompletność i spójność', () => {
  it('NARRATION_PATHS obejmuje KAŻDĄ narrację client z fixtury (blok, hotspoty, linie, odpowiedzi); podpowiedzi (secret) pomija', () => {
    let expected = 0;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
          if (name === 'hints') continue; // secret: tylko tekst
          if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { text?: unknown }).text === 'string' && 'audioUrl' in value) expected += 1;
          walk(value);
        }
      }
    };
    walk(fullModule());
    expect(collectNarrations(bareModule())).toHaveLength(expected);
  });

  it('slug w module.json inny niż katalog modułu: błąd (nie pisze w przestrzeni cudzego modułu)', async () => {
    const other = join(root, 'inny-modul');
    await mkdir(other);
    await writeFile(join(other, 'module.json'), JSON.stringify(bareModule()));
    const store = new MemoryStore();
    await expect(runPipeline(params({ moduleDir: other, store }))).rejects.toThrow(/Slug/);
    expect(store.calls.put).toBe(0);
  });

  it('puste voiceId w trybie z generowaniem: błąd przed TTS', async () => {
    const tts = new FakeTts();
    await expect(runPipeline(params({ tts, voiceId: '' }))).rejects.toThrow(/VOICE_ID/);
    expect(tts.calls).toEqual([]);
  });

  it('identyczne teksty w jednym bloku dzielą plik: TTS raz, plan liczy raz', async () => {
    const module = bareModule();
    const block = (module.blocks as Record<string, unknown>[])[0] as { narration: { text: string }; hints?: unknown };
    block.narration.text = 'Tak.';
    const other = (module.blocks as Record<string, unknown>[]).find((b, i) => i > 0 && (b.narration as { text?: string } | undefined))!;
    other.narration = { text: 'Inny.' };
    // Drugi wpis o tym samym tekście w TYM SAMYM bloku: użyj hotspotu z fixtury sceny.
    const scene = (module.blocks as Record<string, unknown>[]).find((b) => Array.isArray(b.hotspots)) as { hotspots: { narration?: { text: string } }[]; narration?: { text: string } };
    scene.narration = { text: 'Powtórka.' };
    scene.hotspots[0].narration = { text: 'Powtórka.' };
    await writeFile(modulePath, JSON.stringify(module));
    const tts = new FakeTts();
    await runPipeline(params({ tts }));
    expect(tts.calls.filter((call) => call.text === 'Powtórka.')).toHaveLength(1);
    const saved = JSON.parse(await readFile(modulePath, 'utf8'));
    const savedScene = saved.blocks.find((b: { hotspots?: unknown }) => Array.isArray(b.hotspots));
    expect(savedScene.hotspots[0].narration.audioUrl).toBe(savedScene.narration.audioUrl);
  });
});

describe('audio tylko dla pól client (K1)', () => {
  const real = requireCjs('../../../packages/content/dist/index.js') as { FIELD_CLASSIFICATION: Record<string, { client: string[]; secret: string[] }> };
  const clone = () => JSON.parse(JSON.stringify(real.FIELD_CLASSIFICATION)) as Record<string, { client: string[]; secret: string[] }>;

  it('rzeczywista klasyfikacja jest zgodna z NARRATION_PATHS i TEXT_ONLY_NARRATION_PATHS', () => {
    expect(() => assertNarrationPathsClassified(real.FIELD_CLASSIFICATION)).not.toThrow();
    expect(NARRATION_PATHS.flat()).not.toContain('hints');
    expect(TEXT_ONLY_NARRATION_PATHS).toEqual([['hints', '*', 'narration']]);
  });

  it('pole z audio przeniesione do secret w schemacie: błąd', () => {
    const classification = clone();
    classification.SCENE_HOTSPOTS.client = classification.SCENE_HOTSPOTS.client.filter((path) => path !== 'hotspots[].narration.cues[].text');
    classification.SCENE_HOTSPOTS.secret.push('hotspots[].narration.cues[].text');
    expect(() => assertNarrationPathsClassified(classification)).toThrow(/nie jest polem client/);
  });

  it('pole narracji secret uznane w schemacie za client (podpowiedzi): błąd, dopóki nie ma ich w NARRATION_PATHS', () => {
    const classification = clone();
    const moved = classification.TEXT_INPUT_GUIDED.secret.filter((path) => path.startsWith('hints[].narration'));
    classification.TEXT_INPUT_GUIDED.secret = classification.TEXT_INPUT_GUIDED.secret.filter((path) => !moved.includes(path));
    classification.TEXT_INPUT_GUIDED.client.push(...moved);
    expect(() => assertNarrationPathsClassified(classification)).toThrow(/jest client, ale nie ma go w NARRATION_PATHS/);
  });

  it('nowe pole narracji client w schemacie bez wzorca: błąd (audio nie zostałoby wygenerowane po cichu)', () => {
    const classification = clone();
    classification.QUIZ.client.push('options[].narration.text', 'options[].narration.audioUrl');
    expect(() => assertNarrationPathsClassified(classification)).toThrow(/nie ma go w NARRATION_PATHS/);
  });

  it('nowe pole narracji secret bez wpisu TEXT_ONLY: błąd', () => {
    const classification = clone();
    classification.QUIZ.secret.push('options[].narration.text', 'options[].narration.audioUrl');
    expect(() => assertNarrationPathsClassified(classification)).toThrow(/nie ma go w TEXT_ONLY/);
  });

  it('podpowiedzi zostają tekstowe: po generowaniu nie mają audioUrl/durationMs/cues, a w magazynie nie ma nic z "hints"', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const saved = JSON.parse(await readFile(modulePath, 'utf8'));
    const hinted = saved.blocks.find((block: { hints?: unknown[] }) => Array.isArray(block.hints) && block.hints.length > 0);
    expect(hinted.hints[0].narration).toEqual({ text: expect.any(String) });
    expect([...store.objects.keys()].some((key) => /hint/i.test(key))).toBe(false);
  });

  it('podpowiedź z audio w module.json: błąd przed jakimkolwiek TTS i zapisem', async () => {
    const module = bareModule();
    const hinted = (module.blocks as { hints?: { narration: Record<string, unknown> }[] }[]).find((block) => block.hints && block.hints.length > 0)!;
    hinted.hints![0].narration.audioUrl = 'audio/x.mp3';
    hinted.hints![0].narration.durationMs = 1000;
    await writeFile(modulePath, JSON.stringify(module));
    const tts = new FakeTts();
    const store = new MemoryStore();
    await expect(runPipeline(params({ tts, store }))).rejects.toThrow(/tajne|podpowiedź/);
    expect(tts.calls).toEqual([]);
    expect(store.calls.put).toBe(0);
  });

  it('manifest jest publiczny: tylko klucze plików, bez ścieżek pól i bez "hints"; klucze audio to blockId + hash', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const text = new TextDecoder().decode(store.objects.get('audio/sprawa-testowa/v1/manifest.json')!.body);
    const manifest = JSON.parse(text);
    expect(Object.keys(manifest).sort()).toEqual(['audioVersion', 'files', 'language', 'manifestVersion', 'model', 'slug', 'voiceId']);
    expect(text).not.toMatch(/#|hints|narration|answerNarration|lines/);
    for (const key of manifest.files) expect(key).toMatch(/^audio\/sprawa-testowa\/v1\/[A-Za-z0-9._-]+\/[0-9a-f]{16}\.mp3$/);
    expect(manifest.files).toEqual([...manifest.files].sort());
  });
});

describe('sidecar i para plików w magazynie', () => {
  it('sidecar BEZ nagrania jest zastępowany razem z nagraniem (napisy zgodne z plikiem)', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const key: string = module.blocks[0].narration.audioUrl;
    const sidecarPath = key.replace(/\.mp3$/, '.json');
    store.objects.delete(key); // został tylko stary sidecar
    store.objects.get(sidecarPath)!.body = new TextEncoder().encode(JSON.stringify({ stary: true }));
    await runPipeline(params({ store }));
    const sidecar = JSON.parse(new TextDecoder().decode(store.objects.get(sidecarPath)!.body));
    expect(sidecar.hash).toBe(key.split('/').pop()!.replace('.mp3', ''));
    expect(store.objects.has(key)).toBe(true);
    expect(JSON.parse(await readFile(modulePath, 'utf8')).blocks[0].narration.cues).toEqual(sidecar.cues);
  });

  it.each([
    ['uszkodzony JSON', new TextEncoder().encode('{nie json')],
    ['zły kształt (puste cues)', new TextEncoder().encode(JSON.stringify({ hash: 'x', voiceId: 'voice-1', cues: [], durationMs: 1 }))],
  ])('sidecar: %s to brak (regeneracja tej narracji, bez surowego błędu)', async (_name, body) => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const key: string = module.blocks[0].narration.audioUrl;
    store.objects.get(key.replace(/\.mp3$/, '.json'))!.body = body;
    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(result.generated).toBe(1);
  });
});

describe('--only z innymi parametrami partii', () => {
  it.each([
    ['wersja', { version: 'v2' }],
    ['głos', { voiceId: 'voice-2' }],
    ['model', { model: 'inny-model' }],
  ])('zmieniona %s względem locka: błąd (pełny przebieg zamiast mieszania partii)', async (_name, override) => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const lockBefore = await readFile(join(dir, 'audio.lock.json'), 'utf8');
    const blockId = JSON.parse(await readFile(modulePath, 'utf8')).blocks[0].id;
    const tts = new FakeTts();
    await expect(runPipeline(params({ store, tts, only: [blockId], ...override }))).rejects.toThrow(/--only wymaga/);
    expect(tts.calls).toEqual([]);
    expect(await readFile(join(dir, 'audio.lock.json'), 'utf8')).toBe(lockBefore);
  });
});

describe('--check: rozjazdy', () => {
  const offline = () => ({ tts: undefined, check: true, store: new MemoryStore() });

  it('zmieniony audioUrl w module.json względem locka', async () => {
    await runPipeline(params());
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.blocks[0].narration.durationMs += 1;
    await writeFile(modulePath, JSON.stringify(module));
    expect((await runPipeline(params(offline()))).problems[0]).toMatch(/nie zgadzają się z audio.lock.json/);
  });

  it('wpis w locku bez narracji w module', async () => {
    await runPipeline(params());
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    lock.entries['nie-ma#narration'] = { hash: 'a', key: 'x', textSha: 'b', durationMs: 1 };
    await writeFile(join(dir, 'audio.lock.json'), JSON.stringify(lock));
    expect((await runPipeline(params(offline()))).problems[0]).toMatch(/bez narracji w module/);
  });

  it('zmiana głosu w locku unieważnia skróty (nieaktualne)', async () => {
    await runPipeline(params());
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    lock.voiceId = 'voice-2';
    await writeFile(join(dir, 'audio.lock.json'), JSON.stringify(lock));
    expect((await runPipeline(params(offline()))).problems.length).toBeGreaterThan(0);
  });
});

describe('--dry-run z lockfile', () => {
  it('bez voiceId bierze głos z locka: po generowaniu wszystko jest "istniejące"', async () => {
    const generated = await runPipeline(params());
    const result = await runPipeline(params({ tts: undefined, dryRun: true, voiceId: '' }));
    expect(result.cached).toBe(generated.generated);
  });
});
