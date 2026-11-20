'use client';

import type { ReactNode } from 'react';
import { contentAssetUrl } from '@/lib/content-assets';

/**
 * Okno na pulpicie komputera ze sceny (D-184, uwaga właściciela 2026-11-20: zadanie z domeną „na monitorze, z zoomem i tłem”): grafika
 * sceny (pulpit z ramką monitora) wypełnia obszar bloku i lekko się przybliża przy wejściu, nad nią - okno (np. przeglądarka) wyśrodkowane,
 * przewijane w sobie, gdy się nie mieści. Grafika dekoracyjna (alt=""), treść okna w sekcji z etykietą. Ruch tylko bez reduced-motion
 * (globals.css, .desktop-stage*).
 */
export default function DesktopStage({
  contentBase,
  background,
  label,
  children,
}: {
  contentBase: string;
  background: string;
  label: string;
  children: ReactNode;
}) {
  const url = contentAssetUrl(contentBase, background, 'image');
  return (
    <div data-testid="desktop-stage" className="desktop-stage">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
        <img src={url} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="desktop-stage-bg" />
      )}
      <section aria-label={label} data-testid="desktop-window" className="desktop-stage-window">
        {children}
      </section>
    </div>
  );
}
