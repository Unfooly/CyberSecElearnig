'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CourseCompletionReward } from '@/lib/courses-types';
import CourseRewardModal from './CourseRewardModal';

export default function SummaryScreen({
  courseId,
  title,
  score,
  scoreUnavailable = false,
  reward = null,
}: {
  courseId: string;
  title: string;
  score: number | null;
  // true, gdy pobranie wyniku się nie powiodło - odróżnia to od "kurs
  // naprawdę nie miał ocenianych bloków" (patrz CoursePlayer.tsx).
  scoreUnavailable?: boolean;
  // Obecne WYŁĄCZNIE przy świeżym ukończeniu w tej sesji (z odpowiedzi
  // /progress) - user wracający później do już dawno ukończonego kursu nie
  // dostaje modala z nagrodą po raz drugi.
  reward?: CourseCompletionReward | null;
}) {
  const router = useRouter();
  const [showReward, setShowReward] = useState(reward !== null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState(false);

  // "Rozpocznij od nowa" (D-069, B-091): archiwizuje to przypisanie i tworzy nowe (POST .../restart), potem
  // router.refresh() - strona jest już pod /courses/[courseId], więc to NIE nawigacja, tylko ponowne pobranie
  // danych servera (nowe /start w page.tsx). page.tsx nadaje <CoursePlayer key={assignmentId}>, więc zmiana
  // assignmentId po restarcie wymusza pełny remount i czysty stan klienta - stąd brak dodatkowej logiki resetu tutaj.
  async function restart() {
    if (!window.confirm('Twój wynik zostanie zachowany w historii, kurs zacznie się od początku. Kontynuować?')) {
      return;
    }
    setRestarting(true);
    setRestartError(false);
    try {
      const response = await fetch(`/api/courses/${courseId}/restart`, { method: 'POST' });
      if (!response.ok) {
        setRestartError(true);
        setRestarting(false);
        return;
      }
      router.refresh();
    } catch {
      setRestartError(true);
      setRestarting(false);
    }
  }

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

      {restartError && (
        <p className="mb-4 text-sm font-medium text-red-600">
          Nie udało się rozpocząć kursu od nowa. Spróbuj ponownie.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/courses"
          className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Wróć do biblioteki kursów
        </Link>
        <button
          type="button"
          onClick={restart}
          disabled={restarting}
          className="inline-block rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
        >
          {restarting ? 'Uruchamianie od nowa…' : 'Rozpocznij od nowa'}
        </button>
      </div>

      {showReward && reward && <CourseRewardModal reward={reward} onClose={() => setShowReward(false)} />}
    </div>
  );
}
