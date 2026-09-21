import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './tts.js';

let errors: string[];
let logs: string[];

beforeEach(() => {
  errors = [];
  logs = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.join(' ')));
  vi.spyOn(console, 'log').mockImplementation((...args) => void logs.push(args.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

describe('tts CLI: kody wyjścia i tryby', () => {
  it('--help: kod 0 i użycie', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(logs.join('\n')).toContain('Użycie:');
  });

  it.each([
    ['brak sluga', []],
    ['dwa slugi', ['a', 'b']],
    ['nieznana flaga', ['modul', '--nie-ma']],
    ['zły --storage', ['modul', '--storage', 's3']],
    ['zły slug', ['../etc']],
    ['zła wersja', ['modul', '--version', '../x']],
  ])('błędne użycie (%s): kod 2, czytelny komunikat, bez stack trace', async (_name, argv) => {
    expect(await main(argv)).toBe(2);
    expect(errors.join('\n')).toMatch(/^Błąd:/);
  });

  it('tryb z kluczami w CI: odmowa (kod 1) zanim cokolwiek zostanie przeczytane', async () => {
    expect(await main(['modul', '--yes'], { CI: 'true' })).toBe(1);
    expect(errors.join('\n')).toMatch(/CI=true/);
  });

  it('tryb z kluczami bez konfiguracji: błąd z NAZWAMI zmiennych, bez wartości', async () => {
    expect(await main(['modul', '--yes'], {})).toBe(1);
    expect(errors.join('\n')).toMatch(/ELEVENLABS_API_KEY/);
  });

  it('--check działa w CI i nie potrzebuje kluczy (nieistniejący moduł: błąd modułu, nie konfiguracji)', async () => {
    expect(await main(['nie-ma-takiego-modulu', '--check'], { CI: 'true' })).toBe(1);
    expect(errors.join('\n')).toMatch(/Brak pliku/);
    expect(errors.join('\n')).not.toMatch(/CI=true|ELEVENLABS/);
  });

  it('--dry-run z --storage r2 nie tworzy klienta R2 (bez zmiennych R2_*)', async () => {
    expect(await main(['nie-ma-takiego-modulu', '--dry-run', '--storage', 'r2'], { CI: 'true' })).toBe(1);
    expect(errors.join('\n')).toMatch(/Brak pliku/);
    expect(errors.join('\n')).not.toMatch(/R2_/);
  });
});
