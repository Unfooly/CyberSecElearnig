import Link from 'next/link';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import StatusBadge from './StatusBadge';
import ProgressBar from './ProgressBar';

function actionLabel(status: CourseAssignmentSummary['status']): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Start';
    case 'IN_PROGRESS':
    case 'OVERDUE':
      return 'Kontynuuj';
    case 'COMPLETED':
      // Nie "Powtórz" - apps/api nie pozwala zapisywać postępu po COMPLETED
      // (świadoma poprawka z poprzedniego zadania), więc kliknięcie i tak
      // pokaże tylko podsumowanie, nigdy nowej próby.
      return 'Zobacz podsumowanie';
  }
}

// Brak prawdziwych miniaturek (żadnych assetów graficznych w projekcie) -
// gradient zależny od kategorii daje wizualne zróżnicowanie kart bez
// potrzeby obrazków, w duchu mockupu (kolorowa miniatura u góry karty).
const CATEGORY_GRADIENT: Record<string, string> = {
  PHISHING_SOCIAL_ENGINEERING: 'from-rose-400 to-orange-500',
  EMAIL_SECURITY: 'from-sky-400 to-blue-600',
  IT_HYGIENE: 'from-emerald-400 to-teal-600',
  INCIDENT_RESPONSE: 'from-amber-400 to-orange-600',
  MALWARE: 'from-fuchsia-400 to-purple-600',
  GENERAL_AWARENESS: 'from-teal-400 to-emerald-600',
};

export default function CourseCard({ course }: { course: CourseAssignmentSummary }) {
  const showProgress = course.status === 'IN_PROGRESS' || course.status === 'OVERDUE';
  const gradient = CATEGORY_GRADIENT[course.category] ?? 'from-slate-400 to-slate-600';

  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm">
      <div className={`relative h-28 w-full rounded-xl bg-gradient-to-br ${gradient}`}>
        <span className="absolute left-2 top-2">
          <StatusBadge status={course.status} />
        </span>
        <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-600">
          {course.durationMinutes} min
        </span>
      </div>

      <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{course.title}</h3>

      {course.mandatory && (
        <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Obowiązkowy</span>
      )}

      {showProgress && (
        <ProgressBar currentBlockIndex={course.currentBlockIndex} totalBlocks={course.totalBlocks} />
      )}

      {course.status === 'COMPLETED' && course.score !== null && (
        <p className="text-xs text-slate-500">Wynik: {course.score}%</p>
      )}

      <Link
        href={`/courses/${course.courseId}`}
        className="mt-auto rounded-full bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
      >
        {actionLabel(course.status)}
      </Link>
    </div>
  );
}
