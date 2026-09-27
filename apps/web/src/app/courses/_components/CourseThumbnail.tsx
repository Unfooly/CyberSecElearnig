'use client';

import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

// Miniatura kursu 16:9 na karcie katalogu i "moich kursów" (D-084): zasób modułu z magazynu treści (CONTENT_BASE_URL), SVG tylko przez
// <img> (D-051). Przy prefers-reduced-motion z #static - zatrzymuje animacje CSS w SVG, jak obrazy scen. Brak albo niepoprawna ścieżka =
// nic (karta pokazuje wtedy dotychczasową ikonę kategorii - wołający sprawdza to tym samym contentAssetUrl).
export default function CourseThumbnail({ contentBase, thumbnail, title }: { contentBase: string; thumbnail: string | null | undefined; title: string }) {
  const src = withStaticFragment(contentAssetUrl(contentBase, thumbnail, 'image'), usePrefersReducedMotion());
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), SVG wyłącznie przez <img> (D-051)
    <img src={src} alt={title} referrerPolicy="no-referrer" loading="lazy" className="block aspect-video w-full rounded-card border border-border bg-paper object-cover" />
  );
}
