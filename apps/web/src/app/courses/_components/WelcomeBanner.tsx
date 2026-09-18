import { ButtonLink } from '@/components/ui/Button';
import type { CourseAssignmentSummary } from '@/lib/courses-types';

function pendingCoursesLabel(count: number): string {
  if (count === 1) return '1 kurs do ukończenia';
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  const useGenitivePlural = lastTwoDigits >= 12 && lastTwoDigits <= 14;
  const form = !useGenitivePlural && lastDigit >= 2 && lastDigit <= 4 ? 'kursy' : 'kursów';
  return `${count} ${form} do ukończenia`;
}

function firstNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const firstSegment = localPart.split(/[._-]+/)[0] ?? localPart;
  return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1);
}

// Kurs, od którego warto zacząć: najpierw rozpoczęte/zaległe, potem nowe.
function nextCourse(courses: CourseAssignmentSummary[]): CourseAssignmentSummary | undefined {
  const pending = courses.filter((course) => course.status !== 'COMPLETED');
  return (
    pending.find((course) => course.status === 'OVERDUE') ??
    pending.find((course) => course.status === 'IN_PROGRESS') ??
    pending[0]
  );
}

export default function WelcomeBanner({
  courses,
  userEmail,
}: {
  courses: CourseAssignmentSummary[];
  userEmail: string | null;
}) {
  const pendingCount = courses.filter((course) => course.status !== 'COMPLETED').length;
  const name = userEmail ? firstNameFromEmail(userEmail) : null;
  const next = nextCourse(courses);

  return (
    <div className="rounded-card border border-[#DCD6FF] bg-accent-soft p-[22px]">
      <h2 className="text-lg font-bold tracking-[-0.01em] text-accent-ink">Witaj{name ? `, ${name}` : ''}!</h2>
      {pendingCount === 0 ? (
        <p className="mt-2">
          Świetna robota! Ukończyłeś/aś wszystkie przypisane kursy. Nic więcej nie jest teraz wymagane.
        </p>
      ) : (
        <>
          <p className="mt-2">Masz {pendingCoursesLabel(pendingCount)}. Zaczynajmy!</p>
          {next && (
            <ButtonLink href={`/courses/${next.courseId}`} className="mt-3.5 w-full">
              Kontynuuj naukę
            </ButtonLink>
          )}
        </>
      )}
    </div>
  );
}
