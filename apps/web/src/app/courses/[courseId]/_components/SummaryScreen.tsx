import Link from 'next/link';

export default function SummaryScreen({
  title,
  score,
  scoreUnavailable = false,
}: {
  title: string;
  score: number | null;
  // true, gdy pobranie wyniku się nie powiodło - odróżnia to od "kurs
  // naprawdę nie miał ocenianych bloków" (patrz CoursePlayer.tsx).
  scoreUnavailable?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white p-8 text-center shadow-sm">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Kurs ukończony</h1>
      <p className="mb-6 text-slate-600">{title}</p>

      {scoreUnavailable ? (
        <p className="mb-6 text-slate-500">Nie udało się pobrać wyniku. Spróbuj odświeżyć stronę.</p>
      ) : score !== null ? (
        <p className="mb-6 text-4xl font-semibold text-slate-900">{score}%</p>
      ) : (
        <p className="mb-6 text-slate-500">Ten kurs nie zawierał ocenianych pytań.</p>
      )}

      <Link
        href="/courses"
        className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Wróć do biblioteki kursów
      </Link>
    </div>
  );
}
