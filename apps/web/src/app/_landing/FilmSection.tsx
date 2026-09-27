'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { prefersReducedMotion } from '@/lib/motion';
import { BTN_LG, WRAP } from './layout-constants';

// Film marketingowy (feat/marketing-film, D-091): 26 s, MP4 z docs/marketing/film (render-film.mjs), serwowany z public/marketing - CSP
// `media-src 'self'`. Wyciszony, w pętli, inline. Autoodtwarzanie wyłącznie bez prefers-reduced-motion: serwer i pierwszy render klienta
// NIE mają atrybutu autoplay (preferencji nie znamy przed hydratacją - bez niezgodności), film startuje z efektu. Przy reduced-motion albo
// gdy przeglądarka odrzuci autostart - plakat i duży przycisk „Odtwórz film” (dopiero wtedy natywne kontrolki). Autostartujący film ma
// zawsze mały przycisk pauzy (WCAG 2.2.2), a pod filmem jest jego opis tekstowy (film bez dźwięku - WCAG 1.2.1).
export const FILM_SRC = '/marketing/unfooly-film.mp4';
export const FILM_POSTER = '/marketing/unfooly-film-poster.jpg';

/** Tekstowy odpowiednik filmu (sceny z docs/marketing/film/unfooly-film.html). */
const FILM_DESCRIPTION = [
  'Wtorek, 8:47. Do skrzynki księgowej przychodzi „pilny” mail od „Banku Wektor”: nietypowa aktywność, weryfikacja w ciągu 30 minut, inaczej blokada rachunku.',
  '8:58. Jedno kliknięcie w „Przejdź do weryfikacji” otwiera stronę bankwektor-weryfikacja.pl, gdzie pracownica wpisuje login i hasło.',
  '9:06. Przychodzi SMS z kodem autoryzującym przelew 14 000 zł. O 9:12 przelew na Wektor Rozliczenia Sp. z o.o. jest wykonany - pieniądze znikają.',
  'Cofamy czas: ten sam mail ma trzy sygnały - obca domena nadawcy, presja („PILNE”) i termin „na już”. Zgłoszenie przyciskiem „Zgłoś podejrzany mail” trafia do działu IT w pięć sekund.',
  'Na koniec: Unfooly - szkolenia z cyberbezpieczeństwa oparte na prawdziwych sprawach. Firma, bank i kwoty są fikcyjne.',
];

type Auto = 'pending' | 'playing' | 'blocked';

export default function FilmSection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [userStarted, setUserStarted] = useState(false);
  // Autostart: 'pending' do pierwszej próby (przycisk "Odtwórz" jeszcze niewidoczny - bez mignięcia przy każdym wejściu), 'blocked' przy
  // reduced-motion albo odrzuconym play().
  const [auto, setAuto] = useState<Auto>('pending');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || userStarted) return;
    // Hook startuje od false (bez niezgodności SSR) - preferencja czytana też wprost, żeby film nie ruszył na chwilę przy reduced-motion.
    if (reducedMotion || prefersReducedMotion()) {
      video.pause();
      setAuto('blocked');
      return;
    }
    let cancelled = false;
    video
      .play()
      .then(() => !cancelled && setAuto('playing'))
      .catch(() => !cancelled && setAuto('blocked'));
    return () => {
      cancelled = true;
    };
  }, [reducedMotion, userStarted]);

  function start() {
    setUserStarted(true);
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {});
    // Przycisk znika - fokus na film (z natywnymi kontrolkami), nie na body.
    video.focus();
  }

  function togglePause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  const showBigPlay = !userStarted && auto === 'blocked' && !playing;
  const showToggle = !userStarted && auto === 'playing';

  return (
    <section aria-labelledby="film-heading" className="py-12 lg:py-16">
      <div className={`${WRAP} flex flex-col items-center gap-6`}>
        <h2 id="film-heading" className="text-center text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em] sm:text-[32px]">
          Tak wygląda jedno kliknięcie.
        </h2>
        <div className="relative w-full max-w-[960px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-card">
          <video
            ref={videoRef}
            data-testid="landing-film"
            className="block aspect-video w-full"
            src={FILM_SRC}
            poster={FILM_POSTER}
            muted
            loop
            playsInline
            controls={userStarted}
            tabIndex={userStarted ? 0 : -1}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            aria-label="Film: jak jedno kliknięcie w mail phishingowy prowadzi do utraty pieniędzy (opis pod filmem)"
            aria-describedby="film-description-text"
          />
          {showBigPlay && (
            <button
              type="button"
              onClick={start}
              className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-card transition-colors duration-base hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label="Odtwórz film"
            >
              <Play size={28} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
          {showToggle && (
            // WCAG 2.2.2: autostartujący film (pętla > 5 s) zawsze da się zatrzymać.
            <button
              type="button"
              onClick={togglePause}
              className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink/70 text-white transition-colors duration-base hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label={playing ? 'Wstrzymaj film' : 'Wznów film'}
            >
              {playing ? <Pause size={20} strokeWidth={2.4} aria-hidden="true" /> : <Play size={20} strokeWidth={2.4} aria-hidden="true" />}
            </button>
          )}
        </div>
        <details id="film-description" className="w-full max-w-[960px] text-sm text-muted">
          <summary className="cursor-pointer font-semibold text-ink">Opis filmu</summary>
          {/* Opis wskazany wprost (lista, nie <details>) - czytnik poda pełny tekst także przy zwiniętym opisie. */}
          <ol id="film-description-text" className="mt-2 list-decimal space-y-1 pl-5">
            {FILM_DESCRIPTION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </details>
        <ButtonLink href="/register" className={BTN_LG}>
          Załóż konto firmy <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
        </ButtonLink>
      </div>
    </section>
  );
}
