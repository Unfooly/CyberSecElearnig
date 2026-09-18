// Ręcznie odwzorowane DTO z apps/api/src/courses/dto/ - ten sam,
// udokumentowany dług techniczny co przy dashboardzie (patrz README,
// sekcja "Backlog frontendu"). Trzymane tu, w jednym miejscu, żeby biblioteka
// kursów i odtwarzacz nie duplikowały własnych kopii.

export type AssignmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';
export type ContentBlockType = 'VIDEO' | 'QUIZ' | 'BRANCHING_SCENARIO' | 'DRAG_AND_DROP' | 'EMBEDDED_HTML';

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
}

export interface CourseDetail {
  assignmentId: string;
  courseId: string;
  title: string;
  status: AssignmentStatus;
  currentBlockIndex: number;
  contentBlocks: ContentBlock[];
  progress: Record<string, unknown> | null;
}

export interface LastResult {
  blockIndex: number;
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
