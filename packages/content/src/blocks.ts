import { z } from 'zod';
import { ID_PATTERN, audioPathSchema, baseShape, imagePathSchema, idSchema, ltext, narrationSchema, noteSchema, text, textLayerSchema } from './common';
import { Delocalize } from './localize';

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
    text: ltext(500),
    // QUIZ używa `correct`, BRANCHING_SCENARIO `outcome` (jak w dokumencie) - dokładnie jedno z dwóch.
    correct: z.boolean().optional(),
    outcome: z.enum(['correct', 'wrong']).optional(),
    feedback: ltext(1000).optional(),
  })
  .strict();

const quizSchema = z
  .object({
    ...baseShape,
    type: z.literal('QUIZ'),
    prompt: ltext(1000),
    options: z.array(choiceOptionSchema).min(2).max(8),
    // Tryb prosty (D-132): podpowiedź po 2 błędnych kliknięciach w bloku - sekret, przychodzi z odpowiedzi /check.
    hint: ltext(140).optional(),
  })
  .strict();

const branchingSchema = z
  .object({
    ...baseShape,
    type: z.literal('BRANCHING_SCENARIO'),
    prompt: ltext(1000),
    options: z.array(choiceOptionSchema).min(2).max(8),
  })
  .strict();

const dragAndDropSchema = z
  .object({
    ...baseShape,
    type: z.literal('DRAG_AND_DROP'),
    prompt: ltext(500).optional(),
    items: z.array(z.object({ text: ltext(300) }).strict()).min(1).max(30),
    categories: z.tuple([ltext(60), ltext(60)]).optional(),
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
// imagePortrait (D-104, opcjonalne): wariant grafiki dla telefonu w pionie (kontener sceny < 0.8) - np. okno maila z dużym, zawijanym
// tekstem zamiast poziomego zrzutu; odtwarzacz wybiera go sam, `alt` wspólny (ta sama treść).
// textLayer (schemaVersion 6, common.ts): tekst rysowany przez odtwarzacz na zbliżeniu zamiast wypalonego w grafice.
const imageMediaSchema = z
  .object({
    kind: z.literal('image'),
    src: imagePathSchema,
    imagePortrait: imagePathSchema.optional(),
    alt: ltext(300),
    textLayer: textLayerSchema.optional(),
  })
  .strict();
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
    transcript: ltext(4000).optional(),
    narration: narrationSchema.optional(),
    image: imagePathSchema.optional(),
    alt: ltext(300).optional(),
  })
  .strict();
const documentMediaSchema = z.object({ kind: z.literal('document'), title: ltext(200), lines: z.array(ltext(300)).min(1).max(30) }).strict();
// Easter egg (Q, D-100): seria komiksowych okienek („wirusy”, „wygrana”, „okup”) zamykanych tylko krzyżykiem, po nich `outro` i
// opcjonalne ukryte wyróżnienie w notatniku. Nie jest dowodem (semantics.ts: bez evidence/note/required) i nie zmienia wyniku ani XP -
// serwer zapisuje tylko flagę wyróżnienia (progress, `easterEggs`). `behavior: 'dodge'` - przycisk ucieka przed kursorem (2 razy, nie na
// dotyku); `countdown` - kosmetyczne odliczanie w dół (GG:MM:SS). Treść okienek to fikcja szkoleniowa, bez imitacji prawdziwych okien.
const popupItemSchema = z
  .object({
    title: ltext(80),
    body: ltext(200),
    button: ltext(60),
    behavior: z.enum(['dodge', 'none']).optional(),
    countdown: z.string().regex(/^\d{1,2}:[0-5]\d:[0-5]\d$/, 'format GG:MM:SS').optional(),
  })
  .strict();
const popupsMediaSchema = z
  .object({
    kind: z.literal('popups'),
    items: z.array(popupItemSchema).min(1).max(5),
    outro: ltext(400),
    badge: z.object({ id: idSchema, label: ltext(60) }).strict().optional(),
  })
  .strict();

// Hotspot WEWNĄTRZ zagnieżdżonej sceny (media.kind: 'scene'): jak hotspot najwyższego poziomu, ale BEZ `action` i BEZ
// wariantu media `scene` - limit 1 poziomu zagnieżdżenia wymuszony przez system typów (nie osobną walidacją w runtime).
// Zawsze zachowuje się jak `action: 'card'` (klik otwiera kartę), więc `content` zostaje wymagane, tak jak dziś.
const innerHotspotMediaSchema = z.discriminatedUnion('kind', [imageMediaSchema, audioMediaSchema, documentMediaSchema, popupsMediaSchema]);
const innerHotspotSchema = z
  .object({
    id: idSchema,
    label: ltext(100),
    x: percent,
    y: percent,
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
    content: ltext(2000),
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
    imageAlt: ltext(300),
    textLayer: textLayerSchema.optional(),
    // Ekran monitora w % grafiki (D-116, addytywnie w v5; slot-ekran kompozytora): okienka easter egga pojawiają się wyłącznie w nim.
    screen: z.object({ x: percent, y: percent, w: z.number().gt(0).max(100), h: z.number().gt(0).max(100) }).strict().optional(),
    hotspots: z.array(innerHotspotSchema).min(1).max(20),
  })
  .strict();

// Media hotspotu najwyższego poziomu: jak wewnątrz zagnieżdżonej sceny, plus wariant `scene` (patrz nestedSceneSchema).
const hotspotMediaSchema = z.discriminatedUnion('kind', [
  imageMediaSchema,
  audioMediaSchema,
  documentMediaSchema,
  popupsMediaSchema,
  z.object({ kind: z.literal('scene'), scene: nestedSceneSchema }).strict(),
]);

const hotspotsSchema = z
  .object({
    ...baseShape,
    type: z.literal('SCENE_HOTSPOTS'),
    image: imagePathSchema,
    imageAlt: ltext(300),
    // Wariant pionowy sceny (D-116, addytywnie w v5): na telefonie w pionie (kontener sceny < 0.8, jak D-098) odtwarzacz pokazuje tę
    // grafikę w całości ("contain", bez panoramy) z prostokątami `portraitHotspots` - te same id co `hotspots` (najwyższego poziomu),
    // prostokąty w % pionowej grafiki. Bez wariantu - panorama jak dotąd. `imageAlt` wspólny (ta sama scena).
    imagePortrait: imagePathSchema.optional(),
    portraitHotspots: z
      .array(z.object({ id: idSchema, x: percent, y: percent, width: z.number().min(1).max(100), height: z.number().min(1).max(100) }).strict())
      .min(1)
      .max(20)
      .optional(),
    // schemaVersion 6: tekst sceny w warstwie (szyldy, podpisy) - common.ts textLayerSchema.
    textLayer: textLayerSchema.optional(),
    hotspots: z
      .array(
        z
          .object({
            id: idSchema,
            label: ltext(100),
            // Prostokąt w procentach obrazu.
            x: percent,
            y: percent,
            width: z.number().min(1).max(100),
            height: z.number().min(1).max(100),
            // 'card' (domyślnie, brak pola liczy się tak samo): klik otwiera kartę (content/media). 'next':
            // "drzwi" - klik KOŃCZY blok (jak przycisk "Dalej" w pasku powłoki), gdy wymagane elementy są już zebrane; taki
            // hotspot nie ma ani content, ani media, ani evidence/note (wzajemnie wykluczające, semantics.ts).
            action: z.enum(['card', 'next']).optional(),
            content: ltext(2000).optional(),
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
        name: ltext(80),
        role: ltext(120).optional(),
        // avatar: schemaVersion 3, ścieżka względna wobec CONTENT_BASE_URL (klient tylko przez <img>).
        avatar: imagePathSchema.optional(),
        // opening: schemaVersion 4, kwestia wypowiadana PRZED listą pytań (bez narracji na razie - tylko tekst).
        opening: ltext(300).optional(),
      })
      .strict(),
    questions: z
      .array(
        z
          .object({
            id: idSchema,
            text: ltext(300),
            // Odpowiedź jako jeden tekst ALBO kwestie wypowiadane po kolei (schemaVersion 3): dokładnie jedno z nich (semantics.ts).
            answer: ltext(2000).optional(),
            lines: z
              .array(z.object({ text: ltext(600), narration: narrationSchema.optional() }).strict())
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
    prompt: ltext(500).optional(),
  })
  .strict();

// schemaVersion 4: czysta narracja/tekst bez interakcji (np. otwarcie/przejście fabularne) - ukończony po samym wyświetleniu,
// jak dotychczas SUMMARY, ale NARRATIVE może wystąpić wielokrotnie i w dowolnym miejscu modułu (SUMMARY tylko raz, na końcu).
const narrativeSchema = z
  .object({
    ...baseShape,
    type: z.literal('NARRATIVE'),
    text: ltext(2000),
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
        fromName: ltext(120),
        fromAddress: ltext(200),
        // schemaVersion 4: adresat do wyświetlenia w makiecie (pod "Od:") - tekst, nie jest parsowany ani używany jako kotwica
        // kryterium (na to jest criteria[].target); opcjonalny, bo starsze moduły (2/3) go nie mają.
        to: ltext(200).optional(),
        subject: ltext(300),
        body: ltext(4000),
        // schemaVersion 3: wygląd prawdziwego klienta pocztowego. Data to tekst do wyświetlenia (nie jest parsowana), załącznik to
        // element klikalny w makiecie, ale bez pobierania (nie ma adresu pliku).
        date: ltext(60).optional(),
        attachment: z.object({ name: ltext(120), size: ltext(30).optional() }).strict().optional(),
        // `url` to tylko PODGLĄD adresu (wyświetlany w dymku jak pasek statusu przeglądarki, nigdy nie nawiguje).
        links: z.array(z.object({ id: idSchema, text: ltext(200), url: text(500) }).strict()).max(10),
      })
      .strict(),
    prompt: ltext(500).optional(),
    criteria: z
      .array(
        z
          .object({
            id: idSchema,
            label: ltext(300),
            correct: z.boolean(),
            explanation: ltext(1000).optional(),
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
                quote: ltext(200).optional(),
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
    prompt: ltext(1000),
    placeholder: ltext(100).optional(),
    // Oprawa pola (feat/browser-evidence): 'browser' = pole jako pasek adresu w oknie przeglądarki (zadanie „wpisz adres/domenę”).
    // Czysto wizualne - ocena bez zmian (serwer). Po poprawnej odpowiedzi okno pokazuje ostrzeżenie o stronie podszywającej się pod
    // bank (bez formularzy); tekst jest stały w odtwarzaczu, więc pole nie niesie żadnej treści zadania.
    frame: z.enum(['browser']).optional(),
    answer: z
      .object({
        // Odpowiedzi i wzorzec zostają jednojęzyczne w schemaVersion 6 (ocena per język przypisania - faza EN, rozdz. 10 specyfikacji
        // modułu 2); treść zadania (prompt, podpowiedzi, rozwiązanie) jest już wielojęzyczna.
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
    hints: z.array(z.object({ text: ltext(500), narration: baseShape.narration }).strict()).max(9).default([]),
    maxAttempts: z.number().int().min(1).max(10).default(4),
    scoring: z
      .object({
        attemptPenalty: z.number().min(0).max(1).default(0.25),
        floor: z.number().min(0).max(1).default(0.25),
      })
      .strict()
      .default({}),
    solution: z.object({ text: ltext(300), explanation: ltext(1000).optional() }).strict(),
  })
  .strict();

const orderingSchema = z
  .object({
    ...baseShape,
    type: z.literal('ORDERING'),
    prompt: ltext(500),
    // Elementy w POPRAWNEJ kolejności - klient dostaje je przetasowane (sekret serwera), patrz client.ts.
    // Co najmniej 3: przy 2 elementach jedyna "przetasowana" kolejność jest odwrotnością poprawnej, a nawet losowa zdradzałaby
    // odpowiedź z prawdopodobieństwem 1/2 bez żadnej wiedzy.
    items: z.array(z.object({ id: idSchema, text: ltext(300) }).strict()).min(3).max(12),
    scoring: z.enum(['partial', 'exact']).default('partial'),
    explanation: ltext(1000).optional(),
    // Tablica śledcza (feat/evidence-board, D-088, addytywnie w v5): "zdjęcia" na początku i końcu łańcucha (np. ofiara i strata) -
    // sam opis, nie element oceniany (nie zdradza kolejności kroków).
    start: z.object({ label: ltext(40), caption: ltext(60) }).strict().optional(),
    end: z.object({ label: ltext(40), caption: ltext(60) }).strict().optional(),
  })
  .strict();

const tabsSchema = z
  .object({
    ...baseShape,
    type: z.literal('TABS'),
    tabs: z.array(z.object({ id: idSchema, title: ltext(60), content: ltext(3000) }).strict()).min(1).max(10),
    requiredTabs: z.array(idSchema).max(10).optional(),
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

// Podsumowanie modułu. Zamknięcie sprawy (feat/case-closed, D-089, addytywnie w v5): `lessons` - wnioski śledczego wpisywane w raport
// (linijka po linijce), `closing` - grafika ekranu zamknięcia: raport w teczce (scena 16:9), pieczęć i liścik komisarza (osobne pliki,
// wlatują na raport) oraz sloty HTML w % sceny (liczby, wnioski, podpis gracza, miejsce pieczęci i liściku).
const closingSlotsSchema = z
  .object({
    evidence: briefingRectSchema,
    time: briefingRectSchema,
    xp: briefingRectSchema,
    lessons: briefingRectSchema,
    signature: briefingRectSchema,
    stamp: briefingRectSchema,
    note: briefingRectSchema,
  })
  .strict();

const summarySchema = z
  .object({
    ...baseShape,
    type: z.literal('SUMMARY'),
    text: ltext(2000).optional(),
    lessons: z.array(ltext(120)).min(1).max(5).optional(),
    closing: z
      .object({
        image: imagePathSchema,
        stamp: imagePathSchema,
        note: imagePathSchema,
        slots: closingSlotsSchema,
        // Wariant pionowy (feat/portrait-scenes, D-098, addytywnie w v5): raport 9:16 dla telefonu w pionie - ten sam zestaw slotów
        // w % pionowej sceny. Pieczęć i liścik te same pliki (wlatują w sloty stamp/note). Bez `portrait` - panorama raportu 16:9 (D-089).
        portrait: z.object({ image: imagePathSchema, slots: closingSlotsSchema }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const briefingSlotsSchema = z
  .object({
    tasks: briefingRectSchema.optional(),
    name: briefingRectSchema.optional(),
    number: briefingRectSchema.optional(),
    photo: briefingRectSchema.optional(),
  })
  .strict();
const briefingHotspotSchema = briefingRectSchema.extend({ id: idSchema }).strict();
// Wariant pionowy sceny kroku (feat/portrait-scenes, D-098, addytywnie w v5): na scenie o proporcjach < 0.8 (telefon w pionie)
// odtwarzacz bierze pionową grafikę (9:16) i jej prostokąty; bez `portrait` - scena 16:9 w pasach (jak dotąd). Te same pola co scena
// pozioma: `closedImage`/`openHotspot` tylko przy dwóch fazach teczki (caseFile); zgodność z polami poziomymi - semantics.ts.
const briefingPortraitSchema = z
  .object({
    image: imagePathSchema,
    closedImage: imagePathSchema.optional(),
    hotspot: briefingHotspotSchema.optional(),
    openHotspot: briefingHotspotSchema.optional(),
    slots: briefingSlotsSchema.optional(),
  })
  .strict();
const briefingSceneShape = {
  image: imagePathSchema.optional(),
  hotspot: briefingHotspotSchema.optional(),
  slots: briefingSlotsSchema.optional(),
  portrait: briefingPortraitSchema.optional(),
};

const briefingStepSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('typewriter'),
      text: ltext(300),
      sub: ltext(300).optional(),
      cta: ltext(60),
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
          name: ltext(80),
          role: ltext(120).optional(),
          avatar: imagePathSchema.optional(),
        })
        .strict(),
      text: ltext(500),
      cta: ltext(60),
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
      title: ltext(120),
      fields: z.array(z.object({ label: ltext(60), value: ltext(200) }).strict()).min(1).max(8),
      stamp: ltext(30).optional(),
      tasks: z
        .array(z.object({ id: idSchema, text: ltext(200), completeWhen: z.array(idSchema).min(1).max(10) }).strict())
        .max(6)
        .optional(),
      cta: ltext(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
      // Dwie fazy (D-084): zamknięta teczka (`closedImage`, klik w `hotspot` ją otwiera) -> otwarte akta (`image`, crossfade,
      // bez animacji przy reduced-motion). Przy closedImage `hotspot` dotyczy fazy zamkniętej, a `openHotspot` (D-086) - otwartych akt:
      // klik zamyka teczkę i przechodzi dalej (etykieta = `cta`).
      closedImage: imagePathSchema.optional(),
      openHotspot: briefingHotspotSchema.optional(),
    })
    .strict(),
  // badge: legitymacja gracza. Bez żadnych danych osobowych w treści - imię, avatar i numer odznaki liczy WYŁĄCZNIE
  // klient z sesji (apps/web, BriefingBlock.tsx), nigdy z module.json ani z progress.
  z
    .object({
      kind: z.literal('badge'),
      cta: ltext(60),
      narration: narrationSchema.optional(),
      ...briefingSceneShape,
    })
    .strict(),
  // start: ostatni ekran odprawy - miejsce akcji (np. "Unfooly, drugie piętro.") i przycisk rozpoczęcia śledztwa.
  z
    .object({
      kind: z.literal('start'),
      text: ltext(200),
      cta: ltext(60),
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
    cells: z.array(ltext(300)).min(1).max(4),
    evidence: z.boolean().optional(),
    note: noteSchema.optional(),
    required: z.boolean().optional(),
    // Komunikat po kliknięciu ZWYKŁEJ linijki (domyślnie „Ta linijka wygląda na zwykłą operację.”) - np. naprowadzenie, gdy wiersz
    // pokazuje fakt znany już z innej sceny. Tylko bez evidence (semantics.ts); publiczny jak reszta wiersza.
    message: ltext(200).optional(),
  })
  .strict();

// Dokument teczki (przekładka z tabelą) - ten sam kształt w DOSSIER i w konsoli przesłuchania (INTERROGATION.documents, D-118).
const dossierDocumentsSchema = z
  .array(
    z
      .object({
        id: idSchema,
        // Napis na przekładce.
        tab: ltext(40),
        // Nagłówek arkusza: wystawca (np. "UNFOOLY SP. Z O.O. · DZIAŁ IT"), tytuł i metryka (autor, data, konto).
        org: ltext(80),
        title: ltext(120),
        meta: ltext(200).optional(),
        columns: z.array(ltext(40)).min(1).max(4),
        rows: z.array(dossierRowSchema).min(1).max(30),
      })
      .strict(),
  )
  .min(1)
  .max(6);

const dossierSchema = z
  .object({
    ...baseShape,
    type: z.literal('DOSSIER'),
    // Pieczątka na teczce (np. "POUFNE").
    stamp: ltext(30).optional(),
    documents: dossierDocumentsSchema,
  })
  .strict();

// --- schemaVersion 6: moduł 2 (vishing, D-115) -------------------------------------------------------------------------

/** Kategorie czerwonych flag nagrania (pokazywane w omówieniu wyniku; w MVP punkt za trafienie w okno, kategoria informacyjna). */
export const RECORDING_FLAG_CATEGORIES = ['urgency', 'authority', 'fear', 'code_request', 'install_request'] as const;

/**
 * Segment nagrania rozmowy: jedna kwestia jednym głosem (`narration.voice` wymagane - semantics.ts), osobne nagranie TTS
 * (`<blockId>#segments.<N>.narration`). `speaker` - podpis w transkrypcji („Karol”, „Dzwoniący”). `gapAfterMs` - cisza po segmencie.
 * Znaczniki czasu liczy klient i serwer tak samo: początek segmentu = suma (durationMs + gapAfterMs) poprzednich (recordingTimeline).
 */
const recordingSegmentSchema = z
  .object({
    id: idSchema,
    speaker: ltext(60),
    narration: narrationSchema,
    gapAfterMs: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

/**
 * Odsłuch nagrania (D-115): gracz stuka „Czerwona flaga” w chwili manipulacji (tryb odsłuchu: `{ atMs }`) albo przy kwestii w
 * transkrypcji (`{ segmentId }`). Okno flagi = [początek segmentu, koniec segmentu + flagWindowAfterMs]. Flagi, okno, kara i dowody
 * są SEKRETEM - klient zna tylko segmenty; ocenę liczy serwer (apps/api scoring/recording.ts).
 */
const callRecordingSchema = z
  .object({
    ...baseShape,
    type: z.literal('CALL_RECORDING'),
    segments: z.array(recordingSegmentSchema).min(2).max(40),
    flags: z
      .array(z.object({ segmentId: idSchema, category: z.enum(RECORDING_FLAG_CATEGORIES) }).strict())
      .min(1)
      .max(20),
    flagWindowAfterMs: z.number().int().min(0).max(10_000).optional(),
    falseTapPenalty: z.number().min(0).max(1).optional(),
    // Dowód dopisywany do notatnika, gdy flaga na jego segmencie została trafiona (segmentId - segment z flagą, semantics.ts).
    evidence: z.array(z.object({ id: idSchema, segmentId: idSchema, note: noteSchema }).strict()).min(1).max(10).optional(),
  })
  .strict();

/**
 * Omówienie z adnotacjami (D-115): numerowane znaczniki 1..N na transkrypcji nagrania z bloku CALL_RECORDING tego modułu
 * (`source.kind: transcript`, kotwica `segmentId`) albo na grafice (`source.kind: image`, kotwica `{ x, y }` w %). Nieoceniane,
 * wszystko publiczne (omówienie po ocenie nagrania); ukończone po przejściu wszystkich znaczników (`{ seen: N }`).
 */
const replayMarkerSchema = z
  .object({
    n: z.number().int().min(1).max(20),
    anchor: z.object({ segmentId: idSchema.optional(), x: percent.optional(), y: percent.optional() }).strict(),
    title: ltext(80),
    text: ltext(600),
    narration: narrationSchema.optional(),
  })
  .strict();

const annotatedReplaySchema = z
  .object({
    ...baseShape,
    type: z.literal('ANNOTATED_REPLAY'),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('transcript'), fromBlock: idSchema }).strict(),
      z.object({ kind: z.literal('image'), image: imagePathSchema, imagePortrait: imagePathSchema.optional(), alt: ltext(300) }).strict(),
    ]),
    markers: z.array(replayMarkerSchema).min(1).max(12),
  })
  .strict();

/**
 * Przesłuchanie (D-118): postać odpowiada na pytania kwestiami (`lines`, głos postaci w `narration.voice`). Kwestia może być:
 *  - `fragment` - gracz przeciąga ją (albo stuka „Dodaj do notatek”) do notatnika: notatka `<blockId>.<lineId>`, jak hotspot;
 *  - `contradiction` - kłamstwo, które obala dowód z WCZEŚNIEJSZEGO bloku (`refutedBy` = klucz notatki `<blockId>.<itemId>`).
 *    „Podważ” jest przy KAŻDEJ kwestii (klient nie wie, która kłamie); serwer sprawdza wskazany dowód - jedna próba na kwestię
 *    (/challenge). Trafienie odsłania `challengeLine` i dopisuje `note`. Wszystko w `contradiction` jest sekretem.
 * `documents` (opcjonalnie) - konsola z zakładkami w kształcie teczki (DOSSIER), otwierana pytaniem z `opensDocuments: true`.
 * Ocena: trafienia / (sprzeczności + pudła) - pudło kosztuje; blok bez sprzeczności jest nieoceniany (waga 0).
 * `challengeLine` to sam tekst: nagrania trafiają do publicznego magazynu, więc pole secret nie ma audio (scripts/content, D-118).
 */
const interrogationLineSchema = z
  .object({
    id: idSchema,
    text: ltext(600),
    narration: narrationSchema.optional(),
    fragment: z.object({ evidence: z.boolean().optional(), note: noteSchema }).strict().optional(),
    contradiction: z
      .object({
        // Klucz notatki dowodu `<blockId>.<itemId>` (format i istnienie we wcześniejszym bloku - semantics.ts).
        refutedBy: z.string().max(130),
        challengeLine: z.object({ text: ltext(600) }).strict(),
        note: noteSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const interrogationSchema = z
  .object({
    ...baseShape,
    type: z.literal('INTERROGATION'),
    character: z
      .object({
        name: ltext(80),
        role: ltext(120).optional(),
        avatar: imagePathSchema.optional(),
        opening: ltext(300).optional(),
      })
      .strict(),
    questions: z
      .array(
        z
          .object({
            id: idSchema,
            text: ltext(300),
            lines: z.array(interrogationLineSchema).min(1).max(10),
            required: z.boolean().optional(),
            // Pytanie otwiera konsolę (`documents`) - najwyżej jedno i tylko przy documents (semantics.ts).
            opensDocuments: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(15),
    documents: dossierDocumentsSchema.optional(),
  })
  .strict();

/**
 * OSINT (D-120): strona www (grafika bez tekstu + `textLayer`) z obszarami `spots`; gracz zaznacza informacje, które wykorzystał
 * oszust. `used` (czy obszar był użyty), `note` (dowód - wychodzi po ocenie) i `trapText` (wyjaśnienie pułapki) są SEKRETEM; klient zna
 * tylko położenie i podpis obszaru. Ocena: trafione użyte / wszystkie użyte − `falseSpotPenalty` × zaznaczone pułapki (min. 0).
 * `spots[].media` - nagranie przy obszarze (webinar): osobny odtwarzacz z transkrypcją; `secretEnding` - wysłuchanie do końca odsłania
 * ukryte wyróżnienie w notatniku (bramka UX jak easter egg, D-100 - klient zgłasza `heard`, serwer zapisuje flagę; bez punktów i dowodu).
 * Wariant pionowy jak scena (D-116): `imagePortrait` + `portraitSpots` (te same id).
 */
const osintMediaSchema = z
  .object({
    kind: z.literal('audio'),
    title: ltext(120),
    narration: narrationSchema,
    // Kadr odtwarzacza (np. slajd prelekcji) - z opisem (`alt` wymagane przy `image`), wariantem pionowym i tekstem w warstwie (tytuł slajdu).
    image: imagePathSchema.optional(),
    imagePortrait: imagePathSchema.optional(),
    alt: ltext(300).optional(),
    textLayer: textLayerSchema.optional(),
    secretEnding: z.object({ id: idSchema, label: ltext(60), note: ltext(300).optional() }).strict().optional(),
  })
  .strict();

const osintRect = { x: percent, y: percent, w: z.number().gt(0).max(100), h: z.number().gt(0).max(100) };

const osintSpotSchema = z
  .object({
    id: idSchema,
    label: ltext(100),
    ...osintRect,
    used: z.boolean(),
    note: noteSchema.optional(),
    trapText: ltext(300).optional(),
    media: osintMediaSchema.optional(),
  })
  .strict();

const osintSpotBlockSchema = z
  .object({
    ...baseShape,
    type: z.literal('OSINT_SPOT'),
    image: imagePathSchema,
    imagePortrait: imagePathSchema.optional(),
    imageAlt: ltext(300),
    textLayer: textLayerSchema.optional(),
    prompt: ltext(300).optional(),
    spots: z.array(osintSpotSchema).min(2).max(20),
    portraitSpots: z.array(z.object({ id: idSchema, ...osintRect }).strict()).min(2).max(20).optional(),
    falseSpotPenalty: z.number().min(0).max(1).optional(),
  })
  .strict();

/**
 * Rozmowa na żywo (D-122): drzewo rozmowy z dzwoniącym. Węzeł to kwestia dzwoniącego (`narration`, głos postaci) i 2-4 odpowiedzi gracza;
 * `next` to id węzła albo `#<id zakończenia>`, `silence` - krawędź po upływie limitu czasu (`choiceTimeLimitSec`, domyślnie 12 s; bez
 * limitu - ustawienie konta albo przełącznik przed połączeniem - krawędzi `silence` nie ma; węzeł bez `silence` też nie odlicza czasu -
 * cisza nie ma tam dokąd prowadzić). Graf bez cykli, każdy węzeł osiągalny
 * (semantics.ts). Ocena zakończenia (`outcome`: good 1 / partial 0,5 / bad 0) i odpowiedzi z podaniem informacji (`infoChoices`) są
 * SEKRETEM - klient zna tekst zakończenia, ocenę dostaje od serwera. Odpowiedź `{ path: [choiceId | "silence"], timed }` - serwer
 * przechodzi drzewo od `start` i odrzuca ścieżkę niezgodną z grafem.
 */
export const LIVE_CALL_SILENCE = 'silence';
// D-129: odrzucenie połączenia na ekranie przychodzącym (jedyny krok ścieżki) i rozłączenie się w trakcie rozmowy (ostatni krok) -
// pola `reject` / `hangUp` wskazują zakończenie (`#id`, outcome "good"). Rozłączenie PO odpowiedzi z `infoChoices` serwer ocenia jako złe.
export const LIVE_CALL_REJECT = 'reject';
export const LIVE_CALL_HANG_UP = 'hangup';
export const LIVE_CALL_DEFAULT_TIME_LIMIT_SEC = 12;
// `next` / `silence`: id węzła albo `#` + id zakończenia (ten sam wzorzec id co idSchema).
const liveCallTarget = z.string().regex(new RegExp(`^#?${ID_PATTERN.source.slice(1)}`), 'Cel krawędzi: id węzła albo #id zakończenia');

// `reject` / `hangUp`: wyłącznie zakończenie (`#id`).
const liveCallExit = z.string().regex(new RegExp(`^#${ID_PATTERN.source.slice(1)}`), 'Oczekiwane #id zakończenia');

const liveCallNodeSchema = z
  .object({
    id: idSchema,
    narration: narrationSchema,
    choices: z
      .array(z.object({ id: idSchema, text: ltext(200), next: liveCallTarget }).strict())
      .min(2)
      .max(4),
    silence: liveCallTarget.optional(),
  })
  .strict();

const liveCallSchema = z
  .object({
    ...baseShape,
    type: z.literal('LIVE_CALL'),
    caller: z.object({ display: ltext(60), number: z.string().min(1).max(40).optional() }).strict(),
    choiceTimeLimitSec: z.number().int().min(5).max(60).optional(),
    start: idSchema,
    nodes: z.array(liveCallNodeSchema).min(1).max(20),
    endings: z
      .array(z.object({ id: idSchema, outcome: z.enum(['good', 'partial', 'bad']), narration: narrationSchema }).strict())
      .min(2)
      .max(10),
    infoChoices: z.array(idSchema).max(40).optional(),
    reject: liveCallExit.optional(),
    hangUp: liveCallExit.optional(),
  })
  .strict();

/** Werdykt karty SWIPE_SORT (D-132): przesunięcie w lewo = „Podejrzane”, w prawo = „W porządku”. */
export const SWIPE_VERDICTS = ['suspicious', 'ok'] as const;
export type SwipeVerdict = (typeof SWIPE_VERDICTS)[number];

// Segregowanie wiadomości (SWIPE_SORT, moduł 3, D-132): karty-wiadomości (SMS albo komunikator) - gracz ocenia każdą przesunięciem albo
// jednym z dwóch przycisków. `correct` (poprawny werdykt), `feedback` (zdanie po werdykcie) i `hint` (po 2 błędach) są sekretem - werdykt
// sprawdza serwer (/check) przy każdej karcie; klient dostaje karty z nieprzejrzystymi id, przetasowane (client.ts).
const swipeSortSchema = z
  .object({
    ...baseShape,
    type: z.literal('SWIPE_SORT'),
    prompt: ltext(300),
    cards: z
      .array(
        z
          .object({
            id: idSchema,
            channel: z.enum(['sms', 'chat']),
            // Nadawca jak na ekranie telefonu (nazwa kontaktu albo numer), opcjonalnie godzina i załącznik (nazwa pliku).
            from: ltext(60),
            time: z.string().min(1).max(20).optional(),
            text: ltext(300),
            attachment: ltext(80).optional(),
            correct: z.enum(SWIPE_VERDICTS),
            feedback: ltext(140),
          })
          .strict(),
      )
      .min(2)
      .max(12),
    hint: ltext(140).optional(),
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
  CALL_RECORDING: callRecordingSchema,
  ANNOTATED_REPLAY: annotatedReplaySchema,
  INTERROGATION: interrogationSchema,
  OSINT_SPOT: osintSpotBlockSchema,
  LIVE_CALL: liveCallSchema,
  SWIPE_SORT: swipeSortSchema,
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
  callRecordingSchema,
  annotatedReplaySchema,
  interrogationSchema,
  osintSpotBlockSchema,
  liveCallSchema,
  swipeSortSchema,
]);
/** Blok tak, jak jest zapisany w wersji kursu (schemaVersion 6: pola wielojęzyczne jako `{ pl, en? }`). */
export type StoredBlock = z.infer<typeof blockSchema>;
/**
 * Blok ROZWINIĘTY do jednego języka (localizeContent) - kształt, na którym pracuje walidacja semantyczna, ocena i odtwarzacz:
 * zwykłe stringi i płaska narracja, jak w v5.
 */
export type ServerBlock = Delocalize<StoredBlock>;

export type ServerBlockOf<T extends BlockType> = Delocalize<z.infer<(typeof BLOCK_SCHEMAS)[T]>>;

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
  CALL_RECORDING: 1,
  ANNOTATED_REPLAY: 0,
  // Przesłuchanie (D-118): 1, gdy ma sprzeczności; bez sprzeczności nieoceniane (apps/api weightOf i walidacja wagi, semantics.ts).
  INTERROGATION: 1,
  OSINT_SPOT: 1,
  LIVE_CALL: 1,
  SWIPE_SORT: 1,
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
  // tip (D-096): stała podpowiedź bloku, pokazywana od startu - publiczna.
  'tip',
  // mascot.* - przestarzałe (D-096), zostaje dla starszych wersji treści (odtwarzacz czyta mascot.text, gdy brak tip).
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
// Podpowiedź po 2 błędach w trybie prostym (D-132) - tylko QUIZ ma to pole.
const QUIZ_SECRET = [...CHOICE_SECRET, 'hint'];

// Dokumenty teczki (DOSSIER) i konsoli przesłuchania (INTERROGATION.documents) - ten sam kształt, wszystko publiczne (D-083).
const DOSSIER_DOCUMENT_CLIENT = [
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
];

// Ścieżki narracji wysyłane klientowi i sekretne (tylko wejście TTS) - dla narracji pod prefiksem `prefix` (np. `lines[].`).
const narrationClient = (prefix: string) =>
  ['text', 'audioUrl', 'durationMs', 'cues[].text', 'cues[].startMs'].map((key) => `${prefix}narration.${key}`);
const narrationSecret = (prefix: string) => ['spokenText', 'voice'].map((key) => `${prefix}narration.${key}`);

// Warstwa tekstu (schemaVersion 6): treść i układ do narysowania na grafice - publiczne jak `imageAlt`.
const textLayerPaths = (prefix: string) =>
  ['id', 'x', 'y', 'w', 'h', 'text', 'style', 'tone', 'portrait.x', 'portrait.y', 'portrait.w', 'portrait.h'].map((key) => `${prefix}textLayer[].${key}`);

export const FIELD_CLASSIFICATION: Record<BlockType, FieldClassification> = {
  VIDEO: classify(['url', 'durationSeconds'], []),
  QUIZ: classify(['prompt', 'options[].text'], QUIZ_SECRET),
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
      'hotspots[].media.imagePortrait',
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
      // Easter egg (D-100): okienka, outro i wyróżnienie to treść do pokazania (nic do odgadnięcia; znajomość z góry niczego nie daje).
      'hotspots[].media.items[].title',
      'hotspots[].media.items[].body',
      'hotspots[].media.items[].button',
      'hotspots[].media.items[].behavior',
      'hotspots[].media.items[].countdown',
      'hotspots[].media.outro',
      'hotspots[].media.badge.id',
      'hotspots[].media.badge.label',
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
      'hotspots[].media.scene.hotspots[].media.imagePortrait',
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
      'hotspots[].media.scene.hotspots[].media.items[].title',
      'hotspots[].media.scene.hotspots[].media.items[].body',
      'hotspots[].media.scene.hotspots[].media.items[].button',
      'hotspots[].media.scene.hotspots[].media.items[].behavior',
      'hotspots[].media.scene.hotspots[].media.items[].countdown',
      'hotspots[].media.scene.hotspots[].media.outro',
      'hotspots[].media.scene.hotspots[].media.badge.id',
      'hotspots[].media.scene.hotspots[].media.badge.label',
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
      // Na końcu listy: pickByPaths układa klucze odpowiedzi w kolejności pierwszego wystąpienia ścieżki, a odpowiedź /start dla treści
      // bez warstwy tekstu ma zostać bajt w bajt ta sama (module-1-golden.spec.ts).
      ...textLayerPaths(''),
      ...textLayerPaths('hotspots[].media.'),
      ...textLayerPaths('hotspots[].media.scene.'),
      ...textLayerPaths('hotspots[].media.scene.hotspots[].media.'),
      // Wariant pionowy sceny i ekran monitora w scenie zagnieżdżonej (D-116): grafika i układ - nic tu nie jest sekretem.
      ...['x', 'y', 'w', 'h'].map((key) => `hotspots[].media.scene.screen.${key}`),
      'imagePortrait',
      ...['id', 'x', 'y', 'width', 'height'].map((key) => `portraitHotspots[].${key}`),
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
    ['prompt', 'placeholder', 'frame', 'maxAttempts'],
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
  ORDERING: classify(['prompt', 'items[].id', 'items[].text', 'start.label', 'start.caption', 'end.label', 'end.caption'], ['scoring', 'explanation']),
  TABS: classify(['tabs[].id', 'tabs[].title', 'tabs[].content', 'requiredTabs[]'], []),
  SUMMARY: classify(
    [
      'text',
      'lessons[]',
      'closing.image',
      'closing.stamp',
      'closing.note',
      ...['evidence', 'time', 'xp', 'lessons', 'signature', 'stamp', 'note'].flatMap((slot) => ['x', 'y', 'w', 'h'].map((key) => `closing.slots.${slot}.${key}`)),
      // Wariant pionowy (D-098): obraz i sloty - układ, jak wyżej.
      'closing.portrait.image',
      ...['evidence', 'time', 'xp', 'lessons', 'signature', 'stamp', 'note'].flatMap((slot) =>
        ['x', 'y', 'w', 'h'].map((key) => `closing.portrait.slots.${slot}.${key}`),
      ),
    ],
    [],
  ),
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
      // Wariant pionowy kroku (D-098): te same pola sceny w % pionowej grafiki - układ, nic tu nie jest sekretem.
      'steps[].portrait.image',
      'steps[].portrait.closedImage',
      ...['hotspot', 'openHotspot'].flatMap((name) => ['id', 'x', 'y', 'w', 'h'].map((key) => `steps[].portrait.${name}.${key}`)),
      ...['tasks', 'name', 'number', 'photo'].flatMap((slot) => ['x', 'y', 'w', 'h'].map((axis) => `steps[].portrait.slots.${slot}.${axis}`)),
    ],
    ['steps[].narration.spokenText', 'steps[].narration.voice'],
  ),
  // Wszystko client - jak hotspoty SCENE_HOTSPOTS (evidence/note/required też): blok eksploracyjny, bez klucza odpowiedzi.
  DOSSIER: classify(['stamp', ...DOSSIER_DOCUMENT_CLIENT], []),
  // Nagranie (D-115): klient zna segmenty (tekst, podpis, nagranie) - bez nich nie ma odsłuchu ani transkrypcji. Sekret: które segmenty
  // są flagami (i ich kategorie), okno i kara oceny oraz dowody (notatki zdradzałyby flagi; wychodzą po ocenie, jak kryteria maila).
  CALL_RECORDING: classify(
    [
      'segments[].id',
      'segments[].speaker',
      'segments[].gapAfterMs',
      'segments[].narration.text',
      'segments[].narration.audioUrl',
      'segments[].narration.durationMs',
      'segments[].narration.cues[].text',
      'segments[].narration.cues[].startMs',
    ],
    [
      'segments[].narration.spokenText',
      'segments[].narration.voice',
      'flags[].segmentId',
      'flags[].category',
      'flagWindowAfterMs',
      'falseTapPenalty',
      'evidence[].id',
      'evidence[].segmentId',
      'evidence[].note.text',
      'evidence[].note.kind',
    ],
  ),
  // Omówienie (D-115): wszystko publiczne - pokazywane po ocenie nagrania, nic do odgadnięcia.
  ANNOTATED_REPLAY: classify(
    [
      'source.kind',
      'source.fromBlock',
      'source.image',
      'source.imagePortrait',
      'source.alt',
      'markers[].n',
      'markers[].anchor.segmentId',
      'markers[].anchor.x',
      'markers[].anchor.y',
      'markers[].title',
      'markers[].text',
      'markers[].narration.text',
      'markers[].narration.audioUrl',
      'markers[].narration.durationMs',
      'markers[].narration.cues[].text',
      'markers[].narration.cues[].startMs',
    ],
    ['markers[].narration.spokenText', 'markers[].narration.voice'],
  ),
  // Przesłuchanie (D-118): kwestie, fragmenty do notatnika i konsola - publiczne (jak DIALOGUE i DOSSIER). Sekret: sprzeczność w całości
  // (który dowód ją obala, kwestia po podważeniu i jej notatka) - odsłaniana przez /challenge dopiero po trafieniu.
  INTERROGATION: classify(
    [
      'character.name',
      'character.role',
      'character.avatar',
      'character.opening',
      'questions[].id',
      'questions[].text',
      'questions[].required',
      'questions[].opensDocuments',
      'questions[].lines[].id',
      'questions[].lines[].text',
      ...narrationClient('questions[].lines[].'),
      'questions[].lines[].fragment.evidence',
      'questions[].lines[].fragment.note.text',
      'questions[].lines[].fragment.note.kind',
      ...DOSSIER_DOCUMENT_CLIENT,
    ],
    [
      ...narrationSecret('questions[].lines[].'),
      'questions[].lines[].contradiction.refutedBy',
      'questions[].lines[].contradiction.challengeLine.text',
      'questions[].lines[].contradiction.note.text',
      'questions[].lines[].contradiction.note.kind',
    ],
  ),
  // OSINT (D-120): układ strony, podpisy obszarów, nagranie przy obszarze - publiczne. Sekret: który obszar był użyty, dowód (notatka
  // zdradzałaby użycie) i wyjaśnienie pułapki - wychodzą po ocenie; kara za pułapki jak kara nagrania.
  OSINT_SPOT: classify(
    [
      'image',
      'imagePortrait',
      'imageAlt',
      ...textLayerPaths(''),
      'prompt',
      'spots[].id',
      'spots[].label',
      'spots[].x',
      'spots[].y',
      'spots[].w',
      'spots[].h',
      'spots[].media.kind',
      'spots[].media.title',
      'spots[].media.image',
      'spots[].media.imagePortrait',
      'spots[].media.alt',
      ...textLayerPaths('spots[].media.'),
      ...narrationClient('spots[].media.'),
      'spots[].media.secretEnding.id',
      'spots[].media.secretEnding.label',
      'spots[].media.secretEnding.note',
      ...['id', 'x', 'y', 'w', 'h'].map((key) => `portraitSpots[].${key}`),
    ],
    [...narrationSecret('spots[].media.'), 'spots[].used', 'spots[].note.text', 'spots[].note.kind', 'spots[].trapText', 'falseSpotPenalty'],
  ),
  // Rozmowa na żywo (D-122): drzewo, kwestie, odpowiedzi i teksty zakończeń - publiczne (odtwarzacz prowadzi rozmowę bez serwera). Sekret:
  // ocena zakończenia i to, które odpowiedzi oddają informację - wychodzą po ocenie.
  LIVE_CALL: classify(
    [
      'caller.display',
      'caller.number',
      'choiceTimeLimitSec',
      'start',
      'nodes[].id',
      ...narrationClient('nodes[].'),
      'nodes[].choices[].id',
      'nodes[].choices[].text',
      'nodes[].choices[].next',
      'nodes[].silence',
      'endings[].id',
      ...narrationClient('endings[].'),
      'reject',
      'hangUp',
    ],
    [...narrationSecret('nodes[].'), ...narrationSecret('endings[].'), 'endings[].outcome', 'infoChoices[]'],
  ),
  // Segregowanie wiadomości (D-132): treść kart publiczna; werdykt, zdanie po werdykcie i podpowiedź - sekret (odpowiedź /check).
  SWIPE_SORT: classify(
    ['prompt', 'cards[].id', 'cards[].channel', 'cards[].from', 'cards[].time', 'cards[].text', 'cards[].attachment'],
    ['cards[].correct', 'cards[].feedback', 'hint'],
  ),
};

// Walidacja semantyczna (relacje między polami, kompilacja wzorców RE2) jest w semantics.ts: to kod tylko dla Node (natywny
// moduł re2), więc NIE wchodzi do części izomorficznej pakietu (index.ts), importowanej przez apps/web.
