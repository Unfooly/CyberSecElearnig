'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { contentAssetUrl } from '@/lib/content-assets';

/**
 * Okno na pulpicie komputera ze sceny (D-184/D-186, uwagi właściciela 2026-11-20: zadanie z domeną „na monitorze, z zoomem i tłem”, okno
 * „wbudowane w wyświetlacz”). Z `screen` (prostokąt ekranu na grafice, %): jak telefon (PhoneStage) - grafika skalowana tak, żeby EKRAN
 * wypełniał obszar bloku (z marginesem), a okno leży dokładnie w ekranie i przewija się w nim. Na wąskim/wysokim obszarze (telefon w pionie
 * - ekran monitora byłby za niski na okno) i bez `screen`: grafika na cały obszar (cover), okno wyśrodkowane nad nią. Wejście z lekkim
 * najazdem (tylko bez reduced-motion, globals.css .desktop-stage*). Grafika dekoracyjna (alt=""), treść okna w sekcji z etykietą.
 */
export default function DesktopStage({
  contentBase,
  background,
  screen,
  label,
  children,
}: {
  contentBase: string;
  background: string;
  screen?: { x: number; y: number; width: number; height: number };
  label: string;
  children: ReactNode;
}) {
  const url = contentAssetUrl(contentBase, background, 'image');
  const [ratio, setRatio] = useState<number | null>(null);
  const style = screen
    ? ({
        '--desk-ratio-n': ratio ?? 16 / 9,
        '--screen-left': `${screen.x}%`,
        '--screen-top': `${screen.y}%`,
        '--screen-width': `${screen.width}%`,
        '--screen-height': `${screen.height}%`,
        '--screen-w-n': screen.width / 100,
        '--screen-h-n': screen.height / 100,
        '--screen-cx': `${screen.x + screen.width / 2}%`,
        '--screen-cy': `${screen.y + screen.height / 2}%`,
      } as CSSProperties)
    : undefined;
  return (
    <div data-testid="desktop-stage" data-screen={screen ? 'true' : undefined} className="desktop-stage" style={style}>
      <div className="desktop-stage-frame">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
          <img
            // Obraz wczytany przed hydracją (cache) nie da już onLoad - proporcje od razu z gotowego obrazu.
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
                const value = img.naturalWidth / img.naturalHeight;
                if (ratio !== value) setRatio(value);
              }
            }}
            src={url}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="desktop-stage-bg"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
            }}
          />
        )}
        <section aria-label={label} data-testid="desktop-window" className="desktop-stage-window">
          {children}
        </section>
      </div>
    </div>
  );
}
