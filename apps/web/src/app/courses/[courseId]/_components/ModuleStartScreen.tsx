'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, ShieldCheck, X } from 'lucide-react';
import Logo from '@/components/Logo';
import { contentAssetUrl } from '@/lib/content-assets';
import { categoryLabel } from '@/lib/course-categories';
import type { ModuleInfo } from '@/lib/courses-types';
import { OverlayStackProvider, useCloseTopOverlay } from './player/overlay-stack';
import NarrationControls from './player/NarrationControls';
import type { NarrationBarState } from './player/useNarrationBar';

// Ekran startu modułu (szablon modułu Unfooly, D-163): przed pierwszym blokiem nierozpoczętego kursu. Komputer (≥ 640 px): okładka na całe
// tło, jasny panel z lewej (~50%, zaokrąglona prawa krawędź) z logo, „Sprawa N · ok. X min”, tytułem, jednym zdaniem, Start i CC/głośnikiem;
// kategoria w prawym górnym rogu. Telefon: okładka u góry (pionowa, jeśli jest), karta wysuwająca się od dołu. Brak okładki - #23232A.
// Bez paska postępu i dolnego paska (makieta) - to nie jest blok kursu; „Start” jest gestem, po którym lektor pierwszego bloku może grać.

export interface ModuleStartScreenProps {
  title: string;
  info: ModuleInfo;
  contentBase: string;
  /** Język treści (D-133) - `lang` tytułu i opisu. */
  lang: string;
  onStart: () => void;
  narration: Pick<NarrationBarState, 'captionsOn' | 'toggleCaptions' | 'volume' | 'setVolume'>;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  togglePending?: boolean;
  toggleError?: string | null;
}

export default function ModuleStartScreen(props: ModuleStartScreenProps) {
  return (
    <OverlayStackProvider>
      <StartScreenInner {...props} />
    </OverlayStackProvider>
  );
}

function StartScreenInner({ title, info, contentBase, lang, onStart, narration, narrationEnabled, onToggleNarration, togglePending, toggleError }: ModuleStartScreenProps) {
  const closeTop = useCloseTopOverlay();
  // Escape zamyka okienko głośności (jak w ramce odtwarzacza - jeden nasłuch, overlay-stack).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTop();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeTop]);

  const landscape = contentAssetUrl(contentBase, info.cover?.start, 'image');
  // Telefon: pionowa okładka, bez niej - pozioma wykadrowana do prawej połowy (tam są ważne elementy).
  const portrait = contentAssetUrl(contentBase, info.cover?.startPortrait ?? undefined, 'image');
  const kicker = [info.caseNumber !== null ? `Sprawa ${info.caseNumber}` : null, `ok. ${info.durationMinutes} min`].filter(Boolean).join(' · ');
  const controls = (
    <div className="flex gap-2">
      <NarrationControls state={narration} enabled={narrationEnabled} onToggleEnabled={onToggleNarration} togglePending={togglePending} placement="auto" />
    </div>
  );

  return (
    <div data-testid="module-start" className="relative flex h-dvh flex-col overflow-hidden bg-[#23232A] text-ink">
      {landscape && (
        <picture>
          {portrait && <source media="(max-width: 639px)" srcSet={portrait} />}
          <img
            src={landscape}
            alt=""
            data-testid="module-start-cover"
            // Szeroko (uwaga właściciela 2026-11-17: „przytnij i dopasuj”): okładka tylko w prawej części ekranu (od 40% - pod zaokrągloną
            // krawędzią panelu, JAWNA szerokość 60% - <img> z position:absolute nie rozciąga się między left i right), `cover` kadrowany od lewej
            // strony obrazu, gdzie są postacie - nie znikają pod jasnym panelem. Telefon w pionie bez zmian.
            className="module-start-cover absolute inset-x-0 top-0 h-[58%] w-full object-cover object-[75%_50%] sm:inset-y-0 sm:left-[40%] sm:h-full sm:w-[60%] sm:object-[30%_50%]"
          />
        </picture>
      )}

      {/* Jasny panel z lewej (komputer): zaokrąglona prawa krawędź jak na makiecie (elipsa wycięta z prostokąta). */}
      <div aria-hidden="true" className="module-start-panel absolute inset-y-0 left-0 hidden w-1/2 bg-paper [clip-path:ellipse(100%_120%_at_0%_50%)] sm:block" />

      <header className="relative z-10 flex h-14 shrink-0 items-center px-2 sm:h-16 sm:px-4">
        <Link
          href="/courses"
          aria-label="Zakończ i wróć do listy kursów"
          className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-ink/45 text-white hover:bg-ink/60 sm:bg-transparent sm:text-slate-600 sm:hover:bg-ink/5"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </Link>
        <p
          data-testid="module-start-category"
          className="ml-auto flex min-w-0 items-center gap-2 rounded-full bg-ink/55 px-3 py-[7px] text-xs font-bold uppercase tracking-[0.05em] text-white sm:px-3.5 sm:py-2 sm:text-[13px]"
        >
          <ShieldCheck aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-[#B9B0FF] sm:block" />
          <span className="truncate">{categoryLabel(info.category)}</span>
        </p>
      </header>

      {/* Telefon: miejsce na okładkę nad kartą; komputer: panel w lewej połowie, treść wyśrodkowana w pionie. Na komputerze karta bez
          własnego przewijania (overflow visible - okienko głośności wystaje poza nią), więc treść musi zmieścić się w wysokości: tytuł ≤ 200
          i podtytuł ≤ 300 znaków ze schematu (uwaga startu ≤ 200, D-171), layout-check `start` (s1, s2, s9) pilnuje tego dla 844x390 i
          pseudo-lokalizacji. */}
      <div className="module-start-panel relative flex min-h-0 flex-1 flex-col justify-end sm:w-1/2 sm:justify-center">
        <main
          aria-labelledby="module-start-title"
          className="module-start-card flex max-h-[78%] min-h-[min(470px,56%)] flex-col gap-3.5 overflow-y-auto rounded-t-3xl bg-paper px-5 pb-6 pt-7 sm:max-h-full sm:min-h-0 sm:overflow-visible sm:gap-5 sm:rounded-none sm:bg-transparent sm:py-6 sm:pl-[clamp(24px,7.5vw,96px)] sm:pr-[clamp(24px,6vw,96px)]"
        >
          {/* Logo tylko na komputerze (na telefonie karta zaczyna się od numeru sprawy - makieta). Opakowanie: SVG logo ma display:block
              w stylu, a w kolumnie flex rozciągałby się na całą szerokość. */}
          <div className="module-start-logo hidden self-start sm:block">
            <Logo height={26} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-bold uppercase tracking-[0.09em] text-accent-ink sm:text-sm">{kicker}</p>
            <h1
              id="module-start-title"
              lang={lang}
              className="text-[36px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[clamp(36px,4.1vw,52px)] sm:leading-[1.04]"
            >
              {title}
            </h1>
          </div>
          {info.subtitle && (
            <p lang={lang} className="module-start-subtitle text-base leading-normal text-[#4A4A47] sm:text-lg">
              {info.subtitle}
            </p>
          )}
          {/* Uwaga przed startem w czerwonej ramce (D-171, np. wymagany wcześniejszy moduł) - tylko informacja, Start działa zawsze. */}
          {info.notice && (
            <p
              role="note"
              data-testid="module-start-notice"
              lang={lang}
              className="module-start-notice flex items-start gap-2.5 rounded-xl border-2 border-[#D9483B] bg-[#FDF0EE] px-3.5 py-2.5 text-base font-medium leading-snug text-ink"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#B23A2E]" />
              <span>{info.notice}</span>
            </p>
          )}
          {/* Komputer: [Start] [CC] [głośnik] w jednym rzędzie. Telefon: rząd znika (display: contents) - CC/głośnik pod opisem, Start na
              dole karty na całą szerokość (order), jak na makiecie; jeden przycisk Start w DOM. */}
          <div className="contents sm:mt-1.5 sm:flex sm:items-center sm:gap-[18px]">
            <button
              type="button"
              onClick={onStart}
              className="order-1 mt-auto inline-flex h-[54px] w-full shrink-0 items-center justify-center gap-2.5 rounded-xl bg-ink px-[30px] text-[17px] font-bold text-white hover:bg-slate-800 sm:order-none sm:mt-0 sm:w-auto"
            >
              Start
              <ChevronRight aria-hidden="true" className="h-[18px] w-[18px]" />
            </button>
            {controls}
          </div>
          {/* Telefon: pod Start (ta sama wartość order, kolejność DOM) - zgodnie z kolejnością czytania. */}
          {toggleError && (
            <p role="alert" className="order-1 text-sm text-red-700 sm:order-none">
              {toggleError}
            </p>
          )}
          <p className="module-start-note order-2 text-center text-[13px] text-[#6F6F6B] sm:order-none sm:text-left">
            Postęp zapisuje się sam<span className="hidden sm:inline"> – możesz przerwać w każdej chwili</span>.
          </p>
        </main>
      </div>
    </div>
  );
}
