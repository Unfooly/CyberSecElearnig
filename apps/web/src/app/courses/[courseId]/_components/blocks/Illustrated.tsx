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
  cover = false,
  panelLabel,
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
  /**
   * Ilustracja na cały obszar bloku (NARRATIVE z `illustrationLayout: 'cover'`, D-210 - moduł 4): grafika przycięta do obszaru
   * (`object-cover`), treść na grafitowym, lekko przezroczystym panelu u dołu (rozmycie tła pod panelem). Panel zajmuje najwyżej dolne
   * ~2/3 obszaru (telefon w pionie ~3/4, niski ekran prawie całość) i przewija się sam, gdy tekst się nie mieści - grafika zostaje na
   * miejscu. Układ ekranu 'fill'.
   */
  cover?: boolean;
  /** Nazwa regionu panelu w wariancie `cover` (tytuł bloku) - domyślnie opis ilustracji. */
  panelLabel?: string;
  children: ReactNode;
}) {
  const src = illustration ? contentAssetUrl(contentBase, illustration.image, 'image') : null;
  if (!illustration) return <>{children}</>;
  if (cover) {
    // Zła ścieżka grafiki (code review D-210): sam ciemny panel na ciemnym tle - jasny tekst bloku zostaje czytelny.
    return (
      <div data-testid="illustrated" data-variant="cover" className="relative h-full min-h-0 w-full flex-1 overflow-hidden rounded-card bg-[#131313]">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
          <img
            src={src}
            alt={illustration.alt}
            data-testid="illustration"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {/* Niski ekran (telefon w poziomie, wysokość ≤ 500 px): panel może zająć prawie całą wysokość - inaczej długi tekst przewijałby się
            w pasku na 1/3 ekranu. */}
        <div className="absolute inset-x-0 bottom-0 top-1/4 flex items-end p-3 sm:top-1/3 sm:p-6 [@media(max-height:500px)]:top-0 [@media(max-height:500px)]:p-3">
          {/* Fokus i rola regionu: długi tekst przewija się w panelu także z klawiatury (Safari nie daje fokusu przewijanym kontenerom). */}
          <div
            data-testid="illustration-panel"
            tabIndex={0}
            role="region"
            aria-label={panelLabel ?? illustration.alt}
            className="mx-auto max-h-full w-full max-w-4xl overflow-y-auto rounded-card bg-[#1b1a24]/80 px-5 py-4 text-white shadow-lg backdrop-blur-sm [scrollbar-width:thin] sm:px-8 sm:py-6"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
  if (!src) return <>{children}</>;
  // Ekran monitora: kolumny i wysokość ilustracji w `globals.css` (`.monitor-illustrated`) - tym samym zapytaniem kontenerowym co układ
  // monitora (B-182), nie po szerokości okna: wąski obszar bloku przy szerokim oknie (844x390, tablet) to karta w ramce i jedna kolumna.
  const size = screen
    ? 'monitor-illustrated-img'
    : feature
      ? 'max-h-[32dvh] sm:max-h-[min(66dvh,640px)]'
      : 'max-h-[32dvh] sm:max-h-[min(60dvh,420px)]';
  const layout = screen
    ? 'monitor-illustrated'
    : `flex w-full flex-col sm:grid sm:items-center ${
        feature ? 'gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-10' : 'gap-4 sm:grid-cols-2 sm:gap-8'
      }`;
  return (
    <div data-testid="illustrated" data-variant={screen ? 'screen' : feature ? 'feature' : 'slide'} className={layout}>
      <figure
        data-testid="illustration-figure"
        className={`flex shrink-0 justify-center${feature ? ' sm:order-2' : ''}${
          // Pytanie na ekranie monitora na NISKIM telefonie w pionie (wysokość okna ≤ 820 px, np. 360x740, 360x800): ilustracja schowana - treść
          // ma pierwszeństwo (D-200), a pytanie z 4 długimi odpowiedziami (moduł 5) ma się mieścić bez przewijania. Na 390x844 jest (20% wysokości).
          // Próg powtórzony w scripts/layout-check.mjs (q7, `shortPhone`) - zmiana tu wymaga zmiany tam.
          screen ? ' max-sm:[@media(max-height:820px)]:hidden' : ''
        }`}
      >
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
