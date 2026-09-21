import { z } from 'zod';

// Wartości muszą być identyczne z enumem CourseCategory w apps/api/prisma/schema.prisma (test w apps/api to pilnuje).
export const COURSE_CATEGORIES = [
  'PHISHING_SOCIAL_ENGINEERING',
  'EMAIL_SECURITY',
  'IT_HYGIENE',
  'INCIDENT_RESPONSE',
  'MALWARE',
  'GENERAL_AWARENESS',
] as const;

export const MASCOT_POSES = ['greeting', 'thinking', 'pointing', 'cheer', 'warning'] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];

// Identyfikator bloku/elementu trafia jako KLUCZ do obiektów w progress (JSON) - musi być bezpieczny jako klucz:
// bez `__proto__` (zaczyna się od `_`, więc regex go odrzuca) i bez nazw z Object.prototype.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_IDS = new Set(['constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'toJSON']);

export const idSchema = z
  .string()
  .regex(ID_PATTERN, 'Identyfikator: litery, cyfry, "-" i "_", max 64 znaki, zaczyna się od litery lub cyfry')
  .refine((id) => !RESERVED_IDS.has(id), 'Zastrzeżony identyfikator');

// Ścieżka zasobu WZGLĘDNA względem CONTENT_BASE_URL. Regex wyklucza schemat (brak ":"), host ("//"), ścieżkę bezwzględną, "..",
// backslash i znaki specjalne, więc nie da się wskazać cudzego hosta ani `javascript:`. Klient składa CONTENT_BASE_URL + ścieżka.
const ASSET_PATH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function assetPath(extensions: string[]) {
  const ext = new RegExp(`\\.(${extensions.join('|')})$`, 'i');
  return z
    .string()
    .max(300)
    .regex(ASSET_PATH, 'Ścieżka zasobu musi być względna (bez schematu, hosta i "..")')
    .regex(ext, `Dozwolone rozszerzenia: ${extensions.join(', ')}`);
}

export const imagePathSchema = assetPath(['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg']);
export const audioPathSchema = assetPath(['mp3']);

export function text(max: number) {
  return z.string().min(1).max(max);
}

// Napisy z dokładnymi czasami: zdanie i moment jego początku w nagraniu (ms). Wypełnia je skrypt TTS z timestampów ElevenLabs
// (with_timestamps, PR 3). Bez `cues` odtwarzacz dzieli `text` na zdania i rozkłada czas proporcjonalnie do ich długości (fallback).
export const cueSchema = z
  .object({
    text: text(1000),
    startMs: z.number().int().min(0).max(1_800_000),
  })
  .strict();

export const narrationSchema = z
  .object({
    text: text(4000),
    audioUrl: audioPathSchema.optional(),
    durationMs: z.number().int().min(0).max(1_800_000).optional(),
    cues: z.array(cueSchema).min(1).max(200).optional(),
  })
  .strict()
  .refine((n) => (n.audioUrl === undefined) === (n.durationMs === undefined), {
    message: 'audioUrl i durationMs występują razem (wpisuje je skrypt TTS)',
  })
  .refine((n) => n.cues === undefined || n.durationMs !== undefined, {
    message: 'cues wymaga nagrania (audioUrl i durationMs): są czasami w nagraniu',
  })
  .refine(
    (n) =>
      n.cues === undefined ||
      n.cues.every((cue, i) => (i === 0 || cue.startMs >= n.cues![i - 1].startMs) && cue.startMs <= (n.durationMs ?? 0)),
    { message: 'cues: startMs rosnąco i nie później niż durationMs' },
  )
  // Napisy dzielą ten sam tekst co narracja: łączna długość cues nie może go rażąco przekraczać (ochrona przed rozdęciem odpowiedzi
  // /start: 200 cues x 1000 znaków to ok. 200 KB na jedną narrację).
  .refine((n) => n.cues === undefined || n.cues.reduce((sum, cue) => sum + cue.text.length, 0) <= 2 * n.text.length + 200, {
    message: 'cues: łączna długość napisów rażąco przekracza tekst narracji',
  });
export type Narration = z.infer<typeof narrationSchema>;

export const mascotSchema = z
  .object({
    pose: z.enum(MASCOT_POSES),
    text: text(300).optional(),
  })
  .strict();

export const noteSchema = z.object({ text: text(500) }).strict();

// Pola wspólne każdego bloku.
export const baseShape = {
  id: idSchema,
  title: text(200).optional(),
  narration: narrationSchema.optional(),
  mascot: mascotSchema.optional(),
  // Waga w wyniku modułu; domyślnie z DEFAULT_WEIGHT (bloki oceniane 1, eksploracyjne 0).
  weight: z.number().min(0).max(10).optional(),
};
