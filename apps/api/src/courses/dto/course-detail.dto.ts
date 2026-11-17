import { AssignmentStatus, Prisma } from '@prisma/client';

export class CourseDetailDto {
  assignmentId!: string;
  courseId!: string;
  title!: string;
  status!: AssignmentStatus;
  currentBlockIndex!: number;
  /** Pierwsze rozpoczęcie i ukończenie przypisania - czas śledztwa na ekranie zamknięcia sprawy (D-089); null = nieznane / jeszcze nie. */
  startedAt!: Date | null;
  completedAt!: Date | null;
  contentBlocks!: Prisma.JsonValue;
  progress!: Prisma.JsonValue;
  /** Tryb prosty wersji treści (D-132): odtwarzacz dla osób nietechnicznych, ocena każdego kliknięcia przez /check. */
  simpleMode!: boolean;
  /** Język treści tej odpowiedzi (D-133): język gracza, jeśli kurs go ma, inaczej 'pl'. */
  locale!: string;
  /** Języki, w których kurs jest kompletny (przełącznik na starcie kursu, gdy więcej niż jeden). */
  locales!: string[];
  /** true - kurs bez języka gracza, treść po polsku z plakietką „Available in Polish only”. */
  localeFallback!: boolean;
  /** Ekran startu i końca modułu (szablon modułu, D-163): kategoria, czas, podtytuł i numer sprawy w języku treści, okładki (ścieżki
   *  zasobów; null - ciemne tło). Okładki, numer i podtytuł z module.json w obrazie API (module-meta.ts), reszta z `courses`. */
  moduleInfo!: {
    category: string;
    durationMinutes: number;
    subtitle: string | null;
    caseNumber: number | null;
    cover: { start: string; end: string; startPortrait: string | null; endPortrait: string | null } | null;
  };
}
