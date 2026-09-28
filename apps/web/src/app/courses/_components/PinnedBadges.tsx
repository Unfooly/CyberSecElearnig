'use client';

import { useEffect, useRef, useState } from 'react';
import { achievementImage, type PinnedAchievement } from '@/lib/gamification-types';

/**
 * Przypięte osiągnięcia przy nazwisku (ranking, nagłówek profilu; D-112): do 3 miniatur 24 px. Nazwa w podpowiedzi (`title`,
 * najechanie myszą) i w nazwie dostępnej; na ekranie dotykowym stuknięcie pokazuje nazwę w dymku (ponowne stuknięcie, Escape
 * albo stuknięcie obok chowa).
 */
export default function PinnedBadges({ pinned, className = '' }: { pinned: PinnedAchievement[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const shown = pinned.slice(0, 3);
  if (shown.length === 0) return null;

  return (
    <ul ref={rootRef} className={`inline-flex items-center gap-1 ${className}`} aria-label="Przypięte osiągnięcia" data-testid="pinned-badges">
      {shown.map((badge) => {
        const image = achievementImage(badge.icon);
        return (
          <li key={badge.code} className="relative">
            <button
              type="button"
              title={badge.title}
              aria-label={badge.title}
              aria-expanded={open === badge.code}
              onClick={() => setOpen((current) => (current === badge.code ? null : badge.code))}
              className="block h-6 w-6 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              data-testid="pinned-badge"
            >
              {image && (
                // eslint-disable-next-line @next/next/no-img-element -- statyczny SVG z public/achievements; SVG wyłącznie przez <img> (D-051)
                <img src={image} alt="" width={24} height={24} className="h-6 w-6" />
              )}
            </button>
            {open === badge.code && (
              <span
                role="tooltip"
                className="absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-btn bg-ink px-2 py-1 text-xs font-semibold text-white shadow-card"
              >
                {badge.title}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
