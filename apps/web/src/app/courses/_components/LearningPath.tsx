import { BookOpen, Check } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Pill from '@/components/ui/Pill';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import ProgressBar from './ProgressBar';

function actionLabel(status: CourseAssignmentSummary['status']): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Start';
    case 'IN_PROGRESS':
    case 'OVERDUE':
      return 'Kontynuuj';
    case 'COMPLETED':
      // Nie "Powtórz" - apps/api nie pozwala zapisywać postępu po COMPLETED,
      // więc kliknięcie pokaże tylko podsumowanie, nigdy nową próbę.
      return 'Zobacz podsumowanie';
  }
}

// Ścieżka nauki jako lista kroków (zamiast poziomej karuzeli): numer / ptaszek,
// tytuł, meta, pasek postępu i akcja. Kolejność = kolejność z API.
export default function LearningPath({ courses }: { courses: CourseAssignmentSummary[] }) {
  if (courses.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={BookOpen}
          title="Brak przypisanych kursów"
          description="Gdy administrator przypisze Ci szkolenie, pojawi się tutaj jako pierwszy krok."
        />
      </Card>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {courses.map((course, index) => {
        const done = course.status === 'COMPLETED';
        const showProgress = course.status === 'IN_PROGRESS' || course.status === 'OVERDUE';
        return (
          <li key={course.assignmentId}>
            <Card className="flex items-center gap-4 px-[18px] py-4">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-extrabold text-white ${
                  done ? 'bg-success' : 'bg-accent'
                }`}
              >
                {done ? <Check size={16} strokeWidth={3} /> : index + 1}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <b className="truncate">{course.title}</b>
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold text-muted">
                  <span>{course.durationMinutes} min</span>
                  {course.mandatory && <Pill tone="warn">Obowiązkowy</Pill>}
                  {course.status === 'OVERDUE' && <Pill tone="warn">Zaległy</Pill>}
                  {done && course.score !== null && <span>Wynik: {course.score}%</span>}
                </div>
                {showProgress && (
                  <ProgressBar currentBlockIndex={course.currentBlockIndex} totalBlocks={course.totalBlocks} />
                )}
              </div>

              <ButtonLink
                href={`/courses/${course.courseId}`}
                size="sm"
                variant={done ? 'ghost' : 'primary'}
                aria-label={`${actionLabel(course.status)}: ${course.title}`}
              >
                {actionLabel(course.status)}
              </ButtonLink>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
