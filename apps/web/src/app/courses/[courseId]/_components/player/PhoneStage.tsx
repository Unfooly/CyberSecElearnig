'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { contentAssetUrl } from '@/lib/content-assets';
import { usePortraitContainer } from '@/lib/use-portrait-container';

/** Prostokąt ekranu urządzenia w % grafiki (DOSSIER.phone, D-181). */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Telefon ze sceny z treścią NA jego ekranie (D-181, uwaga właściciela 2026-11-20: „messenger ma się wyświetlić na ekranie tego telefonu,
 * a nie w nowym oknie”). Jak monitor (MonitorStage, D-164/D-166): grafika jest skalowana tak, żeby EKRAN (nie cała grafika) wypełniał
 * obszar bloku z marginesem, środkiem na środku obszaru - reszta biurka wychodzi poza obszar i jest przycinana. Proporcje grafiki
 * z załadowanego obrazu (do tego czasu ramka niewidoczna, bez skoku układu). Telefon w pionie (kontener < 0.8) - wariant pionowy, jeśli
 * treść go ma. Grafika dekoracyjna (alt=""), treść ekranu w sekcji z etykietą.
 */
export default function PhoneStage({
  contentBase,
  image,
  screen,
  imagePortrait,
  screenPortrait,
  label,
  children,
}: {
  contentBase: string;
  image: string;
  screen: ScreenRect;
  imagePortrait?: string;
  screenPortrait?: ScreenRect;
  label: string;
  children: ReactNode;
}) {
  const [stageRef, portrait] = usePortraitContainer<HTMLDivElement>();
  const usePortraitVariant = portrait === true && !!imagePortrait && !!screenPortrait;
  const path = usePortraitVariant ? imagePortrait : image;
  const rect = usePortraitVariant ? screenPortrait! : screen;
  // Proporcje per plik - po przełączeniu wariantu (obrót telefonu) czekamy na nowy obraz.
  const [ratio, setRatio] = useState<{ path: string; value: number } | null>(null);
  const ratioValue = ratio?.path === path ? ratio.value : null;
  const url = portrait === null ? null : contentAssetUrl(contentBase, path, 'image');

  const style = {
    '--phone-ratio-n': ratioValue ?? 1,
    '--screen-left': `${rect.x}%`,
    '--screen-top': `${rect.y}%`,
    '--screen-width': `${rect.width}%`,
    '--screen-height': `${rect.height}%`,
    '--screen-w-n': rect.width / 100,
    '--screen-h-n': rect.height / 100,
    '--screen-cx': `${rect.x + rect.width / 2}%`,
    '--screen-cy': `${rect.y + rect.height / 2}%`,
  } as CSSProperties;

  return (
    <div ref={stageRef} data-testid="phone-stage" data-variant={usePortraitVariant ? 'portrait' : 'landscape'} className="phone-stage" style={style}>
      {url && (
        // Przezroczystość, nie visibility: treść ekranu zostaje dostępna (czytnik, testy), zanim obraz poda proporcje.
        <div className="phone-stage-frame" style={{ opacity: ratioValue === null ? 0 : 1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL */}
          <img
            src={url}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="phone-stage-img"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setRatio({ path, value: naturalWidth / naturalHeight });
            }}
            // Grafika się nie wczytała: ekran i tak się pokazuje (proporcje zastępcze), rozmowy da się przejść.
            onError={() => setRatio({ path, value: usePortraitVariant ? 9 / 16 : 16 / 9 })}
          />
          <section aria-label={label} data-testid="phone-screen" className="phone-stage-screen">
            {children}
          </section>
        </div>
      )}
    </div>
  );
}
