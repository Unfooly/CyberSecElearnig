'use client';

import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { usePortraitContainer } from '@/lib/use-portrait-container';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

/**
 * Tło bloku (B-138): dekoracyjna grafika za treścią bloku (sala odsłuchu za CALL_RECORDING, stół z transkrypcją za omówieniem) -
 * `object-cover` na cały obszar bloku, wariant pionowy na telefonie w pionie (jak grafiki OSINT/omówienia, `usePortraitContainer`).
 * Bez treści do odczytania: `alt=""` i aria-hidden, bez zdarzeń wskaźnika. Rodzic musi mieć `relative isolate` - tło leży pod treścią
 * (`-z-10` w kontekście `isolate`). Grafika dopiero po pomiarze orientacji (bez mignięcia wariantu poziomego). Reduced motion -
 * `#static` (animacje SVG zatrzymane).
 */
export default function BlockBackground({ contentBase, image, imagePortrait }: { contentBase: string; image?: string; imagePortrait?: string }) {
  const [frameRef, portrait] = usePortraitContainer<HTMLDivElement>();
  const reducedMotion = usePrefersReducedMotion();
  if (!image) return null;
  const path = portrait && imagePortrait ? imagePortrait : image;
  const url = portrait === null ? null : withStaticFragment(contentAssetUrl(contentBase, path, 'image'), reducedMotion);
  return (
    <div ref={frameRef} aria-hidden="true" data-testid="block-background" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-card">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
        <img src={url} alt="" referrerPolicy="no-referrer" data-variant={portrait && imagePortrait ? 'portrait' : 'landscape'} className="h-full w-full object-cover" />
      )}
    </div>
  );
}
