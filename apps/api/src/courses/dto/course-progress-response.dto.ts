import { AssignmentStatus } from '@prisma/client';
import { ContentBlockType } from '../content-block.types';

export class CourseProgressResponseDto {
  assignmentId!: string;
  status!: AssignmentStatus;
  currentBlockIndex!: number;
  score!: number | null;
  completedAt!: Date | null;
  lastResult!: {
    blockIndex: number;
    blockId: string;
    // Typ z zapisanej wersji kursu (string: klient obsługuje też typy, których ten kod jeszcze nie zna).
    type: ContentBlockType | string;
    correct?: boolean;
    // 0..1; obecne dla bloków ocenianych.
    points?: number;
    // Wynik po ukończeniu bloku (np. rozstrzygnięcie kryteriów maila, poprawna kolejność).
    detail?: Record<string, unknown>;
    // Reakcja na WYNIK (schemaVersion 4, packages/content: baseShape.reactions.result) - dopiero tutaj, po ocenie. `pose` - przestarzała
    // (D-096), tylko ze starszych wersji treści.
    reaction?: { pose?: string; text: string };
  };
  // Notatki dopisane tym zapisem (blockId, treść, rodzaj); bez kluczy elementów.
  notes!: { blockId: string; text: string; kind?: string }[];
  // Dowody śledztwa po tym zapisie (client-view.ts, evidenceSummary): liczby i id bloków, bez id elementów.
  evidence!: {
    collected: number;
    total: number;
    perBlock: { blockId: string; collected: number; total: number }[];
  };
  // Obecne WYŁĄCZNIE gdy ta odpowiedź ukończyła kurs (isComplete w
  // CoursesService) - front (karta nagrody na SummaryScreen,
  // fix/course-finish-flow) pokazuje ją tylko wtedy, nie przy każdym zapisie postępu.
  gamification!: {
    xpGained: number;
    newLevel: number;
    // Poziom SPRZED tego przyznania XP - front pokazuje "Poziom {previousLevel}" obok paska.
    previousLevel: number;
    leveledUp: boolean;
    unlockedBadges: { code: string; title: string; icon: string; xpReward: number }[];
    // Pasek poziomu "przed -> po" (SummaryScreen) - procent 0..100 w skali poziomu SPRZED tego przyznania XP;
    // przy awansie `After` jest przycięty do 100 (patrz GamificationService.awardCourseCompletion).
    levelProgressBeforePercent: number;
    levelProgressAfterPercent: number;
  } | null;
}
