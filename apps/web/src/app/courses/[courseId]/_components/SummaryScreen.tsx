'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CourseCompletionReward } from '@/lib/courses-types';
import CourseRewardModal from './CourseRewardModal';

export default function SummaryScreen({
  title,
  score,
  scoreUnavailable = false,
  reward = null,
}: {
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
  const [showReward, setShowReward] = useState(reward !== null);

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

      {showReward && reward && <CourseRewardModal reward={reward} onClose={() => setShowReward(false)} />}
    </div>
  );
}
