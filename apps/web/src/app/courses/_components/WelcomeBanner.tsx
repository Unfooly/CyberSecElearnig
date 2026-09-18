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

export default function WelcomeBanner({
  courses,
  userEmail,
}: {
  courses: CourseAssignmentSummary[];
  userEmail: string | null;
}) {
  const pendingCount = courses.filter((course) => course.status !== 'COMPLETED').length;
  const name = userEmail ? firstNameFromEmail(userEmail) : null;

  return (
    <div className="rounded-2xl bg-emerald-50 p-5">
      <h2 className="mb-2 text-lg font-bold text-emerald-900">Witaj{name ? `, ${name}` : ''}!</h2>
      {pendingCount === 0 ? (
        <p className="text-sm leading-relaxed text-emerald-800">
          Świetna robota! Ukończyłeś/aś wszystkie przypisane kursy. Nic więcej nie jest teraz wymagane.
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-emerald-800">
          Masz {pendingCoursesLabel(pendingCount)}. Zaczynajmy!
        </p>
      )}
    </div>
  );
}
