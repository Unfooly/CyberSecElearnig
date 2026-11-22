'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Award, X } from 'lucide-react';
import { RANK_LABELS, RANK_RING, achievementImage, type AchievementRank } from '@/lib/gamification-types';
import { useHasOverlayStack, useOverlayLayer } from './player/overlay-stack';

/** Odznaka do pokazania (nagroda za ukończenie albo osiągnięcie za easter egg z /explore) - nazwa i grafika w języku gracza z API. */
export interface RewardBadge {
  code: string;
  title: string;
  icon: string;
  rank?: AchievementRank | null;
}

// Małe okienko nagrody (D-199, uwaga właściciela 2026-11-22: „na końcu kursu powinno wyskoczyć okienko takie małe z odznaką lub gdy
// zdobywamy kolejny lvl”; „podczas odblokowania odznaki za GTA powinna się ona wyświetlić na ekranie i user może zamknąć jej podgląd”).
// Grafika odznaki z obwódką w kolorze rangi (jak na profilu, D-174), nazwa, ranga; przy awansie - nowy poziom. Zamykanie: ✕, „Super!”,
// Esc i kliknięcie tła. Pokazujemy WYŁĄCZNIE to, co serwer zgłosił jako zdobyte TERAZ - ponowne przejście kursu nie daje okienka drugi raz.
// W ramce odtwarzacza okno jest warstwą kaskady Escape ('reward', overlay-stack: paski ramki inert); poza nią (ekran końca) - własny Esc.
// Portal do <body>: okno nad całą ramką, niezależnie od przycinania obszaru bloku. Fokus na „Super!”, po zamknięciu wraca tam, gdzie był.
export default function RewardDialog({
  badges,
  level = null,
  onClose,
}: {
  badges: RewardBadge[];
  /** Nowy poziom przy awansie (bez awansu - null). */
  level?: number | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const inStack = useHasOverlayStack();
  useOverlayLayer('reward', true, onClose);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  // Poza ramką odtwarzacza (ekran końca) nikt inny nie obsługuje Escape.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (inStack) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inStack]);

  const heading = badges.length > 1 ? 'Nowe osiągnięcia!' : badges.length === 1 ? 'Nowe osiągnięcie!' : 'Awans!';

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-testid="reward-dialog-backdrop"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="reward-dialog"
        // Tab nie wychodzi z okna (aria-modal): z ostatniego przycisku na pierwszy i odwrotnie.
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'));
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        // Kilka odznak naraz (np. trzeci kurs = osiągnięcia modułu + Trzy sprawy, D-202) na niskim ekranie - okno przewija się w sobie.
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[340px] overflow-y-auto rounded-card bg-surface px-5 pb-5 pt-6 text-center text-ink shadow-[0_18px_40px_rgba(0,0,0,0.45)] motion-safe:animate-badge-pop"
      >
        <button
          type="button"
          aria-label="Zamknij"
          onClick={onClose}
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <h2 id={titleId} className="text-xl font-extrabold">
          {heading}
        </h2>
        {level !== null && (
          <p data-testid="reward-dialog-level" className="mt-1 font-semibold text-accent-ink">
            Awans na poziom {level}
          </p>
        )}
        {badges.length > 0 && (
          <ul className="mt-4 flex flex-wrap justify-center gap-4">
            {badges.map((badge) => {
              const image = achievementImage(badge.icon);
              return (
                <li key={badge.code} data-testid="reward-dialog-badge" className="flex w-[132px] flex-col items-center gap-2">
                  <span className="flex h-24 w-24 items-center justify-center">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- grafika z public/achievements, bez optymalizatora (jak profil)
                      <img src={image} alt="" className={`h-full w-full rounded-full object-cover ring-4 ring-offset-2 ring-offset-surface ${badge.rank ? RANK_RING[badge.rank] : 'ring-border'}`} />
                    ) : (
                      <Award aria-hidden="true" className="h-16 w-16 text-accent" />
                    )}
                  </span>
                  <span className="font-bold leading-tight">{badge.title}</span>
                  {badge.rank && <span className="text-sm text-muted">{RANK_LABELS[badge.rank]}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-5 min-h-[44px] w-full rounded-btn bg-accent px-5 font-bold text-white hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Super!
        </button>
      </div>
    </div>,
    document.body,
  );
}
