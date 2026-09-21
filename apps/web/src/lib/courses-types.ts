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
  | 'SUMMARY';

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

// Opcje QUIZ/BRANCHING_SCENARIO tak, jak wraca z /start - apps/api usuwa
// pole "correct"/"outcome" (i ewentualny "feedback") przed wysłaniem, więc
// front nigdy nie widzi klucza odpowiedzi.
export interface ContentBlockOption {
  text: string;
}

export interface DragAndDropItem {
  text: string;
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
  // EMBEDDED_HTML - pełny dokument HTML renderowany WYŁĄCZNIE w
  // sandboxowanym <iframe> (patrz EmbeddedHtmlBlock.tsx). Nigdy nie trafia
  // do dangerouslySetInnerHTML w głównym DOM-ie aplikacji.
  html?: string;
  // SCENE_HOTSPOTS: ilustracja (ścieżka względna wobec bazy zasobów), tekst alternatywny i prostokąty w % obrazu.
  image?: string;
  imageAlt?: string;
  hotspots?: SceneHotspot[];
  requiredHotspots?: string[];
  // DIALOGUE
  character?: { name: string; role?: string };
  questions?: DialogueQuestion[];
  requiredQuestions?: string[];
  // TABS
  tabs?: ContentTab[];
  requiredTabs?: string[];
  // SUMMARY
  text?: string;
}

export interface SceneHotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  narration?: Narration;
}

export interface DialogueQuestion {
  id: string;
  text: string;
  answer: string;
  answerNarration?: Narration;
  note?: { text: string };
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
}

export interface ClientNote {
  blockId: string;
  text: string;
}

export interface ClientProgress {
  v: 2;
  blocks: Record<string, ClientProgressBlock>;
  notes: ClientNote[];
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

export interface LastResult {
  blockIndex: number;
  // Id bloku (b<indeks> dla bloków sprzed silnika); starsze odpowiedzi mogą go nie mieć.
  blockId?: string;
  // 0..1; obecne dla bloków ocenianych.
  points?: number;
  type: ContentBlockType;
  // Brak dla VIDEO/DRAG_AND_DROP (nieoceniane) - obecne (true/false) dla
  // QUIZ/BRANCHING_SCENARIO.
  correct?: boolean;
}

// Obecne WYŁĄCZNIE gdy dana odpowiedź /progress ukończyła kurs - patrz
// apps/api CourseProgressResponseDto. CourseRewardModal pokazuje się tylko
// wtedy.
export interface CourseCompletionReward {
  xpGained: number;
  newLevel: number;
  leveledUp: boolean;
  unlockedBadges: { code: string; title: string; icon: string; xpReward: number }[];
}

export interface CourseProgressResponse {
  assignmentId: string;
  status: AssignmentStatus;
  currentBlockIndex: number;
  score: number | null;
  completedAt: string | null;
  lastResult: LastResult;
  gamification: CourseCompletionReward | null;
}
