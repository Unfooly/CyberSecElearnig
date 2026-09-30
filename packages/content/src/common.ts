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

// Pozy maskotki Fooli - PRZESTARZAŁE (D-096): odtwarzacz od D-093 nie pokazuje postaci. Enum zostaje, żeby starsze wersje treści
// dalej przechodziły walidację; nowa treść nie powinna używać `pose` (moduleWarnings).
export const MASCOT_POSES = ['greeting', 'thinking', 'pointing', 'cheer', 'warning'] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];

// Identyfikator bloku/elementu trafia jako KLUCZ do obiektów w progress (JSON) - musi być bezpieczny jako klucz:
// bez `__proto__` (zaczyna się od `_`, więc regex go odrzuca) i bez nazw z Object.prototype.
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
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

/**
 * Języki treści (schemaVersion 6, moduł 2 - docs/modules/modul-2-glos-z-helpdesku.md rozdz. 10). Pole wielojęzyczne to obiekt
 * `{ pl, en? }` - `pl` wymagane, brak innego języka = `pl` (fallback pole po polu, localize.ts). Zwykły string nadal jest poprawny i
 * znaczy `{ pl }`, więc treść v5 (moduł 1) przechodzi bez zmian. Dane treści, nie tłumaczenie interfejsu (CLAUDE.md: bez frameworka i18n).
 */
export const CONTENT_LOCALES = ['pl', 'en'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];
export const DEFAULT_CONTENT_LOCALE: ContentLocale = 'pl';

// Schematy pól wielojęzycznych - introspekcja (leafPaths) klasyfikuje je jak pole jednojęzyczne: ścieżka `a.b` nie zależy od języka,
// bo klient zawsze dostaje jeden, rozwinięty język (toClientBlock -> localizeContent).
const LOCALIZED_SCHEMAS = new WeakSet<z.ZodTypeAny>();

export function isLocalizedSchema(schema: z.ZodTypeAny): boolean {
  return LOCALIZED_SCHEMAS.has(schema);
}

/**
 * Błąd pola wielojęzycznego z właściwej gałęzi: dla obiektu `{ pl, en }` - z obiektu (z podścieżką, np. `en: ...`), dla reszty - z
 * wariantu jednojęzycznego. Bez tego zod zgłasza ogólne „Invalid input” i autor treści nie wie, co poprawić.
 */
/** Kształt wartości wielojęzycznej: obiekt z własnym polem `pl` (to samo kryterium w błędach zod i w parseModule). */
export function hasLocaleShape(data: unknown): boolean {
  return typeof data === 'object' && data !== null && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, 'pl');
}

function localizedErrorMap(options: number): z.ZodErrorMap {
  return (issue, ctx) => {
    if (issue.code !== 'invalid_union') return { message: ctx.defaultError };
    // Płaska narracja też jest obiektem - gałąź wielojęzyczna tylko dla obiektu z `pl`.
    const branch = issue.unionErrors[hasLocaleShape(ctx.data) ? options - 1 : 0];
    const first = branch?.issues[0];
    if (!first) return { message: ctx.defaultError };
    const suffix = first.path.slice(issue.path.length).join('.');
    return { message: suffix ? `${suffix}: ${first.message}` : first.message };
  };
}

/** Pole wielojęzyczne: wartość jednojęzyczna (= `{ pl }`) albo `{ pl, en? }` z tym samym schematem dla każdego języka. */
export function localized<T extends z.ZodTypeAny>(inner: T) {
  const perLocale = z.object({ pl: inner, en: inner.optional() }).strict();
  const schema = z.union([inner, perLocale], { errorMap: localizedErrorMap(2) });
  LOCALIZED_SCHEMAS.add(schema);
  return schema;
}

/** Tekst dla gracza w schemaVersion 6 (wielojęzyczny); v5 i starsze zapisują zwykły string - ten sam schemat go przyjmuje. */
export function ltext(max: number) {
  return localized(text(max));
}

// Napisy z dokładnymi czasami: zdanie i moment jego początku w nagraniu (ms). Wypełnia je skrypt TTS z timestampów ElevenLabs
// (with_timestamps, PR 3). Bez `cues` odtwarzacz dzieli `text` na zdania i rozkłada czas proporcjonalnie do ich długości (fallback).
export const cueSchema = z
  .object({
    text: text(1000),
    startMs: z.number().int().min(0).max(1_800_000),
  })
  .strict();

/**
 * Role głosu nagrań (schemaVersion 5, D-082). Rola, nie ID głosu: mapowanie rola -> voiceId ElevenLabs trzyma
 * scripts/content/voices.json (commitowane, bez sekretów), więc treść modułu nie zależy od konta TTS. Brak pola = narrator.
 */
// schemaVersion 6 (moduł 2, D-114): karol (ofiara), pawel (prawdziwy helpdesk), oszust (podszywa się pod Pawła - w voices.json
// `sameAs: "pawel"`, ten sam głos w każdym języku).
export const VOICE_ROLES = ['narrator', 'komisarz', 'bank', 'marek', 'karol', 'pawel', 'oszust'] as const;
export type VoiceRole = (typeof VOICE_ROLES)[number];
/** Role dostępne dopiero od schemaVersion 6 (semantics.ts, sprawdzenie wersji). */
export const V6_VOICE_ROLES: readonly VoiceRole[] = ['karol', 'pawel', 'oszust'];

const narrationBodyShape = {
  text: text(4000),
  // Tekst do PRZECZYTANIA przez lektora, gdy różni się od `text` wyświetlanego na ekranie (godziny, kwoty, domeny, hasła -
  // np. "9:00" wyświetlane, ale "dziewiąta zero zero" ma przeczytać TTS). Bez spokenText skrypt TTS czyta `text` wprost.
  // Wyłącznie wejście do nagrania: odtwarzacz go nie używa (napisy/cues zawsze z `text`), więc nie idzie do klienta
  // (FIELD_CLASSIFICATION: secret - nie dlatego, że to klucz odpowiedzi, tylko dlatego, że klient go w ogóle nie potrzebuje).
  spokenText: text(4000).optional(),
  audioUrl: audioPathSchema.optional(),
  durationMs: z.number().int().min(0).max(1_800_000).optional(),
  cues: z.array(cueSchema).min(1).max(200).optional(),
};

type NarrationRulesInput = { text: string; audioUrl?: string; durationMs?: number; cues?: { text: string; startMs: number }[] };

// Reguły nagrania wspólne dla narracji jednojęzycznej i nagrania jednego języka. superRefine (nie funkcja generyczna z .refine) -
// zachowuje dokładny typ wyniku każdego schematu.
function narrationRules(n: NarrationRulesInput, ctx: z.RefinementCtx): void {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if ((n.audioUrl === undefined) !== (n.durationMs === undefined)) fail('audioUrl i durationMs występują razem (wpisuje je skrypt TTS)');
  if (n.cues !== undefined && n.durationMs === undefined) fail('cues wymaga nagrania (audioUrl i durationMs): są czasami w nagraniu');
  const cues = n.cues;
  if (cues !== undefined && !cues.every((cue, i) => (i === 0 || cue.startMs >= cues[i - 1].startMs) && cue.startMs <= (n.durationMs ?? 0))) {
    fail('cues: startMs rosnąco i nie później niż durationMs');
  }
  // Napisy dzielą ten sam tekst co narracja: łączna długość cues nie może go rażąco przekraczać (ochrona przed rozdęciem odpowiedzi
  // /start: 200 cues x 1000 znaków to ok. 200 KB na jedną narrację).
  if (cues !== undefined && cues.reduce((sum, cue) => sum + cue.text.length, 0) > 2 * n.text.length + 200) {
    fail('cues: łączna długość napisów rażąco przekracza tekst narracji');
  }
}

// Narracja jednojęzyczna (v5 i starsze; w v6 nadal poprawna = `pl`). Po rozwinięciu języka (localizeContent) KAŻDA narracja ma ten
// kształt - to jest typ `Narration`, którego używa odtwarzacz. Kolejność pól jak przed v6 (`voice` zaraz po `text`): zod zwraca klucze
// w kolejności schematu, a zapisana treść modułu 1 ma zostać bajt w bajt ta sama (module-1-golden.spec.ts).
const { text: narrationText, ...narrationRest } = narrationBodyShape;
const flatNarrationSchema = z
  .object({
    text: narrationText,
    // schemaVersion 5: czyim głosem nagrać (patrz VOICE_ROLES). Wyłącznie wejście skryptu TTS, jak spokenText - klient go nie
    // dostaje (FIELD_CLASSIFICATION: secret w znaczeniu "niepotrzebne klientowi").
    voice: z.enum(VOICE_ROLES).optional(),
    ...narrationRest,
  })
  .strict()
  .superRefine(narrationRules);

// Nagranie jednego języka w narracji wielojęzycznej: tekst, spokenText i nagranie są osobne na każdy język (inna długość), rola głosu
// wspólna (pole `voice` obok języków).
export const narrationBodySchema = z.object(narrationBodyShape).strict().superRefine(narrationRules);
export type NarrationBody = z.infer<typeof narrationBodySchema>;

/**
 * Narracja (schemaVersion 6): jednojęzyczna (jak dotąd) albo `{ voice?, pl: {...}, en?: {...} }`. Klasyfikacja pól i ścieżki
 * (`narration.text`, `narration.voice`...) są te same w obu kształtach - leafPaths bierze wariant jednojęzyczny.
 */
const localizedNarrationObject = z
  .object({ voice: z.enum(VOICE_ROLES).optional(), pl: narrationBodySchema, en: narrationBodySchema.optional() })
  .strict();
export const narrationSchema = z.union([flatNarrationSchema, localizedNarrationObject], { errorMap: localizedErrorMap(2) });
LOCALIZED_SCHEMAS.add(narrationSchema);
export type Narration = z.infer<typeof flatNarrationSchema>;

// PRZESTARZAŁE (D-096): `mascot` zastąpione przez `tip` (sam tekst). Odtwarzacz czyta `tip`, a dla starszych wersji treści `mascot.text`.
export const mascotSchema = z
  .object({
    pose: z.enum(MASCOT_POSES),
    text: text(300).optional(),
  })
  .strict();

// Rodzaj wpisu w notatniku (ikona: mail, osoba, przedmiot, miejsce). Od schemaVersion 3; wymagany, gdy element jest dowodem (semantics.ts).
// schemaVersion 6 (moduł 2): call (rozmowa, nagranie, rejestr połączeń), log (logi, konsola admina), web (strona, webinar, OSINT).
export const NOTE_KINDS = ['mail', 'person', 'item', 'place', 'call', 'log', 'web'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** Rodzaje notatek dostępne dopiero od schemaVersion 6 (semantics.ts, sprawdzenie wersji). */
export const V6_NOTE_KINDS: readonly NoteKind[] = ['call', 'log', 'web'];

export const noteSchema = z.object({ text: ltext(500), kind: z.enum(NOTE_KINDS).optional() }).strict();

const layerPercent = z.number().min(0).max(100);
const layerRectShape = { x: layerPercent, y: layerPercent, w: z.number().gt(0).max(100), h: z.number().gt(0).max(100) };

/** Wygląd tekstu warstwy (odtwarzacz): etykieta/podpis, tabliczka lub szyld, tekst na ekranie urządzenia, pismo odręczne. */
export const TEXT_LAYER_STYLES = ['label', 'sign', 'screen', 'handwritten'] as const;
/**
 * Kolor tekstu warstwy względem tła slotu w grafice: `dark` (domyślnie) - ciemny tekst na jasnym tle; `light` - jasny tekst na ciemnym
 * tle (np. stopka strony, ekran urządzenia). Odtwarzacz nie zna koloru grafiki pod slotem, więc podaje go treść.
 */
export const TEXT_LAYER_TONES = ['dark', 'light'] as const;

/**
 * Warstwa tekstu (schemaVersion 6, rozdz. 10 specyfikacji modułu 2): tekst rysowany przez odtwarzacz NA grafice, w prostokącie w %
 * grafiki (jak sloty odprawy), zamiast tekstu wypalonego w SVG - dzięki temu grafika jest wspólna dla wszystkich języków. `portrait` -
 * prostokąt na wariancie pionowym grafiki (imagePortrait), gdy ten istnieje. Minimalny rozmiar czcionki na telefonie: D-103.
 */
export const textLayerSchema = z
  .array(
    z
      .object({
        id: idSchema,
        ...layerRectShape,
        text: ltext(300),
        style: z.enum(TEXT_LAYER_STYLES).optional(),
        tone: z.enum(TEXT_LAYER_TONES).optional(),
        portrait: z.object(layerRectShape).strict().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(30);

/**
 * Elementy wymagane do ukończenia bloku eksploracyjnego (hotspoty, pytania dialogu). Jedna reguła dla serwera i klienta:
 *  1. jeśli którykolwiek element ma jawne `required` (true/false): wymagane są te z `required: true` (reszta to "smaczki");
 *  2. inaczej lista `requiredX[]` (przestarzała od schemaVersion 3, nadal działa);
 *  3. inaczej wszystkie.
 */
export function requiredItemIds(
  items: readonly { id: string; required?: boolean }[],
  legacyRequired?: readonly string[],
): string[] {
  if (items.some((item) => item.required !== undefined)) return items.filter((item) => item.required === true).map((item) => item.id);
  return legacyRequired ? [...legacyRequired] : items.map((item) => item.id);
}

// Reakcja (od D-093 sam tekst w podpowiedzi odtwarzacza, player/hints.tsx; `pose` przestarzała i opcjonalna - D-096). `complete` (schemaVersion 4)
// to zdarzenie "blok ukończony" - pole dostępne na KAŻDYM typie bloku (baseShape), choć w PR 4 wywołuje je klient tylko dla
// bloków eksploracyjnych (po zebraniu wymaganych elementów; SCENE_HOTSPOTS/DIALOGUE/TABS/NARRATIVE). Jest polem `client`
// niezależnie od typu bloku: to KLIENT wywołuje je sam po stronie przeglądarki, więc nie zdradza niczego (komentarz PO fakcie,
// nie klucz odpowiedzi) - nic nie stoi na przeszkodzie, żeby w przyszłości użył go też inny typ bloku (np. VIDEO po obejrzeniu).
export const reactionMomentSchema = z.object({ pose: z.enum(MASCOT_POSES).optional(), text: ltext(300) }).strict();

/**
 * Jeden wpis reakcji na WYNIK bloku ocenianego (schemaVersion 4): dokładnie jedno z `when`/`minScore`, zależnie od typu bloku
 * (semantics.ts, reactionErrors) - `when` dla TEXT_INPUT_GUIDED (wynik jest binarny: poprawnie/po wyczerpaniu prób), `minScore`
 * dla reszty ocenianych typów (wynik 0-1: QUIZ, BRANCHING_SCENARIO, EMAIL_ANALYSIS, ORDERING). Lista `result[]` jest SEKRETEM
 * (FIELD_CLASSIFICATION): dociera do klienta dopiero w odpowiedzi /attempt albo /progress, razem z wynikiem, nigdy w /start -
 * inaczej zdradzałaby progi oceny, zanim gracz odpowie.
 */
export const reactionResultEntrySchema = z
  .object({
    pose: z.enum(MASCOT_POSES).optional(),
    text: ltext(300),
    when: z.enum(['correct', 'incorrect']).optional(),
    // Próg wyniku (0-1): wpis pasuje, gdy minScore <= wynik. Lista musi być malejąca (semantics.ts) - wygrywa pierwszy pasujący.
    minScore: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((entry) => (entry.when === undefined) !== (entry.minScore === undefined), {
    message: 'reactions.result: dokładnie jedno z pól when/minScore',
  });

export const reactionsSchema = z
  .object({
    complete: reactionMomentSchema.optional(),
    result: z.array(reactionResultEntrySchema).min(1).max(10).optional(),
  })
  .strict();

// Pola wspólne każdego bloku.
export const baseShape = {
  id: idSchema,
  title: ltext(200).optional(),
  narration: narrationSchema.optional(),
  // Stała podpowiedź bloku (D-096): tekst w dymku odtwarzacza (player/Hint.tsx), pole `client`. NIE mylić z `hints` zadania
  // tekstowego (sekret, odsłaniany po błędnych próbach).
  tip: ltext(300).optional(),
  // PRZESTARZAŁE (D-096) - użyj `tip`; zostaje dla starszych wersji treści.
  mascot: mascotSchema.optional(),
  // Waga w wyniku modułu; domyślnie z DEFAULT_WEIGHT (bloki oceniane 1, eksploracyjne 0).
  weight: z.number().min(0).max(10).optional(),
  // Reakcje maskotki na zdarzenia bloku (schemaVersion 4, opcjonalne): patrz reactionsSchema wyżej.
  reactions: reactionsSchema.optional(),
};
