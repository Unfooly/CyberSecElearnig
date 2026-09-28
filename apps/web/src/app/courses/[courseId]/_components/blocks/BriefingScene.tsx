'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import type { BriefingRect, BriefingStep } from '@/lib/courses-types';
import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { badgeNumber, type PlayerIdentity } from '@/lib/use-my-display-name';
import { usePortraitContainer } from '@/lib/use-portrait-container';
import type { NotebookTask } from '../player/notes';

// Krok odprawy jako SCENA z grafiką (feat/briefing-scenes, D-084) zamiast karty na jasnym tle. Obraz sceny (1600x900) w pudełku
// "contain" (.briefing-scene-box, globals.css: mniejsza z szerokości kontenera i wysokości x proporcja - bez panoramy i bez
// przewijania, także na telefonie w pionie), na nim w % sceny: przedmiot kroku (przycisk = cta, D-086), sloty z HTML (zadania sprawy, dane
// gracza z sesji) i teksty kroku (pasek maszyny do pisania u góry, dymek komisarza w prawej połowie). Każdy tekst na scenie
// dopasowuje rozmiar czcionki do swojego prostokąta (FitText) - bez przepełnień na żadnej rozdzielczości (layout-check).
//
// Dostępność (D-086): przedmiot kroku to zwykły przycisk w kolejności Tab z etykietą (cta kroku albo "Otwórz teczkę") i widocznym
// focusem - jedyne przejście dalej; przycisk cta pod sceną tylko dla kroku bez przedmiotu albo gdy obraz się nie wczytał. Obraz ma pusty alt: treść kroku jest w HTML (widoczna albo sr-only), a dane karty
// sprawy, narysowane w grafice, czytnik dostaje z pól kroku.

/**
 * Drugi i kolejne kliknięcia jednej serii (podwójny klik: `detail` > 1) są ignorowane - przycisk kroku i hotspot stoją w tym samym
 * miejscu przy kolejnych krokach, więc nawykowy podwójny klik przeskakiwałby cały następny krok (np. akta z zadaniami). Klawiatura
 * daje `detail` = 0, więc Enter/Spacja działają jak zwykle.
 */
export function singleClick(handler: () => void) {
  return (event: { detail: number }) => {
    if (event.detail > 1) return;
    handler();
  };
}

/** Po tylu ms bez akcji przedmiot kroku dostaje pulsującą obwódkę (D-086). */
export const IDLE_MS = 4000;
/** Etykieta przedmiotu zamkniętej teczki (faza przed otwarciem akt). */
export const OPEN_CASE_LABEL = 'Otwórz teczkę';

/**
 * Aktywny przedmiot kroku (D-086): prostokąt i etykieta dla czytnika. Teczka w dwóch fazach: zamknięta - `hotspot` ("Otwórz teczkę"),
 * otwarta - `openHotspot` (etykieta = cta, np. "Zamknij teczkę"). Pozostałe kroki - `hotspot` z etykietą cta. null = krok bez przedmiotu
 * (wtedy przycisk cta pod sceną, jak przed D-086).
 */
export function activeHotspot(step: BriefingStep, caseOpen: boolean): { rect: BriefingRect; label: string } | null {
  if (!step.image) return null;
  if (step.kind === 'caseFile' && step.closedImage) {
    if (!caseOpen) return step.hotspot ? { rect: step.hotspot, label: OPEN_CASE_LABEL } : null;
    return step.openHotspot ? { rect: step.openHotspot, label: step.cta } : null;
  }
  return step.hotspot ? { rect: step.hotspot, label: step.cta } : null;
}

/** Styl pozycjonujący prostokąt w % sceny. */
export function rectStyle(rect: BriefingRect): CSSProperties {
  return { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
}

// Pasek tekstu kroku u góry sceny (typewriter, start) i dymek rozmowy w prawej połowie (call, x >= 45%) - stałe układu, nie treść.
const TOP_BAND: BriefingRect = { x: 4, y: 3, w: 92, h: 15 };
const CALL_BUBBLE: BriefingRect = { x: 46, y: 12, w: 50, h: 64 };
// Scena pionowa (9:16, D-098): pasek tekstu węższy w pionie (ta sama szerokość, mniejsza wysokość w % wyższej sceny), dymek komisarza
// w DOLNEJ części sceny (y >= 62%), pod telefonem z czerwoną słuchawką.
// h 14 (D-103): tekst maszyny do pisania ma na telefonie min. 15 px - przy 11% sceny zwężał się do ~14 px na 360 px.
const TOP_BAND_PORTRAIT: BriefingRect = { x: 4, y: 2, w: 92, h: 14 };
// Górne granice czcionki (ułamek wysokości slotu) w scenie pionowej (D-103): sloty 9:16 na telefonie są niskie, a tekst ma mieć min.
// 15 px - wyższa granica pozwala FitText dojść do 15 px, gdy treść się mieści (dłuższa - np. bardzo długie imię - nadal się zmniejszy).
const TASKS_MAX_RATIO = { landscape: 0.08, portrait: 0.1 };
const BADGE_TEXT_MAX_RATIO = { landscape: 0.62, portrait: 1 };
// Czytelne minimum tekstu na telefonie (D-103) - pola legitymacji w pionowej grafice są niższe niż 15 px (FitText minPx).
const READABLE_MIN_PX = 15;
const CALL_BUBBLE_PORTRAIT: BriefingRect = { x: 5, y: 62, w: 90, h: 30 };

/**
 * Scena kroku w bieżącej orientacji (D-098): pola sceny poziomej albo - w trybie pionowym i przy `portrait` w treści - pionowej
 * (obraz, zamknięta teczka, hotspoty, sloty). Reszta kroku (tekst, cta, zadania) bez zmian. Bez `portrait` - zawsze scena pozioma.
 * `closedImage`/`openHotspot` pionu semantyka treści dopuszcza tylko tam, gdzie są w poziomie (czyli w caseFile).
 */
export function sceneForOrientation(step: BriefingStep, portrait: boolean): BriefingStep {
  if (!portrait || !step.portrait) return step;
  const { image, closedImage, hotspot, openHotspot, slots } = step.portrait;
  return { ...step, image, hotspot, slots, ...(step.kind === 'caseFile' ? { closedImage, openHotspot } : {}) } as BriefingStep;
}

const MIN_FONT_PX = 6;

/**
 * Kontener, który dobiera rozmiar czcionki (px) tak, żeby treść zmieściła się w nim bez przepełnienia: największy z przedziału
 * [MIN_FONT_PX, max], przy którym scrollWidth/scrollHeight nie przekraczają wymiarów (wyszukiwanie binarne, ponownie przy zmianie
 * rozmiaru - ResizeObserver - i treści - `fitKey`). Dzieci używają `em`, więc skalują się razem z kontenerem.
 */
export function FitText({
  className = '',
  style,
  maxRatio,
  fitKey,
  children,
  testId,
  minPx,
}: {
  className?: string;
  style?: CSSProperties;
  /** Górny rozmiar czcionki jako ułamek wysokości kontenera. */
  maxRatio: number;
  fitKey: string;
  children: ReactNode;
  testId?: string;
  /**
   * Czytelne minimum (D-103, np. 15 px na telefonie): rozmiar do `minPx` może wyjść poza WYSOKOŚĆ kontenera (overflow widoczny - niski
   * slot w grafice, tekst rośnie w odstęp nad nim), ale nadal musi zmieścić się w szerokości - inaczej zmniejsza się jak zwykle.
   * Tylko dla tekstu JEDNOLINIJKOWEGO (whitespace-nowrap) - zawijany tekst „mieści się” w szerokości zawsze i mógłby wyjść dowolnie wysoko.
   */
  minPx?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const fit = () => {
      const fitsWidth = () => element.scrollWidth <= element.clientWidth + 1;
      const fitsHeight = () => element.scrollHeight <= element.clientHeight + 1;
      const fits = (size: number) => fitsWidth() && (fitsHeight() || (minPx !== undefined && size <= minPx));
      const setSize = (size: number) => {
        element.style.fontSize = `${size}px`;
      };
      element.style.overflow = '';
      let high = Math.max(MIN_FONT_PX, element.clientHeight * maxRatio, minPx ?? 0);
      let low = MIN_FONT_PX;
      setSize(high);
      if (!fits(high)) {
        for (let step = 0; step < 10; step += 1) {
          const middle = (low + high) / 2;
          setSize(middle);
          if (fits(middle)) low = middle;
          else high = middle;
        }
        // Wyszukiwanie binarne kończy tuż pod granicą - gdy samo minimum się mieści, dokładnie minPx (nie 14,99 px).
        if (minPx !== undefined && low < minPx && fits(minPx)) low = minPx;
        setSize(low);
      }
      // Tekst o czytelnym minimum wyższy niż slot - widoczny w całości (bez ucięcia przez overflow-hidden kontenera). Tylko z minPx:
      // bez niego treść, która nie mieści się nawet przy MIN_FONT_PX, zostaje przycięta jak dotąd (nie wylewa się na scenę). Bez
      // tolerancji 1 px z fitsHeight - ułamek piksela nad slotem też byłby ucięty.
      if (minPx !== undefined && element.scrollHeight > element.clientHeight) element.style.overflow = 'visible';
    };
    fit();
    // Font (Plus Jakarta, display: swap) doładowany po pierwszym dopasowaniu zmienia wymiary tekstu, ale nie pudełka - ResizeObserver
    // by tego nie zauważył, a tekst dopasowany do fontu zastępczego mógłby zostać ucięty (overflow-hidden).
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) fit();
    });
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        active = false;
      };
    }
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [fitKey, maxRatio, minPx]);
  return (
    <div ref={ref} data-testid={testId} className={`absolute overflow-hidden ${className}`} style={style}>
      {children}
    </div>
  );
}

export default function BriefingSceneStep({
  step: sourceStep,
  contentBase,
  reducedMotion,
  headingId,
  typed,
  caseOpen,
  onHotspot,
  onImageError,
  tasks,
  identity,
  caseNo,
}: {
  step: BriefingStep;
  contentBase: string;
  reducedMotion: boolean;
  headingId: string;
  /** typewriter: widoczna (wystukana) część tekstu. */
  typed?: { shown: string; done: boolean; finish: () => void };
  /** caseFile z closedImage: czy teczka jest już otwarta. */
  caseOpen: boolean;
  /** Akcja hotspotu; brak = hotspot nieaktywny (ostatni krok w podglądzie albo w trakcie zapisu) i niewidoczny. */
  onHotspot?: () => void;
  /** Obraz sceny (albo zamkniętej teczki) się nie wczytał lub ma złą ścieżkę - BriefingBlock wraca wtedy do przycisku cta. */
  onImageError?: () => void;
  tasks: NotebookTask[];
  identity: PlayerIdentity;
  caseNo?: string;
}) {
  const [containerRef, portraitContainer] = usePortraitContainer<HTMLDivElement>();
  // Do pierwszego pomiaru (null - także HTML z serwera) scena się nie renderuje: bez mignięcia i pobierania wariantu poziomego na
  // telefonie. W przeglądarce pomiar jest w useLayoutEffect, więc scena pojawia się w tej samej klatce co krok.
  const measured = portraitContainer !== null;
  const portrait = portraitContainer === true && !!sourceStep.portrait;
  // Dalej `step` = scena w bieżącej orientacji (obraz, hotspoty, sloty pionowe albo poziome).
  const step = sceneForOrientation(sourceStep, portrait);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  // Zmiana orientacji: proporcje od razu z wariantu (9:16 / 16:9), zanim nowy obraz się wczyta i je zmierzy.
  useLayoutEffect(() => {
    setAspectRatio(portrait ? 9 / 16 : 16 / 9);
  }, [portrait]);
  const topBand = portrait ? TOP_BAND_PORTRAIT : TOP_BAND;
  const callBubble = portrait ? CALL_BUBBLE_PORTRAIT : CALL_BUBBLE;
  // Przy prefers-reduced-motion animacje CSS w SVG zatrzymuje fragment #static (withStaticFragment). reducedMotion startuje od
  // false (zgodność z renderem serwera, usePrefersReducedMotion), więc pierwsza klatka może chwilę się animować - świadomy koszt.
  const imageSrc = withStaticFragment(contentAssetUrl(contentBase, step.image, 'image'), reducedMotion);
  const closedSrc = step.kind === 'caseFile' ? withStaticFragment(contentAssetUrl(contentBase, step.closedImage, 'image'), reducedMotion) : null;
  const closedPhase = closedSrc !== null && !caseOpen;
  const slots = step.slots ?? {};
  const target = activeHotspot(step, caseOpen);
  // Podpowiedź po IDLE_MS bez akcji: reset przy każdej zmianie przedmiotu (krok, faza teczki).
  const [idle, setIdle] = useState(false);
  const targetKey = target ? `${target.rect.x}|${target.rect.y}|${target.label}` : '';
  useEffect(() => {
    setIdle(false);
    if (!targetKey) return undefined;
    const timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [targetKey]);
  const invalidPath = !imageSrc || (step.kind === 'caseFile' && Boolean(step.closedImage) && !closedSrc);
  useEffect(() => {
    if (invalidPath) onImageError?.();
    // onImageError celowo poza deps - liczy się tylko zmiana ścieżki.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidPath]);
  const measure = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
  };

  return (
    <div ref={containerRef} className="relative flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
      {measured && (
      <div
        data-testid="briefing-scene"
        data-phase={closedSrc ? (closedPhase ? 'closed' : 'open') : undefined}
        data-orientation={portrait ? 'portrait' : 'landscape'}
        // Ruch (D-090): legitymacja wysuwa się z dołu (400 ms ease-out-soft) razem ze slotami imienia i numeru; reduced-motion - od razu.
        className={`briefing-scene-box relative isolate overflow-hidden rounded-card border border-border bg-surface ${step.kind === 'badge' ? 'motion-safe:animate-rise-in' : ''}`}
        style={{ '--scene-ratio': String(aspectRatio), aspectRatio: 'var(--scene-ratio)', height: 'auto', margin: 'auto' } as CSSProperties}
      >
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- zasób modułu z CONTENT_BASE_URL, SVG wyłącznie przez <img> (D-051)
          <img src={imageSrc} alt="" referrerPolicy="no-referrer" onLoad={measure} onError={onImageError} className="absolute inset-0 block h-full w-full object-contain" />
        )}
        {closedSrc && (
          // Faza zamknięta nad otwartą: crossfade przez opacity (bez animacji przy reduced-motion - motion-reduce:transition-none).
          // eslint-disable-next-line @next/next/no-img-element -- jak wyżej
          <img
            src={closedSrc}
            alt=""
            referrerPolicy="no-referrer"
            data-testid="briefing-closed-image"
            onError={onImageError}
            className={`absolute inset-0 block h-full w-full object-contain transition-opacity duration-500 motion-reduce:transition-none ${closedPhase ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          />
        )}

        {target && onHotspot && (
          // Przedmiot kroku (D-086): JEDYNY sposób przejścia dalej - focusowalny przycisk z etykietą (cta kroku albo "Otwórz teczkę"),
          // widoczny focus; po IDLE_MS bez akcji delikatnie pulsuje (globals.css .briefing-hotspot--idle, przy reduced-motion statycznie).
          <button
            type="button"
            aria-label={target.label}
            data-testid="briefing-hotspot"
            onClick={singleClick(onHotspot)}
            style={rectStyle(target.rect)}
            className={`absolute z-10 cursor-pointer rounded-card outline-none hover:bg-accent/10 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent ${idle ? 'briefing-hotspot--idle' : ''}`}
          />
        )}

        {step.kind === 'typewriter' && typed && (
          <FitText testId="briefing-scene-text" fitKey={`${step.text}|${step.sub ?? ''}|${portrait}`} maxRatio={0.34} style={rectStyle(topBand)} className="z-20 rounded-card bg-surface/90 px-[1.5%] py-[0.8%] shadow-card">
            {/* Dwie warstwy w jednej komórce siatki: niewidoczny pełny tekst ustala rozmiar (dopasowanie liczone raz, nie co znak),
                widoczna jest wystukana część. Klik kończy pisanie od razu. */}
            <div aria-hidden="true" onClick={typed.finish} className="grid text-center font-bold leading-snug text-ink">
              <p className="invisible [grid-area:1/1]">
                {step.text}
                {step.sub && <span className="block text-[0.7em] font-normal">{step.sub}</span>}
              </p>
              <p className="[grid-area:1/1]">
                {typed.shown}
                {!typed.done && <span className="briefing-caret ml-0.5 inline-block w-[0.5ch] border-b-2 border-ink" />}
                {typed.done && step.sub && <span className="briefing-step-enter block text-[0.7em] font-normal text-muted">{step.sub}</span>}
              </p>
            </div>
          </FitText>
        )}

        {step.kind === 'start' && (
          <FitText testId="briefing-scene-text" fitKey={`${step.text}|${portrait}`} maxRatio={0.4} style={rectStyle(topBand)} className="z-20 flex items-center justify-center rounded-card bg-surface/90 px-[1.5%] shadow-card">
            <p id={headingId} className="text-center font-extrabold leading-tight text-ink">
              {step.text}
            </p>
          </FitText>
        )}

        {step.kind === 'call' && (
          <FitText testId="briefing-bubble" fitKey={`${step.text}|${portrait}`} maxRatio={portrait ? 0.12 : 0.075} style={rectStyle(callBubble)} className="briefing-step-enter pointer-events-none z-20 rounded-card border border-border bg-surface px-[3%] py-[2.5%] shadow-card">
            <p id={headingId} className="font-bold leading-tight text-ink">
              {step.caller.name}
            </p>
            {/* W pionie rola tym samym rozmiarem co reszta dymka (D-103: min. 15 px na telefonie) - wyróżnia ją kolor. */}
            {step.caller.role && <p className={`${portrait ? '' : 'text-[0.8em]'} leading-tight text-muted`}>{step.caller.role}</p>}
            <p id={`${headingId}-text`} className="mt-[0.6em] leading-snug text-ink">
              {step.text}
            </p>
          </FitText>
        )}

        {step.kind === 'caseFile' && slots.tasks && !closedPhase && tasks.length > 0 && (
          <FitText testId="briefing-slot-tasks" fitKey={`${tasks.map((task) => task.text).join('|')}|${portrait}`} maxRatio={portrait ? TASKS_MAX_RATIO.portrait : TASKS_MAX_RATIO.landscape} style={rectStyle(slots.tasks)} className="briefing-step-enter pointer-events-none z-20 font-sans">
            <ul className="space-y-[0.6em] text-ink" aria-labelledby={`${headingId}-tasks`}>
              {tasks.map((task, index) => (
                <li key={index} className="flex items-start gap-[0.5em] leading-snug">
                  {task.done ? (
                    <CheckSquare aria-hidden="true" className="mt-[0.15em] h-[1em] w-[1em] shrink-0 text-success" />
                  ) : (
                    <Square aria-hidden="true" className="mt-[0.15em] h-[1em] w-[1em] shrink-0 text-muted" />
                  )}
                  <span>
                    <span className="sr-only">{task.done ? 'Wykonane: ' : 'Do zrobienia: '}</span>
                    {task.text}
                  </span>
                </li>
              ))}
            </ul>
          </FitText>
        )}

        {step.kind === 'badge' && (
          <>
            {slots.photo && (
              <FitText testId="briefing-slot-photo" fitKey={identity.initials} maxRatio={0.42} style={rectStyle(slots.photo)} className="pointer-events-none z-20 flex items-center justify-center rounded-[6%] bg-accent-soft">
                <span aria-hidden="true" className="font-extrabold text-accent-ink">
                  {identity.initials}
                </span>
              </FitText>
            )}
            {slots.name && (
              // aria-hidden: imię i numer czytnik dostaje raz, ze zdania sr-only pod sceną (inaczej przeczytałby je dwa razy).
              <FitText testId="briefing-slot-name" fitKey={`${identity.label}|${portrait}`} maxRatio={portrait ? BADGE_TEXT_MAX_RATIO.portrait : BADGE_TEXT_MAX_RATIO.landscape} minPx={portrait ? READABLE_MIN_PX : undefined} style={rectStyle(slots.name)} className="pointer-events-none z-20 flex items-end">
                <span aria-hidden="true" className="whitespace-nowrap font-bold leading-none text-ink">
                  {identity.label}
                </span>
              </FitText>
            )}
            {slots.number && (
              <FitText testId="briefing-slot-number" fitKey={`${caseNo ?? ''}|${identity.initials}|${portrait}`} maxRatio={portrait ? BADGE_TEXT_MAX_RATIO.portrait : BADGE_TEXT_MAX_RATIO.landscape} minPx={portrait ? READABLE_MIN_PX : undefined} style={rectStyle(slots.number)} className="pointer-events-none z-20 flex items-end">
                <span aria-hidden="true" className="whitespace-nowrap font-bold leading-none tabular-nums text-ink">
                  {badgeNumber(caseNo, identity.initials)}
                </span>
              </FitText>
            )}
          </>
        )}
      </div>
      )}

      {/* Treść kroku dla czytnika ekranu tam, gdzie na scenie jest tylko grafika (karta sprawy, legitymacja) albo tekst
          animowany (pisanie). */}
      {step.kind === 'typewriter' && (
        <p id={headingId} className="sr-only">
          {step.sub ? `${step.text} ${step.sub}` : step.text}
        </p>
      )}
      {step.kind === 'caseFile' && (
        <div className="sr-only">
          <p id={headingId}>
            Sprawa nr {step.caseNo}: {step.title}
          </p>
          <dl>
            {step.fields.map((field, index) => (
              <div key={index}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          {step.stamp && <p>Pieczątka: {step.stamp}</p>}
          <p id={`${headingId}-tasks`}>{closedPhase ? 'Teczka jest zamknięta.' : 'Zadania'}</p>
        </div>
      )}
      {step.kind === 'badge' && (
        <p id={headingId} className="sr-only">
          Legitymacja śledczego: {identity.label}, nr legitymacji {badgeNumber(caseNo, identity.initials)}.
        </p>
      )}
    </div>
  );
}
