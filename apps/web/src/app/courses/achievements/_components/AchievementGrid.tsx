'use client';

import { useState } from 'react';
import { formatDateShort } from '@/lib/datetime';
import { RANK_LABELS, achievementImage, type AchievementRank, type Badge } from '@/lib/gamification-types';

// Karty osiągnięć (D-111, dopisek A): klik / Enter / Spacja obraca kartę o 180° wokół osi Y (perspektywa 900 px, 500 ms,
// ease-in-out-soft), ponowny klik wraca; naraz odwrócona jest jedna karta. Przy prefers-reduced-motion zamiast obrotu
// crossfade 150 ms. Rewers (tło w kolorze rangi): ranga, nazwa, opis po polsku, potem data zdobycia / warunek / tekst tajnego.
// Rewers czyta czytnik ekranu przez region aria-live (karta to przycisk z aria-pressed).

const RANK_BACK: Record<AchievementRank, string> = {
  SECRET: 'bg-rank-secret',
  LEGENDARY: 'bg-rank-legendary',
  MILESTONE: 'bg-rank-milestone',
  RARE: 'bg-rank-rare',
};

export const SECRET_TEXT = 'To osiągnięcie jest tajne. Szukaj uważnie.';

function rankLabel(badge: Badge): string {
  return badge.rank ? RANK_LABELS[badge.rank] : '';
}

/** Ostatnia linia rewersu: data zdobycia, warunek albo tekst tajnego osiągnięcia. */
function backStatus(badge: Badge): string {
  if (badge.isUnlocked && badge.unlockedAt) return `Zdobyto: ${formatDateShort(badge.unlockedAt)}`;
  if (badge.hidden) return SECRET_TEXT;
  return badge.conditionText ?? '';
}

/** Tekst rewersu do regionu aria-live (to samo, co widać na rewersie). */
export function backText(badge: Badge): string {
  const secretLocked = badge.hidden && !badge.isUnlocked;
  return [rankLabel(badge), secretLocked ? null : badge.title, secretLocked ? null : badge.description, backStatus(badge)]
    .filter((part): part is string => !!part)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

function AchievementCard({
  badge,
  flipped,
  onToggle,
  pinned,
  onTogglePin,
}: {
  badge: Badge;
  flipped: boolean;
  onToggle: () => void;
  pinned: boolean;
  onTogglePin?: (code: string) => void;
}) {
  // Przycisk przypięcia (D-112) tylko na rewersie ZDOBYTEJ karty - obok przycisku obrotu (nie w nim: przycisk w przycisku).
  const canPin = badge.isUnlocked && !!onTogglePin;
  const secretLocked = badge.hidden && !badge.isUnlocked;
  const name = secretLocked ? '???' : (badge.title ?? '');
  const image = achievementImage(badge.isUnlocked ? badge.icon : (badge.lockedIcon ?? badge.icon));
  const rank = rankLabel(badge);
  const back = badge.rank ? RANK_BACK[badge.rank] : 'bg-ink';

  return (
    <li className="relative">
      <button
        type="button"
        aria-pressed={flipped}
        aria-label={`${secretLocked ? 'Tajne osiągnięcie' : name}${rank ? ` (${rank})` : ''}, ${badge.isUnlocked ? 'zdobyte' : 'niezdobyte'}. Odwróć kartę`}
        onClick={onToggle}
        data-testid="achievement-card"
        data-code={badge.code}
        data-unlocked={badge.isUnlocked}
        data-flipped={flipped}
        className="block w-full rounded-card text-left [perspective:900px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span
          className={`relative block aspect-[3/4] w-full transition-transform duration-500 ease-in-out-soft [transform-style:preserve-3d] motion-reduce:transition-none ${
            flipped ? 'motion-safe:[transform:rotateY(180deg)]' : ''
          }`}
        >
          {/* Awers */}
          <span
            data-testid="achievement-front"
            className={`absolute inset-0 flex flex-col items-center justify-between rounded-card border border-border p-3 shadow-card [backface-visibility:hidden] motion-reduce:transition-[opacity,visibility] motion-reduce:duration-150 ${
              flipped ? 'motion-reduce:invisible motion-reduce:opacity-0' : ''
            } ${badge.isUnlocked ? 'bg-surface' : 'bg-paper'}`}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- statyczny SVG z public/achievements; SVG wyłącznie przez <img> (D-051)
              <img src={image} alt="" className="aspect-square w-full max-w-[180px] object-contain" />
            ) : (
              <span className="aspect-square w-full" />
            )}
            <span className="flex w-full flex-col items-center gap-0.5 text-center">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{rank}</span>
              <span className={`text-sm font-bold leading-tight sm:text-base ${badge.isUnlocked ? 'text-ink' : 'text-muted'}`}>{name}</span>
            </span>
          </span>
          {/* Rewers */}
          <span
            data-testid="achievement-back"
            aria-hidden="true"
            className={`absolute inset-0 flex flex-col rounded-card text-white [backface-visibility:hidden] motion-safe:[transform:rotateY(180deg)] motion-reduce:transition-[opacity,visibility] motion-reduce:duration-150 ${back} ${
              flipped ? '' : 'motion-reduce:invisible motion-reduce:opacity-0'
            }`}
          >
            {/* Tekst przewija się w swojej części karty - nad miejscem na przycisk przypięcia (przycisk niczego nie zasłania). */}
            <span data-testid="achievement-back-scroll" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              <span className="text-xs font-bold uppercase tracking-[0.1em] text-white/80">{rank}</span>
              {!secretLocked && <span className="text-[17px] font-extrabold leading-tight">{badge.title}</span>}
              {!secretLocked && badge.description && <span className="text-[15px] leading-snug">{badge.description}</span>}
              <span className="mt-auto text-[15px] font-semibold leading-snug">{backStatus(badge)}</span>
            </span>
            {canPin && <span aria-hidden="true" className="h-[76px] shrink-0" />}
          </span>
        </span>
      </button>
      {canPin && flipped && (
        <button
          type="button"
          onClick={() => onTogglePin!(badge.code)}
          aria-label={`${pinned ? 'Odepnij' : 'Przypnij do profilu'}: ${badge.title ?? ''}`}
          data-testid="achievement-pin"
          className="absolute inset-x-3 bottom-3 z-10 min-h-[44px] rounded-btn bg-white px-3 text-[15px] font-bold text-ink shadow-card hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-safe:animate-overlay-in"
        >
          {pinned ? 'Odepnij' : 'Przypnij do profilu'}
        </button>
      )}
    </li>
  );
}

export default function AchievementGrid({
  badges,
  pinnedCodes = [],
  onTogglePin,
}: {
  badges: Badge[];
  // Przypięte kody (D-112) i przełączenie przypięcia - bez nich karty są tylko do oglądania.
  pinnedCodes?: string[];
  onTogglePin?: (code: string) => void;
}) {
  const [flippedCode, setFlippedCode] = useState<string | null>(null);

  if (badges.length === 0) {
    return <p className="text-sm text-muted">Brak osiągnięć do wyświetlenia.</p>;
  }

  const flipped = badges.find((badge) => badge.code === flippedCode) ?? null;

  return (
    <>
      <ul className="grid max-w-[780px] grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4" aria-label="Osiągnięcia">
        {badges.map((badge) => (
          <AchievementCard
            key={badge.code}
            badge={badge}
            flipped={flippedCode === badge.code}
            onToggle={() => setFlippedCode((current) => (current === badge.code ? null : badge.code))}
            pinned={pinnedCodes.includes(badge.code)}
            onTogglePin={onTogglePin}
          />
        ))}
      </ul>
      <p aria-live="polite" className="sr-only" data-testid="achievement-live">
        {flipped ? backText(flipped) : ''}
      </p>
    </>
  );
}
