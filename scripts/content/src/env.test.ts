import { describe, it, expect } from 'vitest';
import { assertNotCi, readEnvFile, redactSecrets, requireVars, resolveConfig, CONFIG_NAMES } from './env.js';

describe('readEnvFile', () => {
  it('parsuje plik bez dotykania process.env; brak pliku to pusta konfiguracja', () => {
    const before = process.env.ELEVENLABS_API_KEY;
    const values = readEnvFile('x', () => 'ELEVENLABS_API_KEY=sekret-123456\nR2_BUCKET=unfooly-content\n# komentarz\n');
    expect(values).toEqual({ ELEVENLABS_API_KEY: 'sekret-123456', R2_BUCKET: 'unfooly-content' });
    expect(process.env.ELEVENLABS_API_KEY).toBe(before);

    const missing = readEnvFile('x', () => {
      throw Object.assign(new Error('brak'), { code: 'ENOENT' });
    });
    expect(missing).toEqual({});
  });

  it('inne błędy odczytu nie są połykane', () => {
    expect(() =>
      readEnvFile('x', () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }),
    ).toThrow('EACCES');
  });
});

describe('resolveConfig', () => {
  it('bierze tylko ZNANE nazwy; obce zmienne (np. z .env aplikacji) są ignorowane', () => {
    const config = resolveConfig(
      { R2_BUCKET: 'unfooly-content', DATABASE_URL: 'postgres://haslo', JWT_SECRET: 'x' },
      { STRIPE_SECRET_KEY: 'sk_live', PATH: '/bin' } as NodeJS.ProcessEnv,
    );
    expect(config).toEqual({ R2_BUCKET: 'unfooly-content' });
    expect(Object.keys(config).every((name) => (CONFIG_NAMES as readonly string[]).includes(name))).toBe(true);
  });

  it('środowisko procesu nadpisuje plik (te same nazwy); puste wartości to brak', () => {
    const config = resolveConfig({ R2_BUCKET: 'z-pliku', R2_ENDPOINT: '  ' }, { R2_BUCKET: 'ze-srodowiska' } as NodeJS.ProcessEnv);
    expect(config).toEqual({ R2_BUCKET: 'ze-srodowiska' });
  });
});

describe('requireVars', () => {
  it('błąd wymienia NAZWY brakujących zmiennych, nigdy wartości', () => {
    const config = { ELEVENLABS_API_KEY: 'super-tajny-klucz-123' };
    try {
      requireVars(config, ['ELEVENLABS_API_KEY', 'R2_ENDPOINT', 'R2_BUCKET']);
      throw new Error('powinno rzucić');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('R2_ENDPOINT');
      expect(message).toContain('R2_BUCKET');
      expect(message).not.toContain('ELEVENLABS_API_KEY,');
      expect(message).not.toContain('super-tajny-klucz-123');
    }
  });

  it('komplet zmiennych: bez błędu', () => {
    expect(() => requireVars({ R2_BUCKET: 'b' }, ['R2_BUCKET'])).not.toThrow();
  });
});

describe('assertNotCi', () => {
  it.each(['true', '1', 'yes'])('CI=%s: odmowa', (value) => {
    expect(() => assertNotCi({ CI: value } as NodeJS.ProcessEnv)).toThrow(/CI=true/);
  });
  it.each([undefined, '', '0', 'false', 'FALSE'])('CI=%s: dozwolone', (value) => {
    expect(() => assertNotCi({ CI: value } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe('redactSecrets', () => {
  const config = { ELEVENLABS_API_KEY: 'xi-api-key-9999', R2_ACCESS_KEY_ID: 'AKIA-ACCESS-1', R2_SECRET_ACCESS_KEY: 'super/secret+value', R2_BUCKET: 'unfooly-content' };

  it('maskuje klucze API i R2 w dowolnym tekście (także w komunikatach SDK); nie maskuje danych niesekretnych', () => {
    const text = 'Błąd 401: xi-api-key-9999; AKIA-ACCESS-1 / super/secret+value; bucket unfooly-content';
    expect(redactSecrets(text, config)).toBe('Błąd 401: ***; *** / ***; bucket unfooly-content');
  });

  it('gdy jeden sekret jest podłańcuchem drugiego, dłuższy jest maskowany w całości (bez resztek)', () => {
    const nested = { ELEVENLABS_API_KEY: 'abcdef', R2_SECRET_ACCESS_KEY: 'abcdef-tajna-czesc' };
    expect(redactSecrets('klucz: abcdef-tajna-czesc, krótki: abcdef', nested)).toBe('klucz: ***, krótki: ***');
  });

  it('bardzo krótkie wartości nie są maskowane (unikamy zamiany pojedynczych znaków w tekście)', () => {
    expect(redactSecrets('abc def', { ELEVENLABS_API_KEY: 'a' })).toBe('abc def');
  });
});
