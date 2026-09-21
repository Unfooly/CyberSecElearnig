import { z } from 'zod';
import { baseShape, imagePathSchema, idSchema, narrationSchema, noteSchema, text } from './common';

// Pełne ("serwerowe") schematy bloków modułu. Zawierają KLUCZ ODPOWIEDZI, więc nigdy nie idą do klienta wprost:
// do przeglądarki trafia wyłącznie wynik toClientBlock (client.ts) wg FIELD_CLASSIFICATION poniżej.
// Schematy są .strict(): literówka w JSON-ie modułu (np. "corect") to błąd walidacji, nie cicho pominięte pole.

const percent = z.number().min(0).max(100);

// --- Bloki dotychczasowe (kształt jak w docs/content-backlog-elearning.md) ---------------------------------------------

const videoSchema = z
  .object({
    ...baseShape,
    type: z.literal('VIDEO'),
    url: z.string().max(500).regex(/^https:\/\//, 'Adres wideo musi być https'),
    durationSeconds: z.number().int().min(0).max(36_000).optional(),
  })
  .strict();

const choiceOptionSchema = z
  .object({
    text: text(500),
    // QUIZ używa `correct`, BRANCHING_SCENARIO `outcome` (jak w dokumencie) - dokładnie jedno z dwóch.
    correct: z.boolean().optional(),
    outcome: z.enum(['correct', 'wrong']).optional(),
    feedback: text(1000).optional(),
  })
  .strict();

const quizSchema = z
  .object({
    ...baseShape,
    type: z.literal('QUIZ'),
    prompt: text(1000),
    options: z.array(choiceOptionSchema).min(2).max(8),
  })
  .strict();

const branchingSchema = z
  .object({
    ...baseShape,
    type: z.literal('BRANCHING_SCENARIO'),
    prompt: text(1000),
    options: z.array(choiceOptionSchema).min(2).max(8),
  })
  .strict();

const dragAndDropSchema = z
  .object({
    ...baseShape,
    type: z.literal('DRAG_AND_DROP'),
    prompt: text(500).optional(),
    items: z.array(z.object({ text: text(300) }).strict()).min(1).max(30),
    categories: z.tuple([text(60), text(60)]).optional(),
  })
  .strict();

const embeddedHtmlSchema = z
  .object({
    ...baseShape,
    type: z.literal('EMBEDDED_HTML'),
    html: z.string().min(1).max(200_000),
  })
  .strict();

// --- Nowe bloki silnika scen -------------------------------------------------------------------------------------------

const hotspotsSchema = z
  .object({
    ...baseShape,
    type: z.literal('SCENE_HOTSPOTS'),
    image: imagePathSchema,
    imageAlt: text(300),
    hotspots: z
      .array(
        z
          .object({
            id: idSchema,
            label: text(100),
            // Prostokąt w procentach obrazu.
            x: percent,
            y: percent,
            width: z.number().min(1).max(100),
            height: z.number().min(1).max(100),
            content: text(2000),
            narration: baseShape.narration,
            // schemaVersion 3: dowód w śledztwie (wpis w notatniku po "Dodaj do notatnika"; wymaga `note` z `kind`) i wymagalność.
            evidence: z.boolean().optional(),
            note: noteSchema.optional(),
            required: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    // PRZESTARZAŁE od schemaVersion 3 (zastąpione `hotspots[].required`); nadal działa. Domyślnie wszystkie.
    requiredHotspots: z.array(idSchema).max(20).optional(),
  })
  .strict();

const dialogueSchema = z
  .object({
    ...baseShape,
    type: z.literal('DIALOGUE'),
    // avatar: schemaVersion 3, ścieżka względna wobec CONTENT_BASE_URL (klient tylko przez <img>).
    character: z.object({ name: text(80), role: text(120).optional(), avatar: imagePathSchema.optional() }).strict(),
    questions: z
      .array(
        z
          .object({
            id: idSchema,
            text: text(300),
            // Odpowiedź jako jeden tekst ALBO kwestie wypowiadane po kolei (schemaVersion 3): dokładnie jedno z nich (semantics.ts).
            answer: text(2000).optional(),
            lines: z
              .array(z.object({ text: text(600), narration: narrationSchema.optional() }).strict())
              .min(1)
              .max(10)
              .optional(),
            answerNarration: baseShape.narration,
            // Dopisywana do notatnika, gdy pytanie zostało zadane.
            note: noteSchema.optional(),
            // schemaVersion 3: pytanie odblokowuje dowód (wymaga `note` z `kind`) i wymagalność.
            evidence: z.boolean().optional(),
            required: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(15),
    // PRZESTARZAŁE od schemaVersion 3 (zastąpione `questions[].required`); nadal działa.
    requiredQuestions: z.array(idSchema).max(15).optional(),
  })
  .strict();

const notepadSchema = z
  .object({
    ...baseShape,
    type: z.literal('NOTEPAD'),
    prompt: text(500).optional(),
  })
  .strict();

/** Rodzaje fragmentów maila, które mogą być kotwicą kryterium: nagłówek nadawcy (nazwa i adres), temat, link, załącznik, cytat z treści. */
export const EMAIL_TARGET_KINDS = ['sender', 'subject', 'link', 'attachment', 'text'] as const;

const emailAnalysisSchema = z
  .object({
    ...baseShape,
    type: z.literal('EMAIL_ANALYSIS'),
    email: z
      .object({
        fromName: text(120),
        fromAddress: text(200),
        subject: text(300),
        body: text(4000),
        // schemaVersion 3: wygląd prawdziwego klienta pocztowego. Data to tekst do wyświetlenia (nie jest parsowana), załącznik to
        // element klikalny w makiecie, ale bez pobierania (nie ma adresu pliku).
        date: text(60).optional(),
        attachment: z.object({ name: text(120), size: text(30).optional() }).strict().optional(),
        // `url` to tylko PODGLĄD adresu (wyświetlany w dymku jak pasek statusu przeglądarki, nigdy nie nawiguje).
        links: z.array(z.object({ id: idSchema, text: text(200), url: text(500) }).strict()).max(10),
      })
      .strict(),
    prompt: text(500).optional(),
    criteria: z
      .array(
        z
          .object({
            id: idSchema,
            label: text(300),
            correct: z.boolean(),
            explanation: text(1000).optional(),
            // Trafia do notatnika, gdy kryterium jest poprawne i zostało zaznaczone.
            note: noteSchema.optional(),
            // schemaVersion 3: trafione kryterium jest dowodem (wymaga `correct: true` oraz `note` z `kind`). SEKRET (zdradzałby poprawność).
            evidence: z.boolean().optional(),
            // schemaVersion 3: fragment maila, którego kliknięcie zaznacza to kryterium (checklista zostaje alternatywą dla klawiatury).
            // Kotwice mają też kryteria BŁĘDNE (inaczej sam fakt, że fragment jest klikalny, zdradzałby poprawne). Kryterium bez `target`
            // (np. "presja czasu" w całości) jest tylko na liście.
            target: z
              .object({
                kind: z.enum(EMAIL_TARGET_KINDS),
                // kind=link: id linku z email.links; kind=text: cytat (fragment email.body, semantics.ts).
                linkId: idSchema.optional(),
                quote: text(200).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(2)
      .max(12),
    // partial: punkty częściowe; exact: cały zestaw albo 0.
    scoring: z.enum(['partial', 'exact']).default('partial'),
  })
  .strict();

const textInputSchema = z
  .object({
    ...baseShape,
    type: z.literal('TEXT_INPUT_GUIDED'),
    prompt: text(1000),
    placeholder: text(100).optional(),
    answer: z
      .object({
        accept: z.array(text(200)).max(20).default([]),
        // Wzorzec MUSI być zapisany jako ^...$ i skompilować się w silniku RE2 (czas liniowy: brak backreferencji i lookahead);
        // serwer dopasowuje go tym samym silnikiem do całej odpowiedzi. Długość wzorca <= 200, długość odpowiedzi <= 500
        // (drugi bezpiecznik).
        regex: text(200).optional(),
        // Domyślnie wielkość liter jest ignorowana (dotyczy accept i regex); true = rozróżniaj.
        caseSensitive: z.boolean().default(false),
      })
      .strict(),
    normalize: z
      .object({
        trim: z.boolean().default(true),
        collapseWhitespace: z.boolean().default(true),
      })
      .strict()
      .default({}),
    hints: z.array(z.object({ text: text(500), narration: baseShape.narration }).strict()).max(9).default([]),
    maxAttempts: z.number().int().min(1).max(10).default(4),
    scoring: z
      .object({
        attemptPenalty: z.number().min(0).max(1).default(0.25),
        floor: z.number().min(0).max(1).default(0.25),
      })
      .strict()
      .default({}),
    solution: z.object({ text: text(300), explanation: text(1000).optional() }).strict(),
  })
  .strict();

const orderingSchema = z
  .object({
    ...baseShape,
    type: z.literal('ORDERING'),
    prompt: text(500),
    // Elementy w POPRAWNEJ kolejności - klient dostaje je przetasowane (sekret serwera), patrz client.ts.
    // Co najmniej 3: przy 2 elementach jedyna "przetasowana" kolejność jest odwrotnością poprawnej, a nawet losowa zdradzałaby
    // odpowiedź z prawdopodobieństwem 1/2 bez żadnej wiedzy.
    items: z.array(z.object({ id: idSchema, text: text(300) }).strict()).min(3).max(12),
    scoring: z.enum(['partial', 'exact']).default('partial'),
    explanation: text(1000).optional(),
  })
  .strict();

const tabsSchema = z
  .object({
    ...baseShape,
    type: z.literal('TABS'),
    tabs: z.array(z.object({ id: idSchema, title: text(60), content: text(3000) }).strict()).min(1).max(10),
    requiredTabs: z.array(idSchema).max(10).optional(),
  })
  .strict();

const summarySchema = z
  .object({
    ...baseShape,
    type: z.literal('SUMMARY'),
    text: text(2000).optional(),
  })
  .strict();

export const BLOCK_SCHEMAS = {
  VIDEO: videoSchema,
  QUIZ: quizSchema,
  BRANCHING_SCENARIO: branchingSchema,
  DRAG_AND_DROP: dragAndDropSchema,
  EMBEDDED_HTML: embeddedHtmlSchema,
  SCENE_HOTSPOTS: hotspotsSchema,
  DIALOGUE: dialogueSchema,
  NOTEPAD: notepadSchema,
  EMAIL_ANALYSIS: emailAnalysisSchema,
  TEXT_INPUT_GUIDED: textInputSchema,
  ORDERING: orderingSchema,
  TABS: tabsSchema,
  SUMMARY: summarySchema,
} as const;

export type BlockType = keyof typeof BLOCK_SCHEMAS;
export const BLOCK_TYPES = Object.keys(BLOCK_SCHEMAS) as BlockType[];

export const blockSchema = z.discriminatedUnion('type', [
  videoSchema,
  quizSchema,
  branchingSchema,
  dragAndDropSchema,
  embeddedHtmlSchema,
  hotspotsSchema,
  dialogueSchema,
  notepadSchema,
  emailAnalysisSchema,
  textInputSchema,
  orderingSchema,
  tabsSchema,
  summarySchema,
]);
export type ServerBlock = z.infer<typeof blockSchema>;

export type ServerBlockOf<T extends BlockType> = z.infer<(typeof BLOCK_SCHEMAS)[T]>;

// Bloki oceniane (waga 1) i eksploracyjne (waga 0: wymagane do przejścia, bez wpływu na wynik modułu).
export const DEFAULT_WEIGHT: Record<BlockType, number> = {
  VIDEO: 0,
  QUIZ: 1,
  BRANCHING_SCENARIO: 1,
  DRAG_AND_DROP: 0,
  EMBEDDED_HTML: 0,
  SCENE_HOTSPOTS: 0,
  DIALOGUE: 0,
  NOTEPAD: 0,
  EMAIL_ANALYSIS: 1,
  TEXT_INPUT_GUIDED: 1,
  ORDERING: 1,
  TABS: 0,
  SUMMARY: 0,
};

// --- Klasyfikacja pól: co widzi klient, co jest sekretem serwera -------------------------------------------------------
//
// KAŻDE pole liściowe schematu serwerowego musi być w dokładnie jednej z list (test w classification.spec.ts porównuje
// klasyfikację z rzeczywistym schematem). Do klienta idzie wyłącznie `client`; wszystko inne (także pole, którego ktoś
// zapomniał sklasyfikować) jest wycinane - biała lista, nie czarna. Ścieżki: `a.b`, tablice `a[].b`.

const BASE_CLIENT = [
  'id',
  'type',
  'title',
  'narration.text',
  'narration.audioUrl',
  'narration.durationMs',
  'narration.cues[].text',
  'narration.cues[].startMs',
  'mascot.pose',
  'mascot.text',
];
const BASE_SECRET = ['weight'];

export interface FieldClassification {
  client: string[];
  secret: string[];
}

function classify(client: string[], secret: string[]): FieldClassification {
  return { client: [...BASE_CLIENT, ...client], secret: [...BASE_SECRET, ...secret] };
}

const CHOICE_SECRET = ['options[].correct', 'options[].outcome', 'options[].feedback'];

export const FIELD_CLASSIFICATION: Record<BlockType, FieldClassification> = {
  VIDEO: classify(['url', 'durationSeconds'], []),
  QUIZ: classify(['prompt', 'options[].text'], CHOICE_SECRET),
  BRANCHING_SCENARIO: classify(['prompt', 'options[].text'], CHOICE_SECRET),
  DRAG_AND_DROP: classify(['prompt', 'items[].text', 'categories[]'], []),
  // `html` wykonuje dowolny JS, więc NIE idzie do przeglądarki razem z treścią modułu (/start): serwowany jest osobnym dokumentem
  // (GET /courses/:id/blocks/:blockId/embed) z własnym CSP i sandboxem, dopiero gdy blok jest osiągalny dla przypisania.
  EMBEDDED_HTML: classify([], ['html']),
  SCENE_HOTSPOTS: classify(
    [
      'image',
      'imageAlt',
      'hotspots[].id',
      'hotspots[].label',
      'hotspots[].x',
      'hotspots[].y',
      'hotspots[].width',
      'hotspots[].height',
      'hotspots[].content',
      'hotspots[].narration.text',
      'hotspots[].narration.audioUrl',
      'hotspots[].narration.durationMs',
      'hotspots[].narration.cues[].text',
      'hotspots[].narration.cues[].startMs',
      'hotspots[].evidence',
      'hotspots[].note.text',
      'hotspots[].note.kind',
      'hotspots[].required',
      'requiredHotspots[]',
    ],
    [],
  ),
  DIALOGUE: classify(
    [
      'character.name',
      'character.role',
      'character.avatar',
      'questions[].id',
      'questions[].text',
      'questions[].answer',
      'questions[].lines[].text',
      'questions[].lines[].narration.text',
      'questions[].lines[].narration.audioUrl',
      'questions[].lines[].narration.durationMs',
      'questions[].lines[].narration.cues[].text',
      'questions[].lines[].narration.cues[].startMs',
      'questions[].evidence',
      'questions[].required',
      'questions[].note.kind',
      'questions[].answerNarration.text',
      'questions[].answerNarration.audioUrl',
      'questions[].answerNarration.durationMs',
      'questions[].answerNarration.cues[].text',
      'questions[].answerNarration.cues[].startMs',
      'questions[].note.text',
      'requiredQuestions[]',
    ],
    [],
  ),
  NOTEPAD: classify(['prompt'], []),
  EMAIL_ANALYSIS: classify(
    [
      'email.fromName',
      'email.fromAddress',
      'email.subject',
      'email.body',
      'email.date',
      'email.attachment.name',
      'email.attachment.size',
      'email.links[].id',
      'email.links[].text',
      'email.links[].url',
      'prompt',
      'criteria[].id',
      'criteria[].label',
      'criteria[].target.kind',
      'criteria[].target.linkId',
      'criteria[].target.quote',
    ],
    ['criteria[].correct', 'criteria[].explanation', 'criteria[].note.text', 'criteria[].note.kind', 'criteria[].evidence', 'scoring'],
  ),
  TEXT_INPUT_GUIDED: classify(
    ['prompt', 'placeholder', 'maxAttempts'],
    [
      'answer.accept[]',
      'answer.regex',
      'answer.caseSensitive',
      'normalize.trim',
      'normalize.collapseWhitespace',
      'hints[].text',
      'hints[].narration.text',
      'hints[].narration.audioUrl',
      'hints[].narration.durationMs',
      'hints[].narration.cues[].text',
      'hints[].narration.cues[].startMs',
      'scoring.attemptPenalty',
      'scoring.floor',
      'solution.text',
      'solution.explanation',
    ],
  ),
  ORDERING: classify(['prompt', 'items[].id', 'items[].text'], ['scoring', 'explanation']),
  TABS: classify(['tabs[].id', 'tabs[].title', 'tabs[].content', 'requiredTabs[]'], []),
  SUMMARY: classify(['text'], []),
};

// Walidacja semantyczna (relacje między polami, kompilacja wzorców RE2) jest w semantics.ts: to kod tylko dla Node (natywny
// moduł re2), więc NIE wchodzi do części izomorficznej pakietu (index.ts), importowanej przez apps/web.
