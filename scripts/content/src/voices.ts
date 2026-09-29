import { readFileSync } from 'node:fs';
import { contentIndex, isObject } from './io.js';

// Głosy nagrań (D-082): rola z treści (narration.voice, brak = narrator) -> voiceId ElevenLabs z scripts/content/voices.json. Plik jest
// COMMITOWANY: ID głosu nie jest sekretem (trafia też do audio.lock.json i publicznego manifestu); klucz API zostaje wyłącznie w .env.local.
// Lista ról pochodzi ze schematu treści (VOICE_ROLES), więc voices.json musi mieć DOKŁADNIE te klucze - brakująca rola albo nieznany klucz
// to błąd od razu, nie cichy fallback na narratora.
//
// schemaVersion 6 (moduł 2, D-114): wpis roli to `{ "pl": voiceId, "en"?: voiceId }` (głos per język treści; brak języka = głos `pl`)
// albo `{ "sameAs": "<rola>" }` - ta sama postać innym imieniem (oszust = głos Pawła) w KAŻDYM języku. Stary kształt `"rola": "voiceId"`
// znaczy `{ "pl": voiceId }`. `sameAs` wskazuje istniejącą rolę bez własnego `sameAs` (bez łańcuchów): świadoma decyzja, nie literówka.

export type Voices = Record<string, string>;

export type VoiceEntry = { sameAs: string } | Record<string, string>;
export type VoiceConfig = Record<string, VoiceEntry>;

export const DEFAULT_VOICE_ROLE = 'narrator';
const DEFAULT_LOCALE = 'pl';

// Kształt prawdziwego ID głosu (ten sam zakres znaków co walidacja w providers/elevenlabs.ts). Wszystko inne (np. "<WKLEJ-ID>",
// "TODO", puste) to placeholder: --check i --dry-run działają dalej, ale generowanie takim głosem jest odrzucane czytelnym błędem.
const VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
// Typowe słowa zastępcze, które mieszczą się w kształcie ID (np. "WKLEJ_ID_FOOLI", "PLACEHOLDER") - bez tej listy dotarłyby aż do
// wywołania ElevenLabs po potwierdzeniu (code review D-082).
const PLACEHOLDER_WORDS = /todo|wklej|placeholder|xxx|obecny|paste|changeme/i;

export function isPlaceholderVoiceId(voiceId: string): boolean {
  return !VOICE_ID.test(voiceId) || PLACEHOLDER_WORDS.test(voiceId);
}

const isSameAs = (entry: VoiceEntry): entry is { sameAs: string } => typeof (entry as { sameAs?: unknown }).sameAs === 'string';

/** Waliduje zawartość voices.json: dokładnie role VOICE_ROLES; każda rola to voiceId, `{ pl, en? }` albo `{ sameAs }`. */
export function parseVoiceConfig(
  raw: unknown,
  roles: readonly string[] = contentIndex.VOICE_ROLES,
  locales: readonly string[] = contentIndex.CONTENT_LOCALES,
): VoiceConfig {
  if (!isObject(raw)) throw new Error('voices.json: oczekiwano obiektu { rola: voiceId | { pl, en? } | { sameAs } }.');
  const unknown = Object.keys(raw).filter((key) => !roles.includes(key));
  const missing = roles.filter((role) => !(role in raw));
  if (unknown.length > 0) throw new Error(`voices.json: nieznane role ${unknown.join(', ')} (dozwolone: ${roles.join(', ')}).`);
  if (missing.length > 0) throw new Error(`voices.json: brak ról ${missing.join(', ')}.`);

  const config: VoiceConfig = {};
  for (const role of roles) {
    const value = raw[role];
    if (typeof value === 'string') {
      config[role] = { [DEFAULT_LOCALE]: value.trim() };
      continue;
    }
    if (!isObject(value)) throw new Error(`voices.json: rola "${role}" musi mieć voiceId jako tekst, { pl, en? } albo { sameAs }.`);
    if ('sameAs' in value) {
      if (Object.keys(value).length !== 1 || typeof value.sameAs !== 'string') {
        throw new Error(`voices.json: rola "${role}": { sameAs } nie łączy się z innymi polami (głos jest brany z roli wskazanej).`);
      }
      config[role] = { sameAs: value.sameAs };
      continue;
    }
    const unknownLocales = Object.keys(value).filter((key) => !locales.includes(key));
    if (unknownLocales.length > 0) throw new Error(`voices.json: rola "${role}": nieznane języki ${unknownLocales.join(', ')} (dozwolone: ${locales.join(', ')}).`);
    if (typeof value[DEFAULT_LOCALE] !== 'string') throw new Error(`voices.json: rola "${role}" musi mieć voiceId dla "${DEFAULT_LOCALE}".`);
    const entry: Record<string, string> = {};
    for (const [locale, id] of Object.entries(value)) {
      if (typeof id !== 'string') throw new Error(`voices.json: rola "${role}", język "${locale}": voiceId jako tekst.`);
      entry[locale] = id.trim();
    }
    config[role] = entry;
  }

  for (const [role, entry] of Object.entries(config)) {
    if (!isSameAs(entry)) continue;
    const target = config[entry.sameAs];
    if (target === undefined) throw new Error(`voices.json: rola "${role}": sameAs wskazuje nieznaną rolę "${entry.sameAs}".`);
    if (entry.sameAs === role || isSameAs(target)) {
      throw new Error(`voices.json: rola "${role}": sameAs musi wskazywać rolę z własnym głosem (bez łańcuchów i odwołania do siebie).`);
    }
  }
  return config;
}

/** Rola -> voiceId dla języka treści: `sameAs` rozwinięte, brak głosu w danym języku = głos `pl`. */
export function voicesForLocale(config: VoiceConfig, locale: string = DEFAULT_LOCALE): Voices {
  const own = (entry: Record<string, string>) => entry[locale] ?? entry[DEFAULT_LOCALE];
  const voices: Voices = {};
  for (const [role, entry] of Object.entries(config)) {
    voices[role] = isSameAs(entry) ? own(config[entry.sameAs] as Record<string, string>) : own(entry);
  }
  return voices;
}

/** Waliduje voices.json i zwraca rola -> voiceId dla języka `locale` (domyślnie pl). */
export function parseVoices(raw: unknown, roles: readonly string[] = contentIndex.VOICE_ROLES, locale: string = DEFAULT_LOCALE): Voices {
  return voicesForLocale(parseVoiceConfig(raw, roles), locale);
}

export function loadVoices(
  path: string,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
  locale: string = DEFAULT_LOCALE,
): Voices {
  let raw: unknown;
  try {
    raw = JSON.parse(read(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Brak pliku ${path} (mapowanie ról głosu na voiceId).`);
    throw new Error(`voices.json: niepoprawny JSON (${(error as Error).message}).`);
  }
  return parseVoices(raw, contentIndex.VOICE_ROLES, locale);
}

/** Rola narracji z treści (brak pola = narrator). */
export function voiceRoleOf(narration: Record<string, unknown>): string {
  return typeof narration.voice === 'string' ? narration.voice : DEFAULT_VOICE_ROLE;
}
