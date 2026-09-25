'use client';

import { useEffect, useState } from 'react';
import type { ContentReaction, CourseCompletionReward } from '@/lib/courses-types';
import MascotSays from '@/components/MascotSays';
import RewardCard from './RewardCard';
import CaseEvidenceSection from './CaseEvidenceSection';

// Treść ekranu podsumowania (wynik, nagroda) - BEZ własnych przycisków akcji. Renderuje się jako `stage` WEWNĄTRZ
// PlayerStage (feat/player-stage): "Rozpocznij od nowa"/"Wróć do biblioteki" to dolny pasek ramki, w miejscu
// Wstecz/Dalej (CoursePlayer.tsx - restart() i nawigacja do /courses tam, nie tutaj), żeby podsumowanie wyglądało
// jak każdy inny blok tej samej ramki, nie osobny ekran z własnym chromem.
//
// fix/course-finish-flow: ten ekran pokazuje się OD RAZU po zapisie bloku, który kończy kurs - bez pośredniego
// ekranu "Blok ukończony."/"Zobacz podsumowanie" (CoursePlayer.tsx, skipsFeedbackScreen). Kolejność treści: nagłówek
// + tytuł, wynik, karta nagrody INLINE (RewardCard.tsx - zastępuje dawny modal CourseRewardModal.tsx), reakcja
// Fooli na wynik ostatniego bloku (MascotSays - zwykła treść ekranu, NIE floating overlay jak MascotOverlay.tsx),
// lista zebranych dowodów (CaseEvidenceSection.tsx, dzielona z blocks/SummaryBlock.tsx - ten sam widok, który user
// widział chwilę wcześniej na samym bloku SUMMARY, zanim ten ekran go zastąpił).
export default function SummaryScreen({
  title,
  score,
  scoreUnavailable = false,
  reward = null,
  reaction = null,
  restartError = false,
}: {
  title: string;
  score: number | null;
  // true, gdy pobranie wyniku się nie powiodło - odróżnia to od "kurs
  // naprawdę nie miał ocenianych bloków" (patrz CoursePlayer.tsx).
  scoreUnavailable?: boolean;
  // Obecne WYŁĄCZNIE przy świeżym ukończeniu w tej sesji (z odpowiedzi
  // /progress) - user wracający później do już dawno ukończonego kursu nie
  // dostaje karty nagrody po raz drugi.
  reward?: CourseCompletionReward | null;
  /** Reakcja Fooli na wynik OSTATNIEGO bloku (reactions.result) - ta sama danа, którą normalnie pokazałby pominięty ekran feedbacku. */
  reaction?: ContentReaction | null;
  /** "Rozpocznij od nowa" (CoursePlayer.tsx) się nie powiodło - komunikat zostaje w treści, przycisk jest w pasku. */
  restartError?: boolean;
}) {
  // Region aria-live MUSI istnieć w DOM PUSTY, zanim dostanie treść (ten sam wniosek co przy MascotOverlay.tsx,
  // kod review PR #44/mascot-overlap): ten komponent montuje się od zera dokładnie RAZ, w momencie ukończenia kursu
  // - gdyby treść była w JSX od pierwszego renderu, czytnik ekranu najczęściej nie ogłosiłby regionu, który
  // pojawił się w DOM już wypełniony. Wypełniamy go WKRÓTCE PO montażu (setTimeout 0), nie w tym samym renderze.
  const [xpAnnouncement, setXpAnnouncement] = useState('');
  useEffect(() => {
    if (!reward || reward.xpGained <= 0) return undefined;
    const id = setTimeout(() => setXpAnnouncement(`Zdobyłeś ${reward.xpGained} punktów doświadczenia.`), 0);
    return () => clearTimeout(id);
  }, [reward]);

  return (
    <div className="mx-auto max-w-lg rounded-lg bg-white p-8 text-center">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Sprawa zamknięta</h1>
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

      <RewardCard reward={reward} />

      {reaction && (
        <div className="mb-6 text-left">
          <MascotSays pose={reaction.pose} text={reaction.text} />
        </div>
      )}

      <CaseEvidenceSection className="text-left" />

      <p data-testid="xp-announcement" className="sr-only" aria-live="polite">
        {xpAnnouncement}
      </p>
    </div>
  );
}
