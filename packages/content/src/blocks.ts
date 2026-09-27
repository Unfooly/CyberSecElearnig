import { z } from 'zod';
import { audioPathSchema, baseShape, imagePathSchema, idSchema, narrationSchema, noteSchema, text } from './common';

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

// Warianty media WSPÓLNE dla hotspotu najwyższego poziomu i hotspotu WEWNĄTRZ zagnieżdżonej sceny. B-086: `image`/`document`
// w pełnoekranowym podglądzie, `audio` z WŁASNYM odtwarzaczem (plik to gotowy zasób z --assets, NIE przechodzi przez silnik
// TTS/cues narracji - inny głos niż lektor nagrywa się i publikuje osobno). `transcript` to zwykły tekst (jak `content`), nie
// `narrationSchema` - nie ma tu ani cues, ani spokenText, ani skrótu TTS do policzenia.
const imageMediaSchema = z.object({ kind: z.literal('image'), src: imagePathSchema, alt: text(300) }).strict();
// image: opcjonalne zbliżenie pokazywane NAD własnym odtwarzaczem audio (zamiast natywnych <audio controls> - feedback z
// produkcji po PR #32, PR feat/scene-overlay-fix), publikowane tym samym potokiem --assets co media.src. alt: jak w
// imageMediaSchema - opcjonalny, bo zbliżenie bywa czysto ilustracyjne (treść i tak jest w transkrypcie), ale gdy niesie
// informację NIEOBECNĄ w transkrypcie (np. tekst widoczny na zdjęciu telefonu), autor może ją opisać. `alt` to WSPÓLNA
// ścieżka klasyfikacji z imageMediaSchema (hotspots[].media.alt) - nie potrzeba osobnego wpisu w FIELD_CLASSIFICATION.
// schemaVersion 5 (D-082): nagranie z potoku TTS zamiast gotowego pliku - `narration` (tekst = transkrypcja, zwykle z własnym
// `voice`, np. poczta głosowa głosem "bank") ALBO `audioUrl` + `transcript` (plik z --assets, jak dotąd). Dokładnie jedno z
// audioUrl/narration, a transcript tylko przy audioUrl - przy narration transkrypcją jest narration.text (semantics.ts).
const audioMediaSchema = z
  .object({
    kind: z.literal('audio'),
    audioUrl: audioPathSchema.optional(),
    transcript: text(4000).optional(),
    narration: narrationSchema.optional(),
    image: imagePathSchema.optional(),
    alt: text(300).optional(),
  })
  .strict();
const documentMediaSchema = z.object({ kind: z.literal('document'), title: text(200), lines: z.array(text(300)).min(1).max(30) }).strict();

// Hotspot WEWNĄTRZ zagnieżdżonej sceny (media.kind: 'scene'): jak hotspot najwyższego poziomu, ale BEZ `action` i BEZ
// wariantu media `scene` - limit 1 poziomu zagnieżdżenia wymuszony przez system typów (nie osobną walidacją w runtime).
// Zawsze zachowuje się jak `action: 'card'` (klik otwiera kartę), więc `content` zostaje wymagane, tak jak dziś.
const innerHotspotMediaSchema = z.discriminatedUnion('kind', [imageMediaSchema, audioMediaSchema, documentMediaSchema]);
const innerHotspotSchema = z
  .object({
    id: idSchema,
    label: text(100),
    x: percent,
    y: percent,
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
    content: text(2000),
    media: innerHotspotMediaSchema.optional(),
    narration: baseShape.narration,
    evidence: z.boolean().optional(),
    note: noteSchema.optional(),
    required: z.boolean().optional(),
  })
  .strict();

// Zagnieżdżona mini-scena (B-086): własny obraz i własne hotspoty (innerHotspotSchema) - w module 1 np. pulpit komputera
// zza monitora. Id hotspotów WEWNĄTRZ muszą być unikalne w obrębie CAŁEGO bloku SCENE_HOTSPOTS (razem z zewnętrznymi) i
// mogą nieść evidence/required tak jak zewnętrzne - stan bloku (visited/noted) to jedna, płaska lista id (semantics.ts).
const nestedSceneSchema = z
  .object({
    image: imagePathSchema,
    imageAlt: text(300),
    hotspots: z.array(innerHotspotSchema).min(1).max(20),
  })
  .strict();

// Media hotspotu najwyższego poziomu: jak wewnątrz zagnieżdżonej sceny, plus wariant `scene` (patrz nestedSceneSchema).
const hotspotMediaSchema = z.discriminatedUnion('kind', [
  imageMediaSchema,
  audioMediaSchema,
  documentMediaSchema,
  z.object({ kind: z.literal('scene'), scene: nestedSceneSchema }).strict(),
]);

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
            // 'card' (domyślnie, brak pola liczy się tak samo): klik otwiera kartę (content/media). 'next':
            // "drzwi" - klik KOŃCZY blok (jak przycisk "Dalej" w pasku powłoki), gdy wymagane elementy są już zebrane; taki
            // hotspot nie ma ani content, ani media, ani evidence/note (wzajemnie wykluczające, semantics.ts).
            action: z.enum(['card', 'next']).optional(),
            content: text(2000).optional(),
            media: hotspotMediaSchema.optional(),
            narration: baseShape.narration,
            // schemaVersion 3: dowód w śledztwie (wpis w notatniku po "Zabierz" w zbliżeniu, D-086; wymaga `note` z `kind`) i wymagalność.
            evidence: z.boolean().optional(),
            note: noteSchema.optional(),
            required: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    // PRZESTARZAŁE od schemaVersion 3 (zastąpione `hotspots[].required`); nadal działa. Domyślnie wszystkie. Tylko hotspoty
    // NAJWYŻSZEGO poziomu (zagnieżdżona scena jest nowsza niż ta lista, więc nigdy jej nie dotyczy).
    requiredHotspots: z.array(idSchema).max(20).optional(),
  })
  .strict();

const dialogueSchema = z
  .object({
    ...baseShape,
    type: z.literal('DIALOGUE'),
    character: z
      .object({
        name: text(80),
        role: text(120).optional(),
        // avatar: schemaVersion 3, ścieżka względna wobec CONTENT_BASE_URL (klient tylko przez <img>).
        avatar: imagePathSchema.optional(),
        // opening: schemaVersion 4, kwestia wypowiadana PRZED listą pytań (bez narracji na razie - tylko tekst).
        opening: text(300).optional(),
      })
      .strict(),
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

// schemaVersion 4: czysta narracja/tekst bez interakcji (np. otwarcie/przejście fabularne) - ukończony po samym wyświetleniu,
// jak dotychczas SUMMARY, ale NARRATIVE może wystąpić wielokrotnie i w dowolnym miejscu modułu (SUMMARY tylko raz, na końcu).
const narrativeSchema = z
  .object({
    ...baseShape,
    type: z.literal('NARRATIVE'),
    text: text(2000),
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
        // schemaVersion 4: adresat do wyświetlenia w makiecie (pod "Od:") - tekst, nie jest parsowany ani używany jako kotwica
        // kryterium (na to jest criteria[].target); opcjonalny, bo starsze moduły (2/3) go nie mają.
        to: text(200).optional(),
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

// schemaVersion 5: "odprawa" na start modułu - ciąg kroków zamkniętego typu, każdy z własną (opcjonalną) narracją.
// Osobny typ bloku, nie wariant NARRATIVE: struktura (kroki, krok "badge" z danymi z profilu gracza) jest zupełnie inna
// niż jednorazowa narracja NARRATIVE, więc nie warto naciągać jej umowy dla wszystkich pozostałych użyć tego typu.
// Nieoceniany, bez dowodów - zaliczany po ostatnim kroku albo po kliknięciu "Pomiń odprawę" (obsługa w apps/web, D-081).
// Grafika kroku odprawy (feat/briefing-scenes, D-084, addytywnie w v5): scena 16:9 zamiast karty na jasnym tle. `image` - tło
// kroku (plik z assets/ modułu, potok --assets; animacje CSS w SVG zatrzymuje odtwarzacz fragmentem #static przy reduced-motion),
// `hotspot` - prostokąt na scenie, którego klik = `cta` kroku (przycisk cta zostaje dla klawiatury i czytników ekranu), `slots` -
// miejsca na scenie (w % sceny), w które odtwarzacz wstawia HTML: zadania sprawy (`tasks`), dane gracza z sesji (`name`, `number`,
// `photo`). Prostokąty w 0-100 i w granicach sceny, zgodność pól z rodzajem kroku - semantics.ts.
const briefingRectSchema = z.object({ x: percent, y: percent, w: z.number().gt(0).max(100), h: z.number().gt(0).max(100) }).strict();
const briefingSceneShape = {
  image: imagePathSchema.optional(),
  hotspot: briefingRectSchema.extend({ id: idSchema }).strict().optional(),
  slots: z
    .object({
      tasks: briefingRectSchema.optional(),
      name: briefingRectSchema.optional(),
      number: briefingRectSchema.optional(),
      photo: briefingRectSchema.optional(),
    })
    .strict()
    .optional(),
};

const briefingStepSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('typewriter'),
      text: text(300),
      sub: text(300).optional(),
      cta: text(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
    })
    .strict(),
  z
    .object({
      kind: z.literal('call'),
      // Kto dzwoni: postać zapisana w treści (jak DIALOGUE.character - moduł nie ma wspólnego rejestru postaci). Bez avatara
      // klient pokazuje inicjały z `name` (na accent-soft). Maskotki tu nie ma (decyzja właściciela, D-081: maskotka wychodzi
      // z odtwarzacza - refactor/remove-mascot-player).
      caller: z
        .object({
          name: text(80),
          role: text(120).optional(),
          avatar: imagePathSchema.optional(),
        })
        .strict(),
      text: text(500),
      cta: text(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
    })
    .strict(),
  // caseFile: karta sprawy z zadaniami sprawy (`tasks`) - te same zadania pokazuje sekcja "Zadania" notatnika przez cały
  // moduł (czyta je z bloku BRIEFING bieżącej wersji treści, D-081). `completeWhen`: zadanie odhacza KLIENT, gdy wszystkie
  // wskazane bloki są ukończone (progress) - to nie ocena. Id muszą istnieć w module i nie mogą wskazywać bloku BRIEFING
  // (pominięcie odprawy nie odhacza zadań) - semantics.ts. Cele szkoleniowe modułu (`objectives`) to osobna lista tekstów.
  z
    .object({
      kind: z.literal('caseFile'),
      caseNo: text(30),
      title: text(120),
      fields: z.array(z.object({ label: text(60), value: text(200) }).strict()).min(1).max(8),
      stamp: text(30).optional(),
      tasks: z
        .array(z.object({ id: idSchema, text: text(200), completeWhen: z.array(idSchema).min(1).max(10) }).strict())
        .max(6)
        .optional(),
      cta: text(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
      // Dwie fazy (D-084): zamknięta teczka (`closedImage`, klik w `hotspot` ją otwiera) -> otwarte akta (`image`, crossfade,
      // bez animacji przy reduced-motion). Przy closedImage `hotspot` dotyczy fazy zamkniętej, a `openHotspot` (D-086) - otwartych akt:
      // klik zamyka teczkę i przechodzi dalej (etykieta = `cta`).
      closedImage: imagePathSchema.optional(),
      openHotspot: briefingRectSchema.extend({ id: idSchema }).strict().optional(),
    })
    .strict(),
  // badge: legitymacja gracza. Bez żadnych danych osobowych w treści - imię, avatar i numer odznaki liczy WYŁĄCZNIE
  // klient z sesji (apps/web, BriefingBlock.tsx), nigdy z module.json ani z progress.
  z
    .object({
      kind: z.literal('badge'),
      cta: text(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
    })
    .strict(),
  // start: ostatni ekran odprawy - miejsce akcji (np. "Unfooly, drugie piętro.") i przycisk rozpoczęcia śledztwa.
  z
    .object({
      kind: z.literal('start'),
      text: text(200),
      cta: text(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
    })
    .strict(),
]);

const briefingSchema = z
  .object({
    ...baseShape,
    type: z.literal('BRIEFING'),
    steps: z.array(briefingStepSchema).min(1).max(8),
  })
  .strict();

// schemaVersion 5: "teczka sprawy" (D-083) - dokumenty (przekładki) z wierszami tabeli. Zastępuje w module 1 akta w TABS: tam
// zakładka była tekstem, tu dokument to tabela, a wiersz może być DOWODEM (zakreślenie dopisuje notatkę do notatnika tą samą
// ścieżką co hotspot: klucz `<blockId>.<rowId>`). Jak SCENE_HOTSPOTS, `evidence`/`note`/`required` są polami client: blok jest
// eksploracyjny, nie oceniany - klient i tak musi wiedzieć, który wiersz jest dowodem, żeby pokazać "zwykłą operację"
// dla pozostałych. Id dokumentów i wierszy są unikalne w całym bloku (semantics.ts); liczba komórek = liczba kolumn.
const dossierRowSchema = z
  .object({
    id: idSchema,
    cells: z.array(text(300)).min(1).max(4),
    evidence: z.boolean().optional(),
    note: noteSchema.optional(),
    required: z.boolean().optional(),
    // Komunikat po kliknięciu ZWYKŁEJ linijki (domyślnie „Ta linijka wygląda na zwykłą operację.”) - np. naprowadzenie, gdy wiersz
    // pokazuje fakt znany już z innej sceny. Tylko bez evidence (semantics.ts); publiczny jak reszta wiersza.
    message: text(200).optional(),
  })
  .strict();

const dossierSchema = z
  .object({
    ...baseShape,
    type: z.literal('DOSSIER'),
    // Pieczątka na teczce (np. "POUFNE").
    stamp: text(30).optional(),
    documents: z
      .array(
        z
          .object({
            id: idSchema,
            // Napis na przekładce.
            tab: text(40),
            // Nagłówek arkusza: wystawca (np. "UNFOOLY SP. Z O.O. · DZIAŁ IT"), tytuł i metryka (autor, data, konto).
            org: text(80),
            title: text(120),
            meta: text(200).optional(),
            columns: z.array(text(40)).min(1).max(4),
            rows: z.array(dossierRowSchema).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(6),
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
  NARRATIVE: narrativeSchema,
  EMAIL_ANALYSIS: emailAnalysisSchema,
  TEXT_INPUT_GUIDED: textInputSchema,
  ORDERING: orderingSchema,
  TABS: tabsSchema,
  SUMMARY: summarySchema,
  BRIEFING: briefingSchema,
  DOSSIER: dossierSchema,
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
  narrativeSchema,
  emailAnalysisSchema,
  textInputSchema,
  orderingSchema,
  tabsSchema,
  summarySchema,
  briefingSchema,
  dossierSchema,
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
  NARRATIVE: 0,
  EMAIL_ANALYSIS: 1,
  TEXT_INPUT_GUIDED: 1,
  ORDERING: 1,
  TABS: 0,
  SUMMARY: 0,
  BRIEFING: 0,
  DOSSIER: 0,
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
  // reactions.complete (schemaVersion 4): zdarzenie "blok ukończony", wywoływane przez klienta - nie zdradza niczego.
  'reactions.complete.pose',
  'reactions.complete.text',
];
const BASE_SECRET = [
  'weight',
  // reactions.result (schemaVersion 4): progi/teksty reakcji na WYNIK bloku ocenianego - zdradzałyby próg oceny przed
  // odpowiedzią, więc SEKRET; dociera do klienta dopiero w /attempt i /progress (evaluate.ts pickReaction), nigdy w /start.
  'reactions.result[].pose',
  'reactions.result[].text',
  'reactions.result[].when',
  'reactions.result[].minScore',
  // narration.spokenText: wyłącznie wejście skryptu TTS (common.ts, narrationSchema) - odtwarzacz go nie czyta (napisy zawsze
  // z narration.text), więc nie ma powodu wysyłać go do klienta. SEKRET tu znaczy tylko "niepotrzebne klientowi", nie "klucz
  // odpowiedzi" - tak samo jak EMBEDDED_HTML.html niżej.
  'narration.spokenText',
  // narration.voice (schemaVersion 5, D-082): rola głosu dla skryptu TTS - odtwarzacz jej nie potrzebuje, jak spokenText.
  'narration.voice',
];

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
      'hotspots[].action',
      'hotspots[].content',
      'hotspots[].media.kind',
      'hotspots[].media.src',
      'hotspots[].media.alt',
      'hotspots[].media.audioUrl',
      'hotspots[].media.transcript',
      // schemaVersion 5: nagranie media audio z potoku TTS (D-082) - te same pola co narracja bloku.
      'hotspots[].media.narration.text',
      'hotspots[].media.narration.audioUrl',
      'hotspots[].media.narration.durationMs',
      'hotspots[].media.narration.cues[].text',
      'hotspots[].media.narration.cues[].startMs',
      'hotspots[].media.image',
      'hotspots[].media.title',
      'hotspots[].media.lines[]',
      'hotspots[].media.scene.image',
      'hotspots[].media.scene.imageAlt',
      'hotspots[].media.scene.hotspots[].id',
      'hotspots[].media.scene.hotspots[].label',
      'hotspots[].media.scene.hotspots[].x',
      'hotspots[].media.scene.hotspots[].y',
      'hotspots[].media.scene.hotspots[].width',
      'hotspots[].media.scene.hotspots[].height',
      'hotspots[].media.scene.hotspots[].content',
      'hotspots[].media.scene.hotspots[].media.kind',
      'hotspots[].media.scene.hotspots[].media.src',
      'hotspots[].media.scene.hotspots[].media.alt',
      'hotspots[].media.scene.hotspots[].media.audioUrl',
      'hotspots[].media.scene.hotspots[].media.transcript',
      'hotspots[].media.scene.hotspots[].media.narration.text',
      'hotspots[].media.scene.hotspots[].media.narration.audioUrl',
      'hotspots[].media.scene.hotspots[].media.narration.durationMs',
      'hotspots[].media.scene.hotspots[].media.narration.cues[].text',
      'hotspots[].media.scene.hotspots[].media.narration.cues[].startMs',
      'hotspots[].media.scene.hotspots[].media.image',
      'hotspots[].media.scene.hotspots[].media.title',
      'hotspots[].media.scene.hotspots[].media.lines[]',
      'hotspots[].media.scene.hotspots[].narration.text',
      'hotspots[].media.scene.hotspots[].narration.audioUrl',
      'hotspots[].media.scene.hotspots[].narration.durationMs',
      'hotspots[].media.scene.hotspots[].narration.cues[].text',
      'hotspots[].media.scene.hotspots[].narration.cues[].startMs',
      'hotspots[].media.scene.hotspots[].evidence',
      'hotspots[].media.scene.hotspots[].note.text',
      'hotspots[].media.scene.hotspots[].note.kind',
      'hotspots[].media.scene.hotspots[].required',
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
    [
      'hotspots[].narration.spokenText',
      'hotspots[].narration.voice',
      'hotspots[].media.scene.hotspots[].narration.spokenText',
      'hotspots[].media.scene.hotspots[].narration.voice',
      'hotspots[].media.narration.spokenText',
      'hotspots[].media.narration.voice',
      'hotspots[].media.scene.hotspots[].media.narration.spokenText',
      'hotspots[].media.scene.hotspots[].media.narration.voice',
    ],
  ),
  DIALOGUE: classify(
    [
      'character.name',
      'character.role',
      'character.avatar',
      // opening: schemaVersion 4, kwestia otwierająca przed listą pytań.
      'character.opening',
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
    [
      'questions[].lines[].narration.spokenText',
      'questions[].lines[].narration.voice',
      'questions[].answerNarration.spokenText',
      'questions[].answerNarration.voice',
    ],
  ),
  NOTEPAD: classify(['prompt'], []),
  NARRATIVE: classify(['text'], []),
  EMAIL_ANALYSIS: classify(
    [
      'email.fromName',
      'email.fromAddress',
      // to: schemaVersion 4, patrz komentarz przy schemacie (blocks.ts, emailAnalysisSchema).
      'email.to',
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
      'hints[].narration.spokenText',
      'hints[].narration.voice',
      'scoring.attemptPenalty',
      'scoring.floor',
      'solution.text',
      'solution.explanation',
    ],
  ),
  ORDERING: classify(['prompt', 'items[].id', 'items[].text'], ['scoring', 'explanation']),
  TABS: classify(['tabs[].id', 'tabs[].title', 'tabs[].content', 'requiredTabs[]'], []),
  SUMMARY: classify(['text'], []),
  BRIEFING: classify(
    [
      'steps[].kind',
      'steps[].text',
      'steps[].sub',
      'steps[].cta',
      'steps[].caller.name',
      'steps[].caller.role',
      'steps[].caller.avatar',
      'steps[].caseNo',
      'steps[].title',
      'steps[].fields[].label',
      'steps[].fields[].value',
      'steps[].stamp',
      // Zadania sprawy: tekst i id bloków do odhaczenia - id bloków klient i tak zna z contentBlocks, nic tu nie jest sekretem.
      'steps[].tasks[].id',
      'steps[].tasks[].text',
      'steps[].tasks[].completeWhen[]',
      'steps[].narration.text',
      'steps[].narration.audioUrl',
      'steps[].narration.durationMs',
      'steps[].narration.cues[].text',
      'steps[].narration.cues[].startMs',
      // Grafika kroku (D-084): obrazy sceny i prostokąty (hotspot, sloty) - układ, nic tu nie jest sekretem.
      'steps[].image',
      'steps[].closedImage',
      'steps[].hotspot.id',
      'steps[].hotspot.x',
      'steps[].hotspot.y',
      'steps[].hotspot.w',
      'steps[].hotspot.h',
      'steps[].openHotspot.id',
      'steps[].openHotspot.x',
      'steps[].openHotspot.y',
      'steps[].openHotspot.w',
      'steps[].openHotspot.h',
      ...['tasks', 'name', 'number', 'photo'].flatMap((slot) => ['x', 'y', 'w', 'h'].map((axis) => `steps[].slots.${slot}.${axis}`)),
    ],
    ['steps[].narration.spokenText', 'steps[].narration.voice'],
  ),
  // Wszystko client - jak hotspoty SCENE_HOTSPOTS (evidence/note/required też): blok eksploracyjny, bez klucza odpowiedzi.
  DOSSIER: classify(
    [
      'stamp',
      'documents[].id',
      'documents[].tab',
      'documents[].org',
      'documents[].title',
      'documents[].meta',
      'documents[].columns[]',
      'documents[].rows[].id',
      'documents[].rows[].cells[]',
      'documents[].rows[].evidence',
      'documents[].rows[].note.text',
      'documents[].rows[].note.kind',
      'documents[].rows[].required',
      'documents[].rows[].message',
    ],
    [],
  ),
};

// Walidacja semantyczna (relacje między polami, kompilacja wzorców RE2) jest w semantics.ts: to kod tylko dla Node (natywny
// moduł re2), więc NIE wchodzi do części izomorficznej pakietu (index.ts), importowanej przez apps/web.
