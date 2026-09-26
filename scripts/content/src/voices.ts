import { readFileSync } from 'node:fs';
import { contentIndex, isObject } from './io.js';

// Głosy nagrań (D-082): rola z treści (narration.voice: narrator | fooli | bank | marek, brak = narrator) -> voiceId ElevenLabs z
// scripts/content/voices.json. Plik jest COMMITOWANY: ID głosu nie jest sekretem (trafia też do audio.lock.json i publicznego
// manifestu); klucz API zostaje wyłącznie w .env.local. Lista ról pochodzi ze schematu treści (VOICE_ROLES), więc voices.json musi
// mieć DOKŁADNIE te klucze - brakująca rola albo nieznany klucz to błąd od razu, nie cichy fallback na narratora.

export type Voices = Record<string, string>;

export const DEFAULT_VOICE_ROLE = 'narrator';

// Kształt prawdziwego ID głosu (ten sam zakres znaków co walidacja w providers/elevenlabs.ts). Wszystko inne (np. "<WKLEJ-ID>",
// "TODO", puste) to placeholder: --check i --dry-run działają dalej, ale generowanie takim głosem jest odrzucane czytelnym błędem.
const VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function isPlaceholderVoiceId(voiceId: string): boolean {
  return !VOICE_ID.test(voiceId);
}

/** Waliduje zawartość voices.json: obiekt z dokładnie rolami VOICE_ROLES, każda wartość to tekst (ID albo placeholder). */
export function parseVoices(raw: unknown, roles: readonly string[] = contentIndex.VOICE_ROLES): Voices {
  if (!isObject(raw)) throw new Error('voices.json: oczekiwano obiektu { rola: voiceId }.');
  const unknown = Object.keys(raw).filter((key) => !roles.includes(key));
  const missing = roles.filter((role) => !(role in raw));
  if (unknown.length > 0) throw new Error(`voices.json: nieznane role ${unknown.join(', ')} (dozwolone: ${roles.join(', ')}).`);
  if (missing.length > 0) throw new Error(`voices.json: brak ról ${missing.join(', ')}.`);
  const voices: Voices = {};
  for (const role of roles) {
    const value = raw[role];
    if (typeof value !== 'string') throw new Error(`voices.json: rola "${role}" musi mieć voiceId jako tekst.`);
    voices[role] = value.trim();
  }
  return voices;
}

export function loadVoices(path: string, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): Voices {
  let raw: unknown;
  try {
    raw = JSON.parse(read(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Brak pliku ${path} (mapowanie ról głosu na voiceId).`);
    throw new Error(`voices.json: niepoprawny JSON (${(error as Error).message}).`);
  }
  return parseVoices(raw);
}

/** Rola narracji z treści (brak pola = narrator). */
export function voiceRoleOf(narration: Record<string, unknown>): string {
  return typeof narration.voice === 'string' ? narration.voice : DEFAULT_VOICE_ROLE;
}
