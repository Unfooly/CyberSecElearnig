'use client';

import { useEffect, useRef } from 'react';
import { CircleAlert } from 'lucide-react';
import type { QuizResultView } from '@/lib/courses-types';

/**
 * Quiz niezaliczony (D-207): wynik podejścia i próg; przejście dalej tylko przez „Powtórz quiz” w dolnym pasku (jedno miejsce akcji,
 * D-106/D-187) - odtwarzacz wraca do pierwszego pytania quizu (bez ponownej historii). Napisy - interfejs (polski).
 * Dostępność (code review D-207): po pojawieniu się ekranu fokus idzie na nagłówek (tabIndex -1), a cała sekcja jest jego opisem - czytnik
 * ekranu odczytuje „Quiz niezaliczony” i wynik, nie tylko nową etykietę przycisku w pasku. Nagłówek h3 - pod sr-only h2 „Blok X z Y”.
 */
export default function QuizFailedScreen({ result, error }: { result: QuizResultView; error: boolean }) {
  const percent = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section lang="pl" data-testid="quiz-failed" aria-labelledby="quiz-failed-title" aria-describedby="quiz-failed-score" className="mx-auto flex max-w-xl flex-col items-center gap-4 py-6 text-center">
      <CircleAlert aria-hidden="true" className="h-12 w-12 text-danger" />
      <h3 id="quiz-failed-title" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold tracking-[-0.01em] text-ink outline-none">
        Quiz niezaliczony
      </h3>
      <p id="quiz-failed-score" data-testid="quiz-failed-score" className="text-lg text-ink">
        Poprawne odpowiedzi: <span className="font-bold">{result.correct} z {result.total}</span> ({percent}%). Do zaliczenia potrzeba{' '}
        <span className="font-bold">{result.passPercent}%</span>.
      </p>
      <p className="text-base text-muted">
        Wyjaśnienia każdego pytania obejrzysz przyciskiem „Wstecz”. Kliknij „Powtórz quiz”, żeby odpowiedzieć ponownie - historia przed
        quizem zostaje.
      </p>
      {result.attempts > 1 && <p className="text-base text-muted">To było podejście nr {result.attempts}.</p>}
      {error && (
        <p role="alert" className="text-base text-danger">
          Nie udało się uruchomić quizu ponownie. Spróbuj jeszcze raz.
        </p>
      )}
    </section>
  );
}
