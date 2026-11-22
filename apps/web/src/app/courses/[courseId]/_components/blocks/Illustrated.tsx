import type { ReactNode } from 'react';
import { contentAssetUrl } from '@/lib/content-assets';

/**
 * Ilustracja obok tekstu albo pytania (D-200, NARRATIVE i QUIZ - moduł 4 według nagrania: „ilustracja z lewej, treść z prawej”).
 * Komputer (≥ 640 px): dwie kolumny wyśrodkowane w pionie - na ekranie monitora ilustracja z lewej (2/5); na slajdzie (NARRATIVE, układ
 * 'feature', D-205 - jak w nagraniach) tekst z lewej, ilustracja z prawej (3/5, do 2/3 wysokości okna). Telefon: ilustracja nad treścią,
 * najwyżej 32% wysokości okna (treść ma pierwszeństwo, tekst trybu prostego ≥ 16 px). Grafika w całości (`object-contain`), bez przycinania.
 * Bez ilustracji (albo przy złej ścieżce) - sama treść, układ bloku bez zmian. QUIZ w trybie prostym rysuje się w monitorze (MonitorStage),
 * którego wysokość idzie łańcuchem flex - oprawa jest wtedy WEWNĄTRZ ekranu monitora (`screen`), nie wokół monitora (code review D-200).
 */
export default function Illustrated({
  illustration,
  contentBase,
  screen = false,
  feature = false,
  children,
}: {
  illustration?: { image: string; alt: string };
  contentBase: string;
  /**
   * Na ekranie monitora (QUIZ w trybie prostym, MonitorStage, D-164): wysokość ilustracji liczona od kontenera `monitor` (cqh), nie od
   * okna - ekran ma stałą wysokość i sam się przewija, gdy treść się nie mieści.
   */
  screen?: boolean;
  /**
   * Żywy ekran z tekstem (NARRATIVE w układzie 'feature', D-205 - jak w nagraniach): tekst z lewej, duża ilustracja z prawej (3/5, do 2/3
   * wysokości okna). Bez tej flagi (podgląd „Wstecz”, QUIZ poza trybem prostym) - układ D-200: ilustracja z lewej, połowa slajdu.
   */
  feature?: boolean;
  children: ReactNode;
}) {
  const src = illustration ? contentAssetUrl(contentBase, illustration.image, 'image') : null;
  if (!illustration || !src) return <>{children}</>;
  const size = screen
    ? 'max-h-[26cqh] sm:max-h-[min(52cqh,360px)]'
    : feature
      ? 'max-h-[32dvh] sm:max-h-[min(66dvh,640px)]'
      : 'max-h-[32dvh] sm:max-h-[min(60dvh,420px)]';
  const columns = screen
    ? 'gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6'
    : feature
      ? 'gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-10'
      : 'gap-4 sm:grid-cols-2 sm:gap-8';
  return (
    <div
      data-testid="illustrated"
      data-variant={screen ? 'screen' : feature ? 'feature' : 'slide'}
      className={`flex w-full flex-col sm:grid sm:items-center ${columns}`}
    >
      <figure className={`flex shrink-0 justify-center${feature ? ' sm:order-2' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next */}
        <img
          src={src}
          alt={illustration.alt}
          data-testid="illustration"
          referrerPolicy="no-referrer"
          className={`h-auto w-auto max-w-full rounded-card object-contain ${size}`}
        />
      </figure>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
