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
const { fullModule, fullModuleV6 } = requireCjs('../../../packages/content/dist/fixtures.js') as {
  fullModule: () => Record<string, unknown>;
  fullModuleV6: () => Record<string, unknown>;
};

/** Moduł bez wygenerowanych nagrań: czyści audioUrl/durationMs/cues z fixtury (skrypt ma je wpisać sam). */
function bareModule(source: () => Record<string, unknown> = fullModule): Record<string, unknown> {
  const module = JSON.parse(JSON.stringify(source())) as Record<string, unknown>;
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

// Głosy ról (voices.json, D-082) - kształt prawdziwych ID (placeholder byłby odrzucony przy generowaniu).
const VOICES = { narrator: 'voice-narrator', komisarz: 'voice-komisarz01', bank: 'voice-bank001', marek: 'voice-marek01' };

function params(overrides: Partial<PipelineParams> = {}): PipelineParams {
  return {
    moduleDir: dir,
    version: 'v1',
    model: 'eleven_multilingual_v2',
    language: 'pl',
    voices: VOICES,
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
    // BRIEFING (schemaVersion 5): narracja per krok odprawy, id jak `odprawa#steps.0.narration`; krok bez narracji nie ma wpisu.
    expect(refs.filter((ref) => ref.id.startsWith('odprawa#steps.')).map((ref) => ref.id)).toEqual([
      'odprawa#steps.0.narration',
      'odprawa#steps.1.narration',
      'odprawa#steps.3.narration',
      'odprawa#steps.4.narration',
      'odprawa#steps.5.narration',
    ]);
    // Podpowiedzi (pole secret) nigdy nie dostają audio.
    expect(refs.some((ref) => ref.id.includes('hints'))).toBe(false);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(refs.length);
  });

  it('narracja w nieznanym miejscu to błąd (nie zostaje po cichu bez audio)', () => {
    const module = bareModule();
    (module.blocks as Record<string, unknown>[])[0].extra = { narration: { text: 'x' } };
    expect(() => collectNarrations(module)).toThrow(/nieznanym miejscu/);
  });

  it('narracja wielojęzyczna (schemaVersion 6, D-114): nagranie pl w obiekcie pl, wspólna rola, klucz locka bez sufiksu języka', () => {
    const flat = collectNarrations(bareModule());
    const module = bareModule();
    const first = (module.blocks as Record<string, unknown>[])[0];
    const plBody = first.narration as Record<string, unknown>;
    first.narration = { voice: 'oszust', pl: plBody };
    const refs = collectNarrations(module);
    expect(refs.map((ref) => ref.id)).toEqual(flat.map((ref) => ref.id));
    expect(refs[0].holder).toBe(plBody);
    expect(refs[0].voice).toBe('oszust');
    expect(refs[0].text).toBe(plBody.text);
  });

  it('nagranie rozmowy (D-115): każdy segment osobną narracją głosem postaci; znacznik omówienia z narracją lektora', () => {
    const refs = collectNarrations(bareModule(fullModuleV6));
    expect(refs.filter((ref) => ref.blockId === 'nagranie' && ref.id.includes('segments.')).map((ref) => [ref.id, ref.voice])).toEqual([
      ['nagranie#segments.0.narration', 'oszust'],
      ['nagranie#segments.1.narration', 'karol'],
      ['nagranie#segments.2.narration', 'oszust'],
    ]);
    expect(refs.map((ref) => ref.id)).toContain('omowienie#markers.0.narration');
  });

  it('nagranie EN w narracji wielojęzycznej: czytelny błąd do czasu fazy EN (nie ciche pominięcie)', () => {
    const module = bareModule();
    const first = (module.blocks as Record<string, unknown>[])[0];
    first.narration = { pl: first.narration, en: { text: 'Opening.' } };
    expect(() => collectNarrations(module)).toThrow(/nagrania w języku en nie są jeszcze obsługiwane/);
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
    // lockVersion 2 (D-082): głos per wpis zamiast jednego głosu partii.
    expect(lock.lockVersion).toBe(2);
    expect(lock).not.toHaveProperty('voiceId');
    expect(lock.entries[`${module.blocks[0].id}#narration`]).toMatchObject({ voice: 'narrator', voiceId: 'voice-narrator' });
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
    // Zmienił się TYLKO wpis wybranej narracji (nowy skrót i nowy klucz); pozostałe wpisy są identyczne co do bajtu.
    const changedId = `${blockId}#narration`;
    expect(lockAfter.entries[changedId].hash).not.toBe(lockBefore.entries[changedId].hash);
    expect(lockAfter.entries[changedId].textSha).not.toBe(lockBefore.entries[changedId].textSha);
    expect(lockAfter.entries[changedId].key).not.toBe(lockBefore.entries[changedId].key);
    for (const id of Object.keys(lockBefore.entries).filter((entryId) => entryId !== changedId)) {
      expect(lockAfter.entries[id]).toEqual(lockBefore.entries[id]);
    }
    // Manifest po --only zawiera pełny zestaw plików (nowe nagranie + niezmienione), bez starego klucza wybranej narracji.
    const manifest = JSON.parse(new TextDecoder().decode(store.objects.get('audio/sprawa-testowa/v1/manifest.json')!.body));
    expect(manifest.files).toContain(lockAfter.entries[changedId].key);
    expect(manifest.files).not.toContain(lockBefore.entries[changedId].key);
    expect(manifest.files).toHaveLength(Object.keys(lockAfter.entries).length);
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

  it('placeholder zamiast ID głosu roli w voices.json: czytelny błąd PRZED TTS i zapisami (nazwa roli w komunikacie)', async () => {
    const tts = new FakeTts();
    const store = new MemoryStore();
    await expect(runPipeline(params({ tts, store, voices: { ...VOICES, komisarz: '<WKLEJ-ID-KOMISARZ>' } }))).rejects.toThrow(/rola "komisarz" ma placeholder/);
    expect(tts.calls).toEqual([]);
    expect(store.calls.put).toBe(0);
  });

  it('identyczne teksty w jednym bloku dzielą plik: TTS raz, plan i manifest liczą raz, lock ma osobne wpisy z tym samym kluczem', async () => {
    const baseline = new FakeTts();
    await runPipeline(params({ tts: baseline }));
    await writeFile(modulePath, JSON.stringify(bareModule()));
    await rm(join(dir, 'audio.lock.json'));

    // Scena: narracja bloku i narracja hotspotu o tym samym tekście (ten sam blockId, ten sam skrót = ten sam plik).
    const module = bareModule();
    const scene = (module.blocks as Record<string, unknown>[]).find((b) => Array.isArray(b.hotspots)) as {
      id: string;
      hotspots: { narration?: { text: string } }[];
      narration?: { text: string };
    };
    scene.narration = { text: 'Powtórka.' };
    scene.hotspots[0].narration = { text: 'Powtórka.' };
    await writeFile(modulePath, JSON.stringify(module));

    const store = new MemoryStore();
    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(tts.calls.filter((call) => call.text === 'Powtórka.')).toHaveLength(1);
    // Plan: duplikat liczony raz (znaki i liczba narracji do wygenerowania).
    expect(result.generated).toBe(tts.calls.length);
    expect(result.chars).toBe(tts.calls.reduce((sum, call) => sum + call.text.length, 0));

    const saved = JSON.parse(await readFile(modulePath, 'utf8'));
    const savedScene = saved.blocks.find((b: { hotspots?: unknown }) => Array.isArray(b.hotspots));
    expect(savedScene.hotspots[0].narration.audioUrl).toBe(savedScene.narration.audioUrl);

    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    const sceneEntries = Object.entries(lock.entries).filter(([id]) => id.startsWith(`${scene.id}#`)) as [string, { key: string }][];
    const sameKey = sceneEntries.filter(([, entry]) => entry.key === savedScene.narration.audioUrl);
    expect(sameKey.map(([id]) => id).sort()).toEqual([`${scene.id}#hotspots.0.narration`, `${scene.id}#narration`]);

    const manifest = JSON.parse(new TextDecoder().decode(store.objects.get('audio/sprawa-testowa/v1/manifest.json')!.body));
    expect(manifest.files.filter((key: string) => key === savedScene.narration.audioUrl)).toHaveLength(1);
    expect(new Set(manifest.files).size).toBe(manifest.files.length);
  });
});

describe('napisy z magazynu (sidecar) muszą odpowiadać tekstowi narracji', () => {
  async function tamper(mutate: (sidecar: { cues: { text: string; startMs: number }[] }) => void) {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const sidecarPath = String(module.blocks[0].narration.audioUrl).replace(/\.mp3$/, '.json');
    const stored = store.objects.get(sidecarPath)!;
    const sidecar = JSON.parse(new TextDecoder().decode(stored.body));
    mutate(sidecar);
    stored.body = new TextEncoder().encode(JSON.stringify(sidecar));
    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    return { tts, result, module: JSON.parse(await readFile(modulePath, 'utf8')), sidecarAfter: JSON.parse(new TextDecoder().decode(store.objects.get(sidecarPath)!.body)) };
  }

  it('podmieniony tekst napisu: sidecar odrzucony, narracja wygenerowana od nowa, do modułu nie trafia obcy tekst', async () => {
    const { tts, result, module } = await tamper((sidecar) => {
      sidecar.cues[0].text = 'Kliknij ten link natychmiast.';
    });
    expect(result.generated).toBe(1);
    expect(tts.calls).toHaveLength(1);
    expect(JSON.stringify(module)).not.toContain('Kliknij ten link natychmiast');
  });

  it('dopisany napis (dodatkowa treść): odrzucony', async () => {
    const { result } = await tamper((sidecar) => {
      sidecar.cues.push({ text: 'Dopisek.', startMs: sidecar.cues[sidecar.cues.length - 1].startMs });
    });
    expect(result.generated).toBe(1);
  });

  it('napisy nie rosnące albo po końcu nagrania: odrzucone', async () => {
    const negative = await tamper((sidecar) => {
      expect(sidecar.cues.length).toBeGreaterThan(1); // test ma sens tylko dla kilku napisów
      sidecar.cues[1].startMs = -1;
    });
    expect(negative.result.generated).toBe(1);
    const outOfOrder = await tamper((sidecar) => {
      sidecar.cues[0].startMs = 900;
      sidecar.cues[1].startMs = 300;
    });
    expect(outOfOrder.result.generated).toBe(1);
    const beyond = await tamper((sidecar) => {
      sidecar.cues[1].startMs = 9_999_999;
    });
    expect(beyond.result.generated).toBe(1);
  });

  it('pierwszy napis nie od 0 ms: odrzucony', async () => {
    const { result } = await tamper((sidecar) => {
      sidecar.cues[0].startMs = 100;
    });
    expect(result.generated).toBe(1);
  });

  it.each([
    ['dodatkowa spacja na brzegach', (text: string) => ` ${text}\n`],
    ['spacja w środku słowa (granica słowa)', (text: string) => `${text.slice(0, 3)} ${text.slice(3)}`],
    ['usunięta spacja między słowami', (text: string) => text.replace(' ', '')],
    ['niewidoczny znak (zero-width space, U+200B)', (text: string) => `${text}${String.fromCharCode(0x200b)}`],
    // Drugi argument replace poniżej to literalny NBSP (U+00A0), niewidoczny w przeglądzie: zamiana zwykłej spacji na spację niełamiącą.
    ['spacja niełamiąca zamiast zwykłej (NBSP, U+00A0)',(text: string) => text.replace(' ', ' ')],
  ])('sidecar różniący się od tekstu tylko odstępami albo znakami niewidocznymi (%s): odrzucony, tekst napisów liczy się lokalnie', async (_name, change) => {
    const { result, module } = await tamper((sidecar) => {
      sidecar.cues[0].text = change(sidecar.cues[0].text);
    });
    expect(result.generated).toBe(1);
    expect(module.blocks[0].narration.cues[0].text).toBe(`Narracja ${module.blocks[0].id}.`);
  });

  it('inny podział na zdania (granica przesunięta) przy tych samych literach: odrzucony', async () => {
    const { result } = await tamper((sidecar) => {
      const [first, second] = sidecar.cues;
      sidecar.cues = [{ text: `${first.text} ${second.text}`, startMs: 0 }];
    });
    expect(result.generated).toBe(1);
  });

  it('napis z pustym tekstem przy niezmienionej liczbie napisów: odrzucony', async () => {
    const { result } = await tamper((sidecar) => {
      sidecar.cues[0].text = '';
    });
    expect(result.generated).toBe(1);
  });

  it('durationMs ponad 30 minut: odrzucony (regeneracja), przebieg nie pada na parseModule', async () => {
    const { result } = await tamper((sidecar) => {
      (sidecar as unknown as { durationMs: number }).durationMs = 9_999_999_999;
      sidecar.cues[1].startMs = 9_999_999_998;
    });
    expect(result.generated).toBe(1);
  });

  it('wierny sidecar: cache trafiony bez TTS', async () => {
    const { tts, result } = await tamper(() => {});
    expect(result.generated).toBe(0);
    expect(tts.calls).toEqual([]);
  });
});

describe('guard i osierocone audio', () => {
  it('pole narracji o innej nazwie (np. introNarration) w nieznanym miejscu: błąd', () => {
    const module = bareModule();
    (module.blocks as Record<string, unknown>[])[0].intro = { introNarration: { text: 'x' } };
    expect(() => collectNarrations(module)).toThrow(/nieznanym miejscu/);
  });

  it('--check: narracja bez tekstu z audioUrl to OSTRZEŻENIE (nie błąd)', async () => {
    await runPipeline(params());
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.blocks[0].narration.text = '   ';
    await writeFile(modulePath, JSON.stringify(module));
    const chunks: string[] = [];
    const output = new Writable({ write: (chunk, _e, done) => (chunks.push(String(chunk)), done()) });
    const result = await runPipeline(params({ tts: undefined, check: true, store: new MemoryStore(), output }));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/osierocone/);
    expect(chunks.join('')).toContain('OSTRZEŻENIE:');
    // Lock nadal ma wpis tej narracji bez odpowiednika w module: to BŁĄD (w problems), a ostrzeżenie jest osobną informacją.
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems.every((problem) => !/osierocone/.test(problem))).toBe(true);
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
    expect(Object.keys(manifest).sort()).toEqual(['audioVersion', 'files', 'language', 'manifestVersion', 'model', 'slug', 'voices']);
    expect(manifest.voices).toEqual({ komisarz: ['voice-komisarz01'], narrator: ['voice-narrator'] });
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

  it('zmiana voiceId roli w voices.json: nieaktualne WYŁĄCZNIE nagrania tej roli, z rolą w komunikacie', async () => {
    await runPipeline(params());
    const result = await runPipeline(params({ ...offline(), voices: { ...VOICES, komisarz: 'voice-komisarz02' } }));
    expect(result.problems).toEqual([
      '[komisarz] odprawa#steps.1.narration: głos (rola lub ID w voices.json) zmieniony od ostatniego generowania (nagranie nieaktualne).',
    ]);
  });

  it('każda pozycja --check ma rolę głosu (brak nagrania i zmieniony tekst)', async () => {
    await runPipeline(params());
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    delete lock.entries['odprawa#steps.1.narration'];
    await writeFile(join(dir, 'audio.lock.json'), JSON.stringify(lock));
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.blocks[0].narration.text = 'Inny tekst.';
    await writeFile(modulePath, JSON.stringify(module));
    const result = await runPipeline(params(offline()));
    expect(result.problems).toEqual([
      `[narrator] ${module.blocks[0].id}#narration: tekst narracji zmieniony od ostatniego generowania (nagranie nieaktualne).`,
      '[komisarz] odprawa#steps.1.narration: brak nagrania w audio.lock.json.',
    ]);
  });

  it('placeholder roli w voices.json: --check zgłasza pozycje tej roli (nie da się ich sprawdzić)', async () => {
    await runPipeline(params());
    const result = await runPipeline(params({ ...offline(), voices: { ...VOICES, komisarz: 'TODO' } }));
    expect(result.problems).toEqual(['[komisarz] odprawa#steps.1.narration: rola głosu ma placeholder w voices.json (nie da się sprawdzić ani nagrać).']);
  });

  it('lock w wersji 1 (jeden głos partii) czytany jako narrator: nic nie jest nieaktualne, gdy głos narratora się zgadza', async () => {
    await runPipeline(params());
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    const narratorOnly = Object.fromEntries(
      Object.entries(lock.entries as Record<string, { voice: string; voiceId?: string }>)
        .filter(([, entry]) => entry.voice === 'narrator')
        .map(([id, entry]) => {
          const { voice: _voice, voiceId: _voiceId, ...rest } = entry;
          return [id, rest];
        }),
    );
    // Moduł bez narracji Fooli (jak przed D-082), lock w starym formacie z voiceId partii.
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    delete module.blocks.find((b: { id: string }) => b.id === 'odprawa').steps[1].narration;
    await writeFile(modulePath, JSON.stringify(module));
    await writeFile(join(dir, 'audio.lock.json'), JSON.stringify({ ...lock, lockVersion: 1, voiceId: 'voice-narrator', entries: narratorOnly }));
    expect((await runPipeline(params(offline()))).problems).toEqual([]);
  });
});

describe('lock w wersji 1 -> zapis w wersji 2 (D-082)', () => {
  // Stan jak w module 1 przed D-082: same narracje narratora, lock v1 z jednym voiceId partii.
  async function v1State(store: MemoryStore) {
    const module = bareModule();
    delete (module.blocks as Record<string, any>[]).find((b) => b.id === 'odprawa')!.steps[1].narration;
    await writeFile(modulePath, JSON.stringify(module));
    await runPipeline(params({ store }));
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    const entries = Object.fromEntries(
      Object.entries(lock.entries as Record<string, Record<string, unknown>>).map(([id, { voice: _v, voiceId: _i, ...rest }]) => [id, rest]),
    );
    const { voices: _manifestVoices, ...rest } = lock;
    await writeFile(join(dir, 'audio.lock.json'), JSON.stringify({ ...rest, lockVersion: 1, voiceId: 'voice-narrator', entries }));
    return JSON.parse(await readFile(modulePath, 'utf8')) as { blocks: { id: string }[] };
  }

  it('pełny przebieg: lockVersion 2, głos przy każdym wpisie, bez top-level voiceId i bez ponownego TTS narratora', async () => {
    const store = new MemoryStore();
    await v1State(store);
    const tts = new FakeTts();
    await runPipeline(params({ store, tts }));
    expect(tts.calls).toEqual([]);
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    expect(lock.lockVersion).toBe(2);
    expect(lock).not.toHaveProperty('voiceId');
    for (const entry of Object.values(lock.entries)) expect(entry).toMatchObject({ voice: 'narrator', voiceId: 'voice-narrator' });
  });

  it('--only na locku v1: wpisy niewybranych bloków dostają narratora i dawny voiceId partii', async () => {
    const store = new MemoryStore();
    const module = await v1State(store);
    const [first, second] = module.blocks.map((block) => block.id);
    await runPipeline(params({ store, only: [first] }));
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    expect(lock.lockVersion).toBe(2);
    expect(lock.entries[`${second}#narration`]).toMatchObject({ voice: 'narrator', voiceId: 'voice-narrator' });
  });

  it('nieznany lockVersion: jawny błąd zamiast zgadywania formatu', async () => {
    await runPipeline(params());
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    await writeFile(join(dir, 'audio.lock.json'), JSON.stringify({ ...lock, lockVersion: 3 }));
    await expect(runPipeline(params({ tts: undefined, check: true }))).rejects.toThrow(/nieznany lockVersion 3/);
  });
});

describe('głosy ról (voices.json, D-082)', () => {
  it('brak pola voice = narrator; voice z treści wybiera voiceId roli (TTS i skrót)', async () => {
    const tts = new FakeTts();
    await runPipeline(params({ tts }));
    const byText = (text: string) => tts.calls.find((call) => call.text === text)!;
    expect(byText('Narracja odprawa-jeden. Drugie zdanie.').voiceId).toBe('voice-komisarz01');
    expect(byText('Narracja odprawa-zero. Drugie zdanie.').voiceId).toBe('voice-narrator');
    const refs = collectNarrations(bareModule());
    expect(refs.find((ref) => ref.id === 'odprawa#steps.1.narration')!.voice).toBe('komisarz');
    expect(refs.find((ref) => ref.id === 'odprawa#steps.0.narration')!.voice).toBe('narrator');
  });

  it('ten sam tekst innym głosem to inny plik (voiceId w skrócie); pozostałe role bez ponownego TTS', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const before = JSON.parse(await readFile(modulePath, 'utf8')).blocks.find((b: { id: string }) => b.id === 'odprawa').steps[1].narration.audioUrl;
    const tts = new FakeTts();
    await runPipeline(params({ store, tts, voices: { ...VOICES, komisarz: 'voice-komisarz02' } }));
    const after = JSON.parse(await readFile(modulePath, 'utf8')).blocks.find((b: { id: string }) => b.id === 'odprawa').steps[1].narration.audioUrl;
    expect(after).not.toBe(before);
    expect(tts.calls.map((call) => call.voiceId)).toEqual(['voice-komisarz02']);
  });

  it('media audio hotspotu z narration (poczta głosowa) jest nagrywane potokiem z głosem roli', async () => {
    const module = bareModule();
    const scene = (module.blocks as Record<string, any>[]).find((b) => b.type === 'SCENE_HOTSPOTS')!;
    const telefon = scene.hotspots.find((h: Record<string, any>) => h.media?.kind === 'audio');
    telefon.media = { kind: 'audio', narration: { text: 'Dzień dobry, tu bank.', voice: 'bank' } };
    await writeFile(modulePath, JSON.stringify(module));
    const tts = new FakeTts();
    await runPipeline(params({ tts }));
    expect(tts.calls.find((call) => call.text === 'Dzień dobry, tu bank.')!.voiceId).toBe('voice-bank001');
    const saved = JSON.parse(await readFile(modulePath, 'utf8'));
    const media = saved.blocks.find((b: { type: string }) => b.type === 'SCENE_HOTSPOTS').hotspots.find((h: { id: string }) => h.id === telefon.id).media;
    expect(media.narration.audioUrl).toMatch(/\.mp3$/);
    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    expect(lock.entries[`${scene.id}#hotspots.${scene.hotspots.indexOf(telefon)}.media.narration`]).toMatchObject({ voice: 'bank' });
  });
});

describe('--dry-run z lockfile', () => {
  it('po generowaniu wszystko jest "istniejące" (głosy z voices.json, bez kluczy)', async () => {
    const generated = await runPipeline(params());
    const result = await runPipeline(params({ tts: undefined, dryRun: true }));
    expect(result.cached).toBe(generated.generated);
  });
});

describe('narration.spokenText (tekst do przeczytania różny od wyświetlanego)', () => {
  async function withSpokenText(spokenText: string): Promise<{ id: string }> {
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const narration = module.blocks[0].narration;
    narration.spokenText = spokenText;
    await writeFile(modulePath, JSON.stringify(module));
    return { id: module.blocks[0].id as string };
  }

  it('TTS i hash dostają spokenText, nie text; cues NIE trafiają do module.json (napisy zostają fallbackiem klienta z text)', async () => {
    await withSpokenText('dziewiąta zero zero');
    const tts = new FakeTts();
    const result = await runPipeline(params({ tts }));
    expect(result.generated).toBe(tts.calls.length);
    // Blok 0 (pierwszy zebrany, patrz collectNarrations) to pierwsze wywołanie TTS w nowym przebiegu.
    expect(tts.calls[0].text).toBe('dziewiąta zero zero');

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    const narration = module.blocks[0].narration;
    expect(narration.audioUrl).toMatch(/\.mp3$/);
    expect(typeof narration.durationMs).toBe('number');
    expect(narration.cues).toBeUndefined();
    expect(narration.text).toContain('Narracja'); // text wyświetlany bez zmian

    const lock = JSON.parse(await readFile(join(dir, 'audio.lock.json'), 'utf8'));
    const entryId = Object.keys(lock.entries).find((id) => id.startsWith(`${module.blocks[0].id}#narration`))!;
    expect(lock.entries[entryId].hash).toBe(narration.audioUrl.split('/').pop().replace('.mp3', ''));
  });

  it('drugi przebieg (bez zmian): zero wywołań TTS, cues zostają nieobecne (dry-run i realny przebieg zgadzają się co do "już wygenerowane")', async () => {
    await withSpokenText('dziewiąta zero zero');
    const store = new MemoryStore();
    await runPipeline(params({ store }));
    const dryRun = await runPipeline(params({ store, tts: undefined, dryRun: true }));
    expect(dryRun.cached).toBeGreaterThan(0);

    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(result.generated).toBe(0);
    expect(tts.calls).toEqual([]);
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    expect(module.blocks[0].narration.cues).toBeUndefined();
  });

  it('zmiana TYLKO text (wyświetlanego), bez zmiany spokenText: nagranie zostaje aktualne (--check OK, bez TTS)', async () => {
    await withSpokenText('dziewiąta zero zero');
    const store = new MemoryStore();
    await runPipeline(params({ store }));

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.blocks[0].narration.text = 'Spotkanie o 9:00, nie spóźnij się.';
    await writeFile(modulePath, JSON.stringify(module));

    const offlineStore = new MemoryStore();
    expect((await runPipeline(params({ tts: undefined, check: true, store: offlineStore }))).problems).toEqual([]);
    expect(offlineStore.calls).toEqual({ head: 0, get: 0, put: 0 });

    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(result.generated).toBe(0);
    expect(tts.calls).toEqual([]);
  });

  it('blok, który WCZEŚNIEJ miał prawdziwe cues (wygenerowane bez spokenText), traci je po dopisaniu spokenText - realne skasowanie, nie tylko pominięcie ustawienia', async () => {
    const store = new MemoryStore();
    await runPipeline(params({ store })); // bez spokenText: cues z prawdziwego alignmentu (patrz test wyżej w pliku)
    const before = JSON.parse(await readFile(modulePath, 'utf8'));
    expect(Array.isArray(before.blocks[0].narration.cues)).toBe(true);
    expect(before.blocks[0].narration.cues.length).toBeGreaterThan(0);

    await withSpokenText('dziewiąta zero zero'); // zmienia ttsInputOf -> nowy hash -> pełna regeneracja, nie trafienie w cache
    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(result.generated).toBeGreaterThan(0);

    const after = JSON.parse(await readFile(modulePath, 'utf8'));
    expect(after.blocks[0].narration.cues).toBeUndefined();
  });

  it('zmiana spokenText (text wyświetlany bez zmian): nagranie jest nieaktualne (--check wykrywa, drugi przebieg generuje od nowa)', async () => {
    await withSpokenText('dziewiąta zero zero');
    const store = new MemoryStore();
    await runPipeline(params({ store }));

    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.blocks[0].narration.spokenText = 'dziesiąta trzydzieści';
    await writeFile(modulePath, JSON.stringify(module));

    const checkResult = await runPipeline(params({ tts: undefined, check: true, store: new MemoryStore() }));
    expect(checkResult.problems).toHaveLength(1);
    expect(checkResult.problems[0]).toMatch(/nieaktualne/);

    const tts = new FakeTts();
    const result = await runPipeline(params({ store, tts }));
    expect(result.generated).toBe(1);
    expect(tts.calls[0].text).toBe('dziesiąta trzydzieści');
  });
});
