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
  | 'NARRATIVE';

/** Poza i tekst reakcji maskotki z treści (schemaVersion 4): patrz packages/content D-061. */
export interface ContentReaction {
  pose: string;
  text: string;
}

export interface CourseAssignmentSummary {
  assignmentId: string;
  courseId: string;
  title: string;
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
  // Poza maskotki i dymek z tekstem (poza jest enumem w schemacie; klient i tak traktuje ją jako niezaufany tekst).
  mascot?: { pose: string; text?: string };
  // VIDEO
  url?: string;
  // QUIZ / BRANCHING_SCENARIO
  prompt?: string;
  options?: ContentBlockOption[];
  // DRAG_AND_DROP
  items?: DragAndDropItem[];
  // Etykiety dwóch koszyków klasyfikacji (domyślnie "Bezpieczne"/"Phishing").
  categories?: [string, string];
  // EMBEDDED_HTML: dokument HTML NIE jest częścią treści bloku (pole sekretne po stronie serwera); iframe ładuje go z osobnej trasy embed
  // (patrz EmbeddedHtmlBlock.tsx). Nigdy nie trafia do dangerouslySetInnerHTML w głównym DOM-ie aplikacji.
  // SCENE_HOTSPOTS: ilustracja (ścieżka względna wobec bazy zasobów), tekst alternatywny i prostokąty w % obrazu.
  image?: string;
  imageAlt?: string;
  hotspots?: SceneHotspot[];
  requiredHotspots?: string[];
  // DIALOGUE
  character?: { name: string; role?: string; avatar?: string; opening?: string };
  questions?: DialogueQuestion[];
  requiredQuestions?: string[];
  // TABS
  tabs?: ContentTab[];
  requiredTabs?: string[];
  // SUMMARY
  text?: string;
  // EMAIL_ANALYSIS: makieta maila i kryteria (id nieprzejrzyste, kolejność potasowana przez serwer; bez klucza odpowiedzi).
  email?: EmailContent;
  criteria?: EmailCriterion[];
  // TEXT_INPUT_GUIDED
  placeholder?: string;
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
export interface HotspotMedia {
  kind: 'image' | 'audio' | 'document' | 'scene';
  src?: string;
  alt?: string;
  audioUrl?: string;
  transcript?: string;
  /** Zbliżenie nad własnym odtwarzaczem audio (tylko kind:'audio', opcjonalne, feat/scene-overlay-fix). */
  image?: string;
  title?: string;
  lines?: string[];
  scene?: NestedScene;
}

export interface NestedScene {
  image: string;
  imageAlt: string;
  hotspots: InnerSceneHotspot[];
}

/** Media WEWNĄTRZ zagnieżdżonej sceny: jak HotspotMedia, ale bez wariantu "scene" (limit 1 poziomu). */
export interface InnerHotspotMedia {
  kind: 'image' | 'audio' | 'document';
  src?: string;
  alt?: string;
  audioUrl?: string;
  transcript?: string;
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
  lines?: { text: string; narration?: Narration }[];
  answerNarration?: Narration;
  note?: { text: string; kind?: NoteKind };
  evidence?: boolean;
  required?: boolean;
}

export type NoteKind = 'mail' | 'person' | 'item' | 'place';

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
}

export interface ClientNote {
  blockId: string;
  text: string;
  kind?: NoteKind;
}

export interface ClientProgress {
  v: 2;
  blocks: Record<string, ClientProgressBlock>;
  notes: ClientNote[];
  // Dowody liczone przez serwer (brak w odpowiedziach starszego API).
  evidence?: EvidenceSummary;
}

export interface CourseDetail {
  assignmentId: string;
  courseId: string;
  title: string;
  status: AssignmentStatus;
  currentBlockIndex: number;
  contentBlocks: ContentBlock[];
  progress: ClientProgress | null;
}

/** Rozstrzygnięcie ukończonego bloku (id elementów nieprzejrzyste, jak w /start): EMAIL_ANALYSIS -> criteria, ORDERING -> correctOrder. */
export interface ResultDetail {
  criteria?: { id: string; correct: boolean; selected: boolean; explanation?: string }[];
  correctOrder?: string[];
  explanation?: string;
}

/** Własny wybór gracza w ukończonym bloku (QUIZ/BRANCHING: indeks; EMAIL: selected; ORDERING: order; id nieprzejrzyste). */
export type ChosenAnswer = number | { selected: string[] } | { order: string[] };

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
// apps/api CourseProgressResponseDto. Karta nagrody na SummaryScreen
// (fix/course-finish-flow) pokazuje się tylko wtedy.
export interface CourseCompletionReward {
  xpGained: number;
  newLevel: number;
  // Poziom SPRZED tego przyznania XP.
  previousLevel: number;
  leveledUp: boolean;
  unlockedBadges: { code: string; title: string; icon: string; xpReward: number }[];
  // Pasek poziomu "przed -> po" (SummaryScreen) - procent 0..100 w skali poziomu SPRZED tego przyznania XP;
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
  gamification: CourseCompletionReward | null;
}
