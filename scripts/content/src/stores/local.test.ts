import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, DEFAULT_MAX_LOCAL_AUDIO_BYTES } from './local.js';
import { MemoryStore } from './memory.js';
import { assertSafeKey, IMMUTABLE_CACHE } from './key.js';

const bytes = (text: string) => new TextEncoder().encode(text);
const options = { contentType: 'audio/mpeg', cacheControl: IMMUTABLE_CACHE };

describe('assertSafeKey', () => {
  it.each(['audio/mod/v1/blok/0123456789abcdef.mp3', 'mod/scenes/office.a1b2c3d4.svg', 'a', 'a-b_c.d'])('przyjmuje %s', (key) => {
    expect(assertSafeKey(key)).toBe(key);
  });

  it.each(['con', 'NUL', 'audio/aux.mp3', 'a/COM1.json', 'lpt9.txt', 'a.', 'mod/plik.'])('odrzuca %j (nazwy urządzeń i końcowa kropka w Windows)', (key) => {
    expect(() => assertSafeKey(key)).toThrow(/Niepoprawny klucz/);
  });

  it.each(['console/x.svg', 'auxiliary.mp3', 'com/x', 'nulla'])('przyjmuje %j (przedrostek nazwy urządzenia to jeszcze nie nazwa urządzenia)', (key) => {
    expect(assertSafeKey(key)).toBe(key);
  });

  it.each(['', '/abs', 'a//b', 'a/', '../x', 'a/../b', 'a/./b', 'a\\b', 'a%2Fb', 'a b', 'a:b', '.hidden', 'a/.env', 'x'.repeat(301), 'audio/..%2f'])(
    'odrzuca %j (bez wyjścia poza katalog/bucket)',
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(/Niepoprawny klucz/);
    },
  );
});

describe('LocalStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'unfooly-content-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('zapis, odczyt i HEAD (rozmiar + md5); brak obiektu to null', async () => {
    const store = new LocalStore(root);
    const key = 'audio/mod/v1/blok/0123456789abcdef.mp3';
    expect(await store.get(key)).toBeNull();
    expect(await store.head(key)).toBeNull();

    expect(await store.put(key, bytes('ID3-audio'), options)).toBe(true);
    expect(new TextDecoder().decode((await store.get(key))!)).toBe('ID3-audio');
    expect(await store.head(key)).toEqual({ size: 9, md5: createHash('md5').update('ID3-audio').digest('hex') });
    // Katalogi pośrednie powstają same.
    expect(await readdir(join(root, 'audio', 'mod', 'v1', 'blok'))).toEqual(['0123456789abcdef.mp3']);
  });

  it('bez overwrite istniejący plik zostaje nietknięty (false); z overwrite jest atomowo zastępowany, bez plików tymczasowych', async () => {
    const store = new LocalStore(root);
    await store.put('mod/scene.svg', bytes('stary'), options);
    expect(await store.put('mod/scene.svg', bytes('nowy'), options)).toBe(false);
    expect(await readFile(join(root, 'mod', 'scene.svg'), 'utf8')).toBe('stary');

    expect(await store.put('mod/scene.svg', bytes('nowy'), options, true)).toBe(true);
    expect(await readFile(join(root, 'mod', 'scene.svg'), 'utf8')).toBe('nowy');
    expect(await readdir(join(root, 'mod'))).toEqual(['scene.svg']);
  });

  it.each(['../poza.mp3', 'a/../../poza', '/etc/passwd', 'a%2F..%2Fb', 'a\\..\\b'])('klucz %j nie wychodzi poza katalog (błąd, nic nie zapisano)', async (key) => {
    const store = new LocalStore(root);
    await expect(store.put(key, bytes('x'), options)).rejects.toThrow();
    await expect(store.get(key)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  describe('limit audio (tryb local, pliki w repo)', () => {
    it('domyślnie 30 MB', () => {
      expect(DEFAULT_MAX_LOCAL_AUDIO_BYTES).toBe(30 * 1024 * 1024);
    });

    it('zapis przekraczający limit to błąd i NIC nie trafia na dysk; zapis w limicie przechodzi', async () => {
      const store = new LocalStore(root, { maxAudioBytes: 100 });
      await store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.mp3', new Uint8Array(60), options);
      await expect(store.put('audio/m/v1/b/bbbbbbbbbbbbbbbb.mp3', new Uint8Array(50), options)).rejects.toThrow(/Limit audio/);
      expect(await store.get('audio/m/v1/b/bbbbbbbbbbbbbbbb.mp3')).toBeNull();
      await expect(readdir(join(root, 'audio', 'm', 'v1', 'b'))).rejects.toThrow(); // katalog nie powstał

      expect(await store.put('audio/m/v1/c/cccccccccccccccc.mp3', new Uint8Array(40), options)).toBe(true); // 60 + 40 = 100
    });

    it('do limitu liczą się tylko mp3 w audio/ (sidecary json i zasoby modułów nie)', async () => {
      const store = new LocalStore(root, { maxAudioBytes: 100 });
      await store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.json', new Uint8Array(500), options);
      await store.put('m/scenes/big.svg', new Uint8Array(500), options);
      expect(await store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.mp3', new Uint8Array(90), options)).toBe(true);
    });

    it('wielkość liter końcówki nie omija limitu (.MP3 też się liczy), a klucz spoza audio/ go nie dotyczy', async () => {
      const store = new LocalStore(root, { maxAudioBytes: 100 });
      await store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.MP3', new Uint8Array(90), options);
      await expect(store.put('audio/m/v1/b/bbbbbbbbbbbbbbbb.mp3', new Uint8Array(20), options)).rejects.toThrow(/Limit audio/);
      expect(await store.put('modules/x/duzy.mp3', new Uint8Array(500), options)).toBe(true); // poza prefiksem audio/
    });

    it('nieudane nadpisanie (rename) nie zostawia pliku tymczasowego', async () => {
      const store = new LocalStore(root);
      await mkdir(join(root, 'mod', 'scene.svg'), { recursive: true }); // katalog w miejscu pliku: rename musi się nie udać
      await expect(store.put('mod/scene.svg', bytes('x'), options, true)).rejects.toThrow();
      expect(await readdir(join(root, 'mod'))).toEqual(['scene.svg']);
    });

    it('nadpisanie pliku liczy tylko różnicę (zastępowany plik nie liczy się podwójnie)', async () => {
      const store = new LocalStore(root, { maxAudioBytes: 100 });
      await store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.mp3', new Uint8Array(80), options);
      expect(await store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.mp3', new Uint8Array(90), options, true)).toBe(true);
    });

    it('istniejące pliki spoza limitu (np. dodane ręcznie) też się liczą', async () => {
      await mkdir(join(root, 'audio', 'x'), { recursive: true });
      await writeFile(join(root, 'audio', 'x', 'stare.mp3'), new Uint8Array(95));
      const store = new LocalStore(root, { maxAudioBytes: 100 });
      await expect(store.put('audio/m/v1/a/aaaaaaaaaaaaaaaa.mp3', new Uint8Array(10), options)).rejects.toThrow(/Limit audio/);
    });
  });
});

describe('MemoryStore (fake do testów potoku)', () => {
  it('ta sama semantyka co magazyny prawdziwe: bez nadpisania, HEAD z md5, licznik wywołań', async () => {
    const store = new MemoryStore();
    expect(await store.head('a/b')).toBeNull();
    expect(await store.put('a/b', bytes('x'), options)).toBe(true);
    expect(await store.put('a/b', bytes('y'), options)).toBe(false);
    expect(new TextDecoder().decode((await store.get('a/b'))!)).toBe('x');
    expect(await store.put('a/b', bytes('y'), options, true)).toBe(true);
    expect((await store.head('a/b'))!.size).toBe(1);
    expect(store.calls).toEqual({ head: 2, get: 1, put: 3 });
    expect(store.objects.get('a/b')!.options).toEqual(options);
    await expect(store.put('../x', bytes('x'), options)).rejects.toThrow();
  });
});
