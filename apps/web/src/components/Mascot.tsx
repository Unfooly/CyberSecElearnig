'use client';

import { useState } from 'react';
import type { MascotPose } from '@cyberszkolo/content';

// Maskotka Unfooly. Grafiki (packages/content/mascot) są kopiowane do apps/web/public/mascot w buildzie (scripts/sync-mascot.mjs) i ładowane
// przez <img>: SVG nigdy inline ani przez dangerouslySetInnerHTML (D-051). Gdy pliku nie ma w buildzie albo poza jest nieznana, pokazujemy
// prosty placeholder. Sama maskotka bez dymka; z dymkiem z tekstem bloku jest MascotSays.

export const MASCOT_POSES: readonly MascotPose[] = ['greeting', 'thinking', 'pointing', 'cheer', 'warning'];

const LABELS: Record<MascotPose, string> = {
  greeting: 'Maskotka Unfooly wita',
  thinking: 'Maskotka Unfooly się zastanawia',
  pointing: 'Maskotka Unfooly wskazuje',
  cheer: 'Maskotka Unfooly się cieszy',
  warning: 'Maskotka Unfooly ostrzega',
};

const isPose = (value: string): value is MascotPose => (MASCOT_POSES as readonly string[]).includes(value);

function Placeholder({ label, size, className }: { label: string; size: number; className: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="mascot-placeholder"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`shrink-0 ${className}`}
    >
      <circle cx="50" cy="50" r="44" fill="#6C5CE7" />
      <circle cx="36" cy="42" r="6" fill="#fff" />
      <circle cx="64" cy="42" r="6" fill="#fff" />
      <path d="M32 64 Q50 78 68 64" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function Mascot({
  pose,
  size = 96,
  className = '',
}: {
  pose: MascotPose | string;
  /** Rozmiar w px (atrybuty width/height); responsywne rozmiary ustawia className (np. `h-20 w-20 sm:h-32 sm:w-32`). */
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const known = isPose(pose);
  const label = known ? LABELS[pose] : 'Maskotka Unfooly';

  return known && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element -- statyczny plik z public/, rozmiar znany, fallback przy błędzie
    <img
      src={`/mascot/fooli-${pose}.svg`}
      alt={label}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      onError={() => setFailed(true)}
    />
  ) : (
    <Placeholder label={label} size={size} className={className} />
  );
}
