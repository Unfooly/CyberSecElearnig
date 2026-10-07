// Ręcznie odwzorowane DTO z apps/api/src/courses/dto/ - ten sam,
// udokumentowany dług techniczny co przy dashboardzie (patrz README,
// sekcja "Backlog frontendu"). Trzymane tu, w jednym miejscu, żeby biblioteka
// kursów i odtwarzacz nie duplikowały własnych kopii.

import type { Narration } from '@cyberszkolo/content';

export type AssignmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';
export type ContentBlockType =
  | 'VIDEO'
  | 'QUIZ'
  | 'BRANCHING_SCENARIO'
  | 'DRAG_AND_DROP'
  | 'EMBEDDED_HTML'
  // Silnik scen (packages/content): komponenty tych bloków dochodzą w kolejnych commitach PR 2.
  | 'SCENE_HOTSPOTS'
  | 'DIALOGUE'
  | 'NOTEPAD'
  | 'EMAIL_ANALYSIS'
  | 'TEXT_INPUT_GUIDED'
  | 'ORDERING'
  | 'TABS'
  | 'SUMMARY'
  // schemaVersion 4: blok narracyjny (tekst, bez interakcji poza "Dalej") - patrz packages/content D-061.
  | 'NARRATIVE'
  // schemaVersion 5: odprawa (kroki typewriter/call/caseFile/badge), nieoceniana - D-081.
  | 'BRIEFING'
  // schemaVersion 5: teczka sprawy (dokumenty z wierszami, zakreślanie dowodów), nieoceniana - D-083.
  | 'DOSSIER'
  // schemaVersion 6 (moduł 2, D-115): odsłuch nagrania z czerwonymi flagami (oceniany) i omówienie ze znacznikami (nieoceniane).
  | 'CALL_RECORDING'
  | 'ANNOTATED_REPLAY'
  // schemaVersion 6 (moduł 2, D-118): przesłuchanie - pytania, kwestie do notatnika, podważanie dowodem, konsola (oceniane przy sprzecznościach).
  | 'INTERROGATION'
  // schemaVersion 6 (moduł 2, D-120): OSINT - strona z obszarami do zaznaczenia (oceniane), nagranie przy obszarze z ukrytym zakończeniem.
  | 'OSINT_SPOT'
  // schemaVersion 6 (moduł 2, D-122): rozmowa na żywo - drzewo odpowiedzi z limitem czasu (oceniana po zakończeniu).
  | 'LIVE_CALL'
  // schemaVersion 6 (moduł 3, D-132): segregowanie wiadomości - karta w lewo „Podejrzane”, w prawo „W porządku” (każda karta przez /check).
  | 'SWIPE_SORT';

/** Karta SWIPE_SORT z /start (D-132): id nieprzejrzyste, bez werdyktu i zdania po werdykcie (sekret - odpowiedź /check). */
export interface SwipeCard {
  id: string;
  channel: 'sms' | 'chat';
  from: string;
  time?: string;
  text: string;
  attachment?: string;
}

export type SwipeVerdict = 'suspicious' | 'ok';

/** Próba /check (D-132): wybór po indeksie odpowiedzi, karta po id nieprzejrzystym. */
export interface SimpleCheck {
  item: number | string;
  result: 'good' | 'bad';
  feedback: string;
}

/** Odpowiedź POST .../blocks/:blockId/check (D-132). */
export interface CheckResponse {
  blockId: string;
  result: 'good' | 'bad';
  feedback: string;
  hint?: string;
  done: boolean;
}

/**
 * Rozmowa na żywo (LIVE_CALL, D-122) - pola bloku po stronie klienta. Osobny typ zamiast pól w ContentBlock: `start` to tu id węzła, a w
 * ORDERING obiekt z podpisem (ta sama nazwa pola). Ocena zakończeń i odpowiedzi oddające informację są sekretem (po ocenie - detail).
 */
export interface LiveCallContent {
  caller: { display: string; number?: string };
  choiceTimeLimitSec?: number;
  start: string;
  nodes: { id: string; narration: Narration; choices: { id: string; text: string; next: string }[]; silence?: string }[];
  endings: { id: string; narration: Narration }[];
  /** D-129: zakończenie (`#id`) po „Odrzuć” na ekranie przychodzącym i po „Rozłącz” w trakcie rozmowy. */
  reject?: string;
  hangUp?: string;
}

/** Obszar strony w OSINT (D-120): położenie i podpis; czy był użyty, dowód i wyjaśnienie pułapki są sekretem (po ocenie - detail.spots). */
export interface OsintSpot {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  media?: {
    kind: 'audio';
    title: string;
    narration: Narration;
    image?: string;
    imagePortrait?: string;
    alt?: string;
    textLayer?: TextLayerItem[];
    secretEnding?: { id: string; label: string; note?: string };
  };
}

/** Warstwa tekstu na grafice (schemaVersion 6, D-114): prostokąty w % grafiki, tekst rysowany przez odtwarzacz. */
export interface TextLayerItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  style?: 'label' | 'sign' | 'screen' | 'handwritten';
  /** Kolor tekstu względem tła slotu: `light` - jasny tekst na ciemnym tle grafiki; domyślnie ciemny. */
  tone?: 'dark' | 'light';
  /** Prostokąt na wariancie pionowym grafiki (imagePortrait). */
  portrait?: { x: number; y: number; w: number; h: number };
}

/** Segment nagrania rozmowy (CALL_RECORDING): kto mówi, tekst i nagranie; flagi są sekretem serwera. */
export interface RecordingSegment {
  id: string;
  speaker: string;
  narration: Narration;
  gapAfterMs?: number;
}

/** Znacznik omówienia (ANNOTATED_REPLAY): numer, kotwica (segment nagrania albo punkt na grafice), tytuł, tekst, narracja. */
export interface ReplayMarker {
  n: number;
  anchor: { segmentId?: string; x?: number; y?: number };
  title: string;
  text: string;
  narration?: Narration;
}

export type ReplaySource =
  | { kind: 'transcript'; fromBlock: string }
  | { kind: 'image'; image: string; imagePortrait?: string; alt: string };

/** Wiersz dokumentu w teczce (DOSSIER). evidence/note/required są jawne (jak hotspoty) - blok nie jest oceniany. */
export interface DossierRow {
  id: string;
  cells: string[];
  evidence?: boolean;
  note?: { text: string; kind?: NoteKind };
  required?: boolean;
  /** Komunikat po kliknięciu zwykłej linijki (brak = „Ta linijka wygląda na zwykłą operację.”). */
  message?: string;
}

export interface DossierDocument {
  id: string;
  tab: string;
  org: string;
  title: string;
  meta?: string;
  columns: string[];
  rows: DossierRow[];
}

/** Prostokąt na scenie kroku odprawy, w % sceny (D-084). */
/** Ekran zamknięcia sprawy (SUMMARY.closing, D-089): raport w teczce (16:9), pieczęć i liścik komisarza, sloty HTML w % sceny. */
export interface CaseClosing {
  image: string;
  stamp: string;
  note: string;
  slots: Record<'evidence' | 'time' | 'xp' | 'lessons' | 'signature' | 'stamp' | 'note', BriefingRect>;
  /** Wariant pionowy (telefon, D-098): raport 9:16 z tym samym zestawem slotów. */
  portrait?: { image: string; slots: CaseClosing['slots'] };
}

export interface BriefingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Grafika kroku odprawy (D-084): scena, hotspot = cta, sloty na HTML (zadania, dane gracza). */
export interface BriefingScene {
  image?: string;
  hotspot?: BriefingRect & { id: string };
  slots?: Partial<Record<'tasks' | 'name' | 'number' | 'photo', BriefingRect>>;
  /** Wariant pionowy (telefon, D-098): te same pola w % sceny 9:16; closedImage/openHotspot tylko przy teczce (caseFile). */
  portrait?: {
    image: string;
    closedImage?: string;
    hotspot?: BriefingRect & { id: string };
    openHotspot?: BriefingRect & { id: string };
    slots?: Partial<Record<'tasks' | 'name' | 'number' | 'photo', BriefingRect>>;
  };
}

/** Krok odprawy (BRIEFING) tak, jak wraca z /start (wszystkie pola `client`, bez narration.spokenText). */
export type BriefingStep =
  | ({ kind: 'typewriter'; text: string; sub?: string; cta: string; narration?: Narration } & BriefingScene)
  | ({
      kind: 'call';
      caller: { name: string; role?: string; avatar?: string };
      text: string;
      cta: string;
      narration?: Narration;
    } & BriefingScene)
  | ({
      kind: 'caseFile';
      caseNo: string;
      title: string;
      fields: { label: string; value: string }[];
      stamp?: string;
      tasks?: BriefingTask[];
      cta: string;
      narration?: Narration;
      /** Faza zamknięta (teczka) - klik w hotspot otwiera akta (`image`). */
      closedImage?: string;
      /** Klikalne otwarte akta (D-086): klik zamyka teczkę i przechodzi dalej. */
      openHotspot?: BriefingRect & { id: string };
    } & BriefingScene)
  | ({ kind: 'badge'; cta: string; narration?: Narration } & BriefingScene)
  | ({ kind: 'start'; text: string; cta: string; narration?: Narration } & BriefingScene);

/** Zadanie sprawy z karty w odprawie (BRIEFING, krok caseFile, D-081): completeWhen = id bloków, których ukończenie odhacza zadanie. */
export interface BriefingTask {
  id: string;
  text: string;
  completeWhen: string[];
}

/** Reakcja z treści (schemaVersion 4, D-061): liczy się tekst; `pose` przestarzała (D-096), tylko ze starszych wersji treści. */
export interface ContentReaction {
  pose?: string;
  text: string;
}

export interface CourseAssignmentSummary {
  assignmentId: string;
  courseId: string;
  title: string;
  /** Ścieżka zasobu miniatury 16:9 (D-084); brak/null = karta z ikoną kategorii. */
  thumbnail?: string | null;
  category: string;
  durationMinutes: number;
  mandatory: boolean;
  status: AssignmentStatus;
  score: number | null;
  dueDate: string | null;
  completedAt: string | null;
  currentBlockIndex: number;
  totalBlocks: number;
}

// Pozycja katalogu (GET /courses/catalog, D-065): kurs globalny, na który wywołujący nie ma jeszcze przypisania -
// bez treści bloków. "Rozpocznij" (POST /courses/:id/self-assign) tworzy WŁASNE, zawsze nieobowiązkowe przypisanie.
export interface CourseCatalogItem {
  courseId: string;
  title: string;
  subtitle: string | null;
  /** Ścieżka zasobu miniatury 16:9 (D-084); brak/null = karta z ikoną kategorii. */
  thumbnail?: string | null;
  level: string | null;
  objectives: string[];
  category: string;
  durationMinutes: number;
  totalBlocks: number;
}

// Opcje QUIZ/BRANCHING_SCENARIO tak, jak wraca z /start - apps/api usuwa
// pole "correct"/"outcome" (i ewentualny "feedback") przed wysłaniem, więc
// front nigdy nie widzi klucza odpowiedzi.
export interface ContentBlockOption {
  text: string;
}

export interface DragAndDropItem {
  text: string;
  /** ORDERING: id nieprzejrzyste elementu (DRAG_AND_DROP go nie ma). */
  id?: string;
}

export interface ContentBlock {
  type: ContentBlockType;
  // Bloki silnika scen (v2) mają stabilne id; bloki sprzed silnika dostają id b<indeks> z API.
  id?: string;
  title?: string;
  // Narracja (lektor): tekst, nagranie (ścieżka względna wobec CONTENT_BASE_URL), czas i opcjonalne napisy z czasami.
  narration?: Narration;
  // Stała podpowiedź bloku (D-096) - tekst w dymku odtwarzacza.
  tip?: string;
  // Przestarzałe (D-096): starsze wersje treści; odtwarzacz czyta `mascot.text`, gdy brak `tip` (poza ignorowana).
  mascot?: { pose: string; text?: string };
  // VIDEO
  url?: string;
  // QUIZ / BRANCHING_SCENARIO
  prompt?: string;
  options?: ContentBlockOption[];
  // SWIPE_SORT (D-132): karty-wiadomości (id nieprzejrzyste, przetasowane przez serwer).
  cards?: SwipeCard[];
  // SUMMARY - zamknięcie sprawy (D-089): wnioski śledczego i grafika ekranu zamknięcia ze slotami w % sceny raportu.
  lessons?: string[];
  closing?: CaseClosing;
  // DRAG_AND_DROP (i ORDERING: te same pola id/text)
  items?: DragAndDropItem[];
  // ORDERING - tablica śledcza (D-088): "zdjęcia" na początku i końcu łańcucha.
  start?: { label: string; caption: string };
  end?: { label: string; caption: string };
  // Etykiety dwóch koszyków klasyfikacji (domyślnie "Bezpieczne"/"Phishing").
  categories?: [string, string];
  // EMBEDDED_HTML: dokument HTML NIE jest częścią treści bloku (pole sekretne po stronie serwera); iframe ładuje go z osobnej trasy embed
  // (patrz EmbeddedHtmlBlock.tsx). Nigdy nie trafia do dangerouslySetInnerHTML w głównym DOM-ie aplikacji.
  // SCENE_HOTSPOTS: ilustracja (ścieżka względna wobec bazy zasobów), tekst alternatywny i prostokąty w % obrazu.
  image?: string;
  imageAlt?: string;
  /** Tekst sceny w warstwie (schemaVersion 6). */
  textLayer?: TextLayerItem[];
  /** Wariant pionowy sceny (D-116): grafika na telefon w pionie i prostokąty przedmiotów (te same id co `hotspots`) w % tej grafiki. */
  imagePortrait?: string;
  portraitHotspots?: { id: string; x: number; y: number; width: number; height: number }[];
  hotspots?: SceneHotspot[];
  requiredHotspots?: string[];
  // CALL_RECORDING (D-115): segmenty rozmowy (bez flag - te są sekretem, rozstrzygnięcie w ResultDetail.flags po ocenie).
  segments?: RecordingSegment[];
  // ANNOTATED_REPLAY (D-115): źródło (transkrypcja nagrania albo grafika) i numerowane znaczniki.
  source?: ReplaySource;
  markers?: ReplayMarker[];
  /** Treść wstrzymana przez API do czasu dotarcia gracza do bloku (omówienie nagrania, D-115) - pełny blok w odpowiedzi /progress. */
  withheld?: boolean;
  // DIALOGUE
  character?: { name: string; role?: string; avatar?: string; opening?: string };
  questions?: DialogueQuestion[];
  requiredQuestions?: string[];
  // TABS
  tabs?: ContentTab[];
  requiredTabs?: string[];
  // BRIEFING
  steps?: BriefingStep[];
  // DOSSIER: pieczątka teczki i dokumenty (przekładki).
  stamp?: string;
  documents?: DossierDocument[];
  // OSINT_SPOT (D-120): obszary strony i ich wariant pionowy (te same id).
  spots?: OsintSpot[];
  portraitSpots?: { id: string; x: number; y: number; w: number; h: number }[];
  // SUMMARY
  text?: string;
  // EMAIL_ANALYSIS: makieta maila i kryteria (id nieprzejrzyste, kolejność potasowana przez serwer; bez klucza odpowiedzi).
  email?: EmailContent;
  criteria?: EmailCriterion[];
  // TEXT_INPUT_GUIDED
  placeholder?: string;
  /** Oprawa pola: 'browser' = pasek adresu w oknie przeglądarki (feat/browser-evidence). */
  frame?: 'browser';
  maxAttempts?: number;
  hintCount?: number;
  // Reakcja maskotki na ukończenie bloku (schemaVersion 4): statyczna, bez klucza odpowiedzi - patrz packages/content D-061.
  // reactions.result (sekret) NIE jest tu: dochodzi dopiero w LastResult/ClientProgressBlock, po ocenie.
  reactions?: { complete?: ContentReaction };
}

export interface EmailContent {
  fromName: string;
  fromAddress: string;
  // schemaVersion 4: adresat do wyświetlenia w makiecie (pod "Od:"), tekst bez znaczenia oceniającego.
  to?: string;
  subject: string;
  body: string;
  date?: string;
  attachment?: { name: string; size?: string };
  links: { id: string; text: string; url: string }[];
}

export interface EmailCriterion {
  id: string;
  label: string;
  /** Fragment maila, którego kliknięcie zaznacza kryterium (brak = tylko na liście). */
  target?: { kind: 'sender' | 'subject' | 'link' | 'attachment' | 'text'; linkId?: string; quote?: string };
}

// Media karty hotspotu OBOK zwykłego tekstu (B-086/D-071): image/document w pełnoekranowym podglądzie, audio z WŁASNYM
// odtwarzaczem (plik z --assets, nie z silnika TTS/narracji), scene to zagnieżdżona mini-scena (zawsze 1 poziom -
// InnerSceneHotspot nie ma już własnego media.kind: "scene"). Jeden płaski interfejs z opcjonalnymi polami wariantów,
// tak jak EmailCriterion.target niżej - to samo API zwraca (toClientBlock), więc kształt jest identyczny.
/** Okienko easter egga (D-100, media.kind "popups"). */
export interface PopupItem {
  title: string;
  body: string;
  button: string;
  /** 'dodge': przycisk ucieka przed kursorem (2 razy, nie na dotyku). */
  behavior?: 'dodge' | 'none';
  /** Kosmetyczne odliczanie w dół (GG:MM:SS). */
  countdown?: string;
}

/** Pola wariantu "popups" (D-100) - wspólne dla HotspotMedia i InnerHotspotMedia. */
interface PopupsFields {
  items?: PopupItem[];
  outro?: string;
  badge?: { id: string; label: string };
}

export interface HotspotMedia extends PopupsFields {
  kind: 'image' | 'audio' | 'document' | 'scene' | 'popups';
  src?: string;
  /** kind:'image' - wariant dla telefonu w pionie (D-104). */
  imagePortrait?: string;
  alt?: string;
  /** kind:'image' - tekst zbliżenia w warstwie (schemaVersion 6). */
  textLayer?: TextLayerItem[];
  audioUrl?: string;
  transcript?: string;
  /** kind:'audio' nagrane potokiem TTS (schemaVersion 5, D-082) zamiast audioUrl/transcript: plik w narration.audioUrl, transkrypcja w narration.text. */
  narration?: Narration;
  /** Zbliżenie nad własnym odtwarzaczem audio (tylko kind:'audio', opcjonalne, feat/scene-overlay-fix). */
  image?: string;
  title?: string;
  lines?: string[];
  scene?: NestedScene;
}

export interface NestedScene {
  image: string;
  imageAlt: string;
  textLayer?: TextLayerItem[];
  /** Ekran monitora w % grafiki (D-116) - okienka easter egga pojawiają się wyłącznie w nim. */
  screen?: { x: number; y: number; w: number; h: number };
  hotspots: InnerSceneHotspot[];
}

/** Media WEWNĄTRZ zagnieżdżonej sceny: jak HotspotMedia, ale bez wariantu "scene" (limit 1 poziomu). */
export interface InnerHotspotMedia extends PopupsFields {
  kind: 'image' | 'audio' | 'document' | 'popups';
  src?: string;
  /** kind:'image' - wariant dla telefonu w pionie (D-104). */
  imagePortrait?: string;
  alt?: string;
  textLayer?: TextLayerItem[];
  audioUrl?: string;
  transcript?: string;
  narration?: Narration;
  /** Zbliżenie nad własnym odtwarzaczem audio (tylko kind:'audio', opcjonalne, feat/scene-overlay-fix). */
  image?: string;
  title?: string;
  lines?: string[];
}

export interface InnerSceneHotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  media?: InnerHotspotMedia;
  narration?: Narration;
  evidence?: boolean;
  note?: { text: string; kind?: NoteKind };
  required?: boolean;
}

export interface SceneHotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // 'card' (domyślnie): klik otwiera kartę (content/media). 'next': "drzwi" - klik kończy CAŁY blok jak przycisk
  // "Dalej" w pasku powłoki; taki hotspot nie ma ani content, ani media, ani evidence/note (serwer to wymusza).
  action?: 'card' | 'next';
  content?: string;
  media?: HotspotMedia;
  narration?: Narration;
  // schemaVersion 3: dowód (wpis w notatniku po "Dodaj do notatnika") i wymagalność.
  evidence?: boolean;
  note?: { text: string; kind?: NoteKind };
  required?: boolean;
}

export interface DialogueQuestion {
  id: string;
  text: string;
  // Odpowiedź jako jeden tekst ALBO kwestie po kolei (schemaVersion 3).
  answer?: string;
  // INTERROGATION (D-118): kwestia ma id (podważenie, klucz notatki) i może być fragmentem do notatnika. Sprzeczność jest sekretem - klient
  // nie wie, która kwestia kłamie.
  lines?: { id?: string; text: string; narration?: Narration; fragment?: { evidence?: boolean; note: { text: string; kind?: NoteKind } } }[];
  answerNarration?: Narration;
  note?: { text: string; kind?: NoteKind };
  evidence?: boolean;
  required?: boolean;
  /** INTERROGATION (D-118): pytanie otwiera konsolę (`documents` bloku). */
  opensDocuments?: boolean;
}

// call/log/web - schemaVersion 6 (moduł 2): rozmowa/nagranie, logi/konsola, strona/webinar.
export type NoteKind = 'mail' | 'person' | 'item' | 'place' | 'call' | 'log' | 'web';

export interface EvidenceSummary {
  collected: number;
  total: number;
  perBlock: { blockId: string; collected: number; total: number }[];
}

export interface ContentTab {
  id: string;
  title: string;
  content: string;
}

// Widok postępu z /start (apps/api: clientProgress): własne wyniki bloków po id oraz notatki (treść rozwiązana przez serwer, bez kluczy).
export interface ClientProgressBlock {
  type: string;
  done: boolean;
  correct?: boolean;
  points?: number;
  attempts?: number;
  // TEXT_INPUT_GUIDED: odsłonięte dotąd podpowiedzi i (po wyczerpaniu prób) rozwiązanie.
  revealedHints?: { text: string }[];
  solution?: { text: string; explanation?: string };
  // Ukończone bloki oceniane: własny wybór i rozstrzygnięcie (podgląd "Wstecz" także po odświeżeniu).
  answer?: ChosenAnswer;
  detail?: ResultDetail;
  // Reakcja maskotki na WYNIK (schemaVersion 4), dopiero po ukończeniu - patrz packages/content D-061.
  reaction?: ContentReaction;
  // INTERROGATION (D-118): podważone kwestie (także w trakcie bloku) - kwestia po podważeniu tylko przy trafieniu.
  challenges?: InterrogationChallenge[];
  // SCENE_HOTSPOTS (D-128): stan częściowy nieukończonej sceny - obejrzane przedmioty i zabrane dowody (id przedmiotów z treści).
  exploration?: SceneExploration;
  // Tryb prosty i SWIPE_SORT (D-132): własne próby /check (także w trakcie bloku) i podpowiedź po 2 błędach.
  checks?: SimpleCheck[];
  hint?: string;
}

export interface SceneExploration {
  visited: string[];
  noted: string[];
}

export interface InterrogationChallenge {
  lineId: string;
  correct: boolean;
  line?: { text: string };
}

export interface ClientNote {
  blockId: string;
  text: string;
  kind?: NoteKind;
  /** Nieprzejrzysty odnośnik notatki (D-118) - wskazanie dowodu przy podważeniu kwestii przesłuchania; tylko notatki zapisane przez serwer. */
  ref?: string;
}

/** Odpowiedź POST .../blocks/:blockId/challenge (D-118). */
export interface ChallengeResponse extends InterrogationChallenge {
  blockId: string;
  note?: ClientNote;
  evidence: EvidenceSummary;
}

/** Ukryte wyróżnienie easter egga (D-100): etykieta z treści, rozwiązana przez serwer (bez id z treści). */
export interface ClientDistinction {
  blockId: string;
  label: string;
  /** Zdanie pod wyróżnieniem (ukryte zakończenie nagrania w OSINT, D-120). */
  note?: string;
}

export interface ClientProgress {
  v: 2;
  blocks: Record<string, ClientProgressBlock>;
  notes: ClientNote[];
  // Dowody liczone przez serwer (brak w odpowiedziach starszego API).
  evidence?: EvidenceSummary;
  // Wyróżnienia easter egga (D-100; brak w odpowiedziach starszego API).
  distinctions?: ClientDistinction[];
}

export interface CourseDetail {
  assignmentId: string;
  courseId: string;
  title: string;
  status: AssignmentStatus;
  currentBlockIndex: number;
  /** Pierwsze rozpoczęcie i ukończenie przypisania (ISO) - czas śledztwa na ekranie zamknięcia (D-089); starsze odpowiedzi bez pól. */
  startedAt?: string | null;
  completedAt?: string | null;
  contentBlocks: ContentBlock[];
  progress: ClientProgress | null;
  /** Tryb prosty (D-132): ocena każdego kliknięcia, podpowiedź po 2 błędach, tekst min. 16 px; starsze odpowiedzi bez pola = false. */
  simpleMode?: boolean;
}

/** Rozstrzygnięcie ukończonego bloku (id elementów nieprzejrzyste, jak w /start): EMAIL_ANALYSIS -> criteria, ORDERING -> correctOrder. */
export interface ResultDetail {
  criteria?: { id: string; correct: boolean; selected: boolean; explanation?: string }[];
  correctOrder?: string[];
  explanation?: string;
  /** CALL_RECORDING (D-115): które segmenty były flagami, kategoria i czy gracz je trafił. */
  flags?: { segmentId: string; category: RecordingFlagCategory; hit: boolean }[];
  falseTaps?: number;
  /** INTERROGATION (D-118): które kwestie kłamały i przyznanie po podważeniu - dopiero po ukończeniu bloku. */
  contradictions?: { lineId: string; line: { text: string } }[];
  /** OSINT_SPOT (D-120): który obszar był użyty, czy gracz go zaznaczył, wyjaśnienie pułapki - dopiero po ocenie. */
  spots?: { id: string; used: boolean; marked: boolean; trapText?: string }[];
  /** LIVE_CALL (D-122): zakończenie rozmowy, jego ocena i odpowiedzi gracza, które oddały informację - dopiero po ocenie. */
  ending?: string;
  outcome?: 'good' | 'partial' | 'bad';
  gaveInfo?: string[];
}

export type RecordingFlagCategory = 'urgency' | 'authority' | 'fear' | 'code_request' | 'install_request';

/** Tapnięcie w odsłuchu nagrania: pozycja w nagraniu (odsłuch) albo segment (transkrypcja). */
export type RecordingTap = { atMs: number } | { segmentId: string };

/** Własny wybór gracza w ukończonym bloku (QUIZ/BRANCHING: indeks; EMAIL: selected; ORDERING: order; id nieprzejrzyste; nagranie: taps). */
export type ChosenAnswer =
  | number
  | { selected: string[] }
  | { order: string[] }
  | { taps: RecordingTap[] }
  | { marked: string[] }
  | { path: string[]; timed: boolean };

export interface LastResult {
  blockIndex: number;
  detail?: ResultDetail;
  // Id bloku (b<indeks> dla bloków sprzed silnika); starsze odpowiedzi mogą go nie mieć.
  blockId?: string;
  // 0..1; obecne dla bloków ocenianych.
  points?: number;
  type: ContentBlockType;
  // Brak dla VIDEO/DRAG_AND_DROP (nieoceniane) - obecne (true/false) dla
  // QUIZ/BRANCHING_SCENARIO.
  correct?: boolean;
  // Reakcja maskotki na WYNIK (schemaVersion 4), dobrana wg wyniku - patrz packages/content D-061.
  reaction?: ContentReaction;
}

// Obecne WYŁĄCZNIE gdy dana odpowiedź /progress ukończyła kurs - patrz
// apps/api CourseProgressResponseDto. XP, awans i odznaki na ekranie zamknięcia
// sprawy (CaseClosedScreen, D-089) pokazują się tylko wtedy.
export interface CourseCompletionReward {
  xpGained: number;
  newLevel: number;
  // Poziom SPRZED tego przyznania XP.
  previousLevel: number;
  leveledUp: boolean;
  // Osiągnięcia zdobyte tym ukończeniem (D-111); `rank` - ranga (etykieta po angielsku w UI).
  unlockedBadges: { code: string; title: string; icon: string; xpReward: number; rank?: 'SECRET' | 'LEGENDARY' | 'MILESTONE' | 'RARE' | null }[];
  // Pasek poziomu "przed -> po" (dziś nieużywany przez web, D-089) - procent 0..100 w skali poziomu SPRZED tego przyznania XP;
  // przy awansie `levelProgressAfterPercent` jest przycięty do 100 przez API.
  levelProgressBeforePercent: number;
  levelProgressAfterPercent: number;
}

export interface CourseProgressResponse {
  assignmentId: string;
  status: AssignmentStatus;
  currentBlockIndex: number;
  score: number | null;
  completedAt: string | null;
  lastResult: LastResult;
  // Notatki dopisane tym zapisem (np. trafione kryteria maila): dołączane do notatnika od razu.
  notes?: ClientNote[];
  evidence?: EvidenceSummary;
  // Pełna treść bloku wstrzymanego w /start (omówienie nagrania, D-115), do którego gracz właśnie dotarł - podmieniana w liście bloków.
  revealedBlock?: { blockIndex: number; block: ContentBlock };
  gamification: CourseCompletionReward | null;
}
