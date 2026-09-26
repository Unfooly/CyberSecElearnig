import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

// Konfiguracja skryptów treści. KLUCZE (ElevenLabs, R2) są TYLKO w lokalnym pliku autora `scripts/content/.env.local` (poza gitem), nigdy w
// repo, CI ani kontenerach; aplikacja (api/web) ich nie zna, zna wyłącznie publiczny CONTENT_BASE_URL (D-060).
//
// Reguły:
//  - czytamy WYŁĄCZNIE ten plik (i te same, znane nazwy z process.env jako nadpisanie): nigdy `.env` z rootu (sekrety aplikacji) ani obcych
//    zmiennych środowiska;
//  - tryby, które wołają sieć albo potrzebują kluczy, odmawiają startu w CI;
//  - komunikaty błędów wymieniają NAZWY zmiennych, nigdy wartości; ewentualne logi przechodzą przez redactSecrets.

// ID głosów NIE są tu od D-082: rola -> voiceId jest w commitowanym scripts/content/voices.json (to nie sekret).
export const CONFIG_NAMES = [
  'ELEVENLABS_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT',
] as const;

export type ConfigName = (typeof CONFIG_NAMES)[number];
export type Config = Partial<Record<ConfigName, string>>;

/** Wartości, które są SEKRETAMI (nie mogą trafić do logów). ID głosu, bucket, endpoint i ID konta nie są sekretami. */
const SECRET_NAMES: ConfigName[] = ['ELEVENLABS_API_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/** Parsuje plik .env.local bez dotykania process.env; brak pliku to pusta konfiguracja. */
export function readEnvFile(path: string, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): Record<string, string> {
  try {
    return parse(read(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/**
 * Konfiguracja: wartości z pliku, nadpisywane przez te SAME znane nazwy ze środowiska procesu (jednorazowe uruchomienie bez edycji pliku).
 * Wszystko poza CONFIG_NAMES jest ignorowane. Puste wartości traktujemy jak brak.
 */
export function resolveConfig(fileValues: Record<string, string>, processEnv: NodeJS.ProcessEnv): Config {
  const config: Config = {};
  for (const name of CONFIG_NAMES) {
    const value = processEnv[name] ?? fileValues[name];
    if (typeof value === 'string' && value.trim() !== '') config[name] = value.trim();
  }
  return config;
}

/** Rzuca błąd z LISTĄ NAZW brakujących zmiennych (bez wartości). */
export function requireVars(config: Config, names: readonly ConfigName[]): void {
  const missing = names.filter((name) => !config[name]);
  if (missing.length > 0) {
    throw new Error(`Brak zmiennych w scripts/content/.env.local: ${missing.join(', ')} (wzór: scripts/content/.env.local.example).`);
  }
}

/** Skrypty z kluczami i siecią nie działają w CI (klucze nie mogą tam trafić; testy i --check są offline). */
export function assertNotCi(processEnv: NodeJS.ProcessEnv): void {
  const ci = processEnv.CI;
  if (ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false') {
    throw new Error('Odmowa: CI=true. Generowanie audio i publikacja zasobów działają tylko u autora treści (klucze poza CI).');
  }
}

/** Zastępuje w tekście wartości sekretów maską (klucze API i R2), także w komunikatach błędów z SDK. */
export function redactSecrets(text: string, config: Config): string {
  // Najdłuższe sekrety najpierw: gdy jeden jest podłańcuchem drugiego, krótszy nie może pokroić dłuższego i zostawić resztki. Wartości
  // krótsze niż 6 znaków pomijamy (maskowanie pojedynczych znaków zniszczyłoby tekst; prawdziwe klucze API i R2 są dłuższe).
  const values = SECRET_NAMES.map((name) => config[name])
    .filter((value): value is string => !!value && value.length >= 6)
    .sort((a, b) => b.length - a.length);
  let result = text;
  for (const value of values) result = result.split(value).join('***');
  return result;
}
