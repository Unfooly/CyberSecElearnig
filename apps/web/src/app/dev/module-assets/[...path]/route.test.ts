// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route.dev';

// Trasa dev harnessu (D-084, B-128): tylko z NEXT_PUBLIC_DEV_HARNESS=1, adres `/dev/module-assets/<slug>/<ścieżka>`, tylko obrazy z
// assets/ istniejącego modułu (plik źródłowy albo klucz z assets.lock.json), nic spoza katalogu. Next dekoduje segmenty przed
// wywołaniem (`%2e%2e` przychodzi jako `..`).
const get = (...path: string[]) => GET(new Request('http://localhost/dev/module-assets'), { params: { path } });
const M1 = 'wyludzone-haslo';

describe('GET /dev/module-assets/[...path]', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bez flagi harnessu: 404 nawet dla istniejącego pliku', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_HARNESS', '');
    expect((await get(M1, 'scenes', 'odprawa-biurko.svg')).status).toBe(404);
  });

  it('plik źródłowy i opublikowany klucz (assets.lock.json) -> obraz z bezpiecznymi nagłówkami', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_HARNESS', '1');
    const source = await get(M1, 'scenes', 'odprawa-biurko.svg');
    expect(source.status).toBe(200);
    expect(source.headers.get('content-type')).toBe('image/svg+xml');
    expect(source.headers.get('x-content-type-options')).toBe('nosniff');
    expect(source.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await source.text()).toMatch(/^<svg /);

    // Klucz bieżącej publikacji z locka (zmienia się przy każdej zmianie pliku), nie wpisany na sztywno.
    const lock = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'packages', 'content', 'modules', M1, 'assets.lock.json'), 'utf8'));
    const key: string = lock.entries['korytarz#image'].key;
    const published = await get(M1, ...key.split('/'));
    expect(published.status).toBe(200);
  });

  it('B-128: slug nieistniejącego modułu, niepoprawny slug albo brak ścieżki po slugu -> 404', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_HARNESS', '1');
    for (const path of [['nie-ma-modulu', 'scenes', 'odprawa-biurko.svg'], ['..', 'wyludzone-haslo', 'scenes', 'odprawa-biurko.svg'], ['Wyludzone', 'x.svg'], [M1]]) {
      expect((await get(...path)).status, path.join('/')).toBe(404);
    }
  });

  it('wyjście poza assets/, backslash, niedozwolone rozszerzenie i brak pliku -> 404', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_HARNESS', '1');
    for (const path of [['..', 'module.json'], ['scenes', '..', '..', 'module.json'], ['scenes\\..\\..\\module.json'], ['scenes', 'odprawa-biurko.svg.json'], ['scenes', 'nie-ma.svg'], ['.', 'scenes', 'odprawa-biurko.svg']]) {
      expect((await get(M1, ...path)).status, path.join('/')).toBe(404);
    }
  });
});
