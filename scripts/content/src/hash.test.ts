import { describe, it, expect } from 'vitest';
import { assertBlockId, assertSlug, assertVersion, audioKey, contentHash, manifestKey, narrationHash, sidecarKey } from './hash.js';

const base = { text: 'Spójrz na adres nadawcy.', model: 'eleven_multilingual_v2', language: 'pl', voiceId: 'voice-1' };

describe('narrationHash', () => {
  it('deterministyczny, 16 znaków hex', () => {
    expect(narrationHash(base)).toBe(narrationHash({ ...base }));
    expect(narrationHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each([
    ['tekst', { text: 'Spójrz na adres nadawcy!' }],
    ['model', { model: 'eleven_turbo_v2_5' }],
    ['język', { language: 'en' }],
    ['głos', { voiceId: 'voice-2' }],
  ])('zmiana pola „%s” daje NOWY skrót (nowy plik zamiast nadpisania)', (_label, change) => {
    expect(narrationHash({ ...base, ...change })).not.toBe(narrationHash(base));
  });

  it('pola nie zlewają się przy sklejaniu (JSON zamiast separatora)', () => {
    expect(narrationHash({ text: 'a', model: 'bc', language: 'pl', voiceId: 'v' })).not.toBe(
      narrationHash({ text: 'ab', model: 'c', language: 'pl', voiceId: 'v' }),
    );
  });
});

describe('klucze obiektów', () => {
  const hash = narrationHash(base);

  it('audio: audio/<slug>/<wersja>/<blockId>/<hash>.mp3; sidecar i manifest obok', () => {
    const key = audioKey({ slug: 'sprawa-testowa', version: 'v1', blockId: 'adres', hash });
    expect(key).toBe(`audio/sprawa-testowa/v1/adres/${hash}.mp3`);
    expect(sidecarKey(key)).toBe(`audio/sprawa-testowa/v1/adres/${hash}.json`);
    expect(manifestKey('sprawa-testowa', 'v1')).toBe('audio/sprawa-testowa/v1/manifest.json');
  });

  it.each(['..', 'a/b', 'a\\b', '', '-x', 'a b', 'x'.repeat(65), 'a%2Fb', 'a:b'])('slug i blockId odrzucają "%s" (bez wyjścia poza prefiks)', (value) => {
    expect(() => assertSlug(value)).toThrow();
    expect(() => assertBlockId(value)).toThrow();
  });

  it.each(['constructor', 'toString', 'hasOwnProperty'])('blockId zastrzeżony jak w schemacie treści: %s', (value) => {
    expect(() => assertBlockId(value)).toThrow();
  });

  it.each(['audio', 'AUDIO', 'mascot'])('slug zastrzeżony: %s', (slug) => {
    expect(() => assertSlug(slug)).toThrow(/zastrzeżon/);
  });

  it.each(['..', 'v1/../x', 'v 1', '', '.v1'])('wersja odrzuca "%s"', (value) => {
    expect(() => assertVersion(value)).toThrow();
  });

  it('skrót w kluczu musi mieć 16 znaków hex; sidecar tylko dla .mp3', () => {
    expect(() => audioKey({ slug: 's', version: 'v1', blockId: 'b', hash: '../..' })).toThrow();
    expect(() => sidecarKey('audio/s/v1/b/x.wav')).toThrow();
  });
});

describe('contentHash', () => {
  it('skrót zawartości (zasoby): zależy od bajtów, domyślnie 8 znaków', () => {
    const a = contentHash(new TextEncoder().encode('<svg/>'));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash(new TextEncoder().encode('<svg />'))).not.toBe(a);
  });
});
