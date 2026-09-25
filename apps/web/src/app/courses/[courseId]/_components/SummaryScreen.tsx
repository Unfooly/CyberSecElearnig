'use client';

import { useState } from 'react';
import type { CourseCompletionReward } from '@/lib/courses-types';
import CourseRewardModal from './CourseRewardModal';

// Treść ekranu podsumowania (wynik, nagroda) - BEZ własnych przycisków akcji. Renderuje się jako `stage` WEWNĄTRZ
// PlayerStage (feat/player-stage): "Rozpocznij od nowa"/"Wróć do biblioteki" to teraz przyciski dolnego paska ramki,
// w miejscu Wstecz/Dalej (CoursePlayer.tsx - restart() i nawigacja do /courses tam, nie tutaj), żeby podsumowanie
// wyglądało jak każdy inny blok tej samej ramki, nie osobny ekran z własnym chromem.
export default function SummaryScreen({
  title,
  score,
  scoreUnavailable = false,
  reward = null,
  restartError = false,
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
  /** "Rozpocznij od nowa" (CoursePlayer.tsx) się nie powiodło - komunikat zostaje w treści, przycisk jest w pasku. */
  restartError?: boolean;
}) {
  const [showReward, setShowReward] = useState(reward !== null);

  return (
    <div className="mx-auto max-w-lg rounded-lg bg-white p-8 text-center">
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

      {showReward && reward && <CourseRewardModal reward={reward} onClose={() => setShowReward(false)} />}
    </div>
  );
}
