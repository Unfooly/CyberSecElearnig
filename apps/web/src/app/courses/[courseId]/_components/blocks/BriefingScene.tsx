'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import type { BriefingRect, BriefingStep } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { badgeNumber, type PlayerIdentity } from '@/lib/use-my-display-name';
import type { NotebookTask } from '../player/notes';

// Krok odprawy jako SCENA z grafiką (feat/briefing-scenes, D-084) zamiast karty na jasnym tle. Obraz sceny (1600x900) w pudełku
// "contain" (.briefing-scene-box, globals.css: mniejsza z szerokości kontenera i wysokości x proporcja - bez panoramy i bez
// przewijania, także na telefonie w pionie), na nim w % sceny: hotspot (klik = cta kroku), sloty z HTML (zadania sprawy, dane
// gracza z sesji) i teksty kroku (pasek maszyny do pisania u góry, dymek komisarza w prawej połowie). Każdy tekst na scenie
// dopasowuje rozmiar czcionki do swojego prostokąta (FitText) - bez przepełnień na żadnej rozdzielczości (layout-check).
//
// Dostępność: hotspot to tylko skrót dla myszy/dotyku (aria-hidden, poza kolejnością Tab) - ten sam ruch zawsze ma przycisk pod
// sceną (cta kroku albo "Otwórz teczkę"). Obraz ma pusty alt: treść kroku jest w HTML (widoczna albo sr-only), a dane karty
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

/** Styl pozycjonujący prostokąt w % sceny. */
export function rectStyle(rect: BriefingRect): CSSProperties {
  return { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
}

// Pasek tekstu kroku u góry sceny (typewriter, start) i dymek rozmowy w prawej połowie (call, x >= 45%) - stałe układu, nie treść.
const TOP_BAND: BriefingRect = { x: 4, y: 3, w: 92, h: 15 };
const CALL_BUBBLE: BriefingRect = { x: 46, y: 12, w: 50, h: 64 };

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
}: {
  className?: string;
  style?: CSSProperties;
  /** Górny rozmiar czcionki jako ułamek wysokości kontenera. */
  maxRatio: number;
  fitKey: string;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const fit = () => {
      const fits = () => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
      let high = Math.max(MIN_FONT_PX, element.clientHeight * maxRatio);
      let low = MIN_FONT_PX;
      element.style.fontSize = `${high}px`;
      if (fits()) return;
      for (let step = 0; step < 10; step += 1) {
        const middle = (low + high) / 2;
        element.style.fontSize = `${middle}px`;
        if (fits()) low = middle;
        else high = middle;
      }
      element.style.fontSize = `${low}px`;
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
  }, [fitKey, maxRatio]);
  return (
    <div ref={ref} data-testid={testId} className={`absolute overflow-hidden ${className}`} style={style}>
      {children}
    </div>
  );
}

export default function BriefingSceneStep({
  step,
  contentBase,
  reducedMotion,
  headingId,
  typed,
  caseOpen,
  onHotspot,
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
  tasks: NotebookTask[];
  identity: PlayerIdentity;
  caseNo?: string;
}) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  // reducedMotion startuje od false (zgodność z renderem serwera, usePrefersReducedMotion w BriefingBlock.tsx), więc przy
  // prefers-reduced-motion pierwsza klatka ładuje wariant animowany i zaraz podmienia go na statyczny - świadomy koszt.
  const imageSrc = contentAssetUrl(contentBase, reducedMotion && step.imageReducedMotion ? step.imageReducedMotion : step.image, 'image');
  const closedSrc = step.kind === 'caseFile' ? contentAssetUrl(contentBase, step.closedImage, 'image') : null;
  const closedPhase = closedSrc !== null && !caseOpen;
  const slots = step.slots ?? {};
  const measure = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
  };

  return (
    <div className="relative flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
      <div
        data-testid="briefing-scene"
        data-phase={closedSrc ? (closedPhase ? 'closed' : 'open') : undefined}
        className="briefing-scene-box relative isolate overflow-hidden rounded-card border border-border bg-surface"
        style={{ '--scene-ratio': String(aspectRatio), aspectRatio: 'var(--scene-ratio)', height: 'auto', margin: 'auto' } as CSSProperties}
      >
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- zasób modułu z CONTENT_BASE_URL, SVG wyłącznie przez <img> (D-051)
          <img src={imageSrc} alt="" referrerPolicy="no-referrer" onLoad={measure} className="absolute inset-0 block h-full w-full object-contain" />
        )}
        {closedSrc && (
          // Faza zamknięta nad otwartą: crossfade przez opacity (bez animacji przy reduced-motion - motion-reduce:transition-none).
          // eslint-disable-next-line @next/next/no-img-element -- jak wyżej
          <img
            src={closedSrc}
            alt=""
            referrerPolicy="no-referrer"
            data-testid="briefing-closed-image"
            className={`absolute inset-0 block h-full w-full object-contain transition-opacity duration-500 motion-reduce:transition-none ${closedPhase ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          />
        )}

        {step.hotspot && onHotspot && (closedSrc ? closedPhase : true) && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="briefing-hotspot"
            onClick={singleClick(onHotspot)}
            style={rectStyle(step.hotspot)}
            className="briefing-hotspot absolute z-10 cursor-pointer rounded-card outline-none hover:bg-accent/10"
          />
        )}

        {step.kind === 'typewriter' && typed && (
          <FitText testId="briefing-scene-text" fitKey={`${step.text}|${step.sub ?? ''}`} maxRatio={0.34} style={rectStyle(TOP_BAND)} className="z-20 rounded-card bg-surface/90 px-[1.5%] py-[0.8%] shadow-card">
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
          <FitText testId="briefing-scene-text" fitKey={step.text} maxRatio={0.4} style={rectStyle(TOP_BAND)} className="z-20 flex items-center justify-center rounded-card bg-surface/90 px-[1.5%] shadow-card">
            <p id={headingId} className="text-center font-extrabold leading-tight text-ink">
              {step.text}
            </p>
          </FitText>
        )}

        {step.kind === 'call' && (
          <FitText testId="briefing-bubble" fitKey={step.text} maxRatio={0.075} style={rectStyle(CALL_BUBBLE)} className="briefing-step-enter z-20 rounded-card border border-border bg-surface px-[3%] py-[2.5%] shadow-card">
            <p id={headingId} className="font-bold leading-tight text-ink">
              {step.caller.name}
            </p>
            {step.caller.role && <p className="text-[0.8em] leading-tight text-muted">{step.caller.role}</p>}
            <p id={`${headingId}-text`} className="mt-[0.6em] leading-snug text-ink">
              {step.text}
            </p>
          </FitText>
        )}

        {step.kind === 'caseFile' && slots.tasks && !closedPhase && tasks.length > 0 && (
          <FitText testId="briefing-slot-tasks" fitKey={tasks.map((task) => task.text).join('|')} maxRatio={0.08} style={rectStyle(slots.tasks)} className="briefing-step-enter z-20 font-sans">
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
              <FitText testId="briefing-slot-photo" fitKey={identity.initials} maxRatio={0.42} style={rectStyle(slots.photo)} className="z-20 flex items-center justify-center rounded-[6%] bg-accent-soft">
                <span aria-hidden="true" className="font-extrabold text-accent-ink">
                  {identity.initials}
                </span>
              </FitText>
            )}
            {slots.name && (
              // aria-hidden: imię i numer czytnik dostaje raz, ze zdania sr-only pod sceną (inaczej przeczytałby je dwa razy).
              <FitText testId="briefing-slot-name" fitKey={identity.label} maxRatio={0.62} style={rectStyle(slots.name)} className="z-20 flex items-end">
                <span aria-hidden="true" className="whitespace-nowrap font-bold leading-none text-ink">
                  {identity.label}
                </span>
              </FitText>
            )}
            {slots.number && (
              <FitText testId="briefing-slot-number" fitKey={`${caseNo ?? ''}|${identity.initials}`} maxRatio={0.62} style={rectStyle(slots.number)} className="z-20 flex items-end">
                <span aria-hidden="true" className="whitespace-nowrap font-bold leading-none tabular-nums text-ink">
                  {badgeNumber(caseNo, identity.initials)}
                </span>
              </FitText>
            )}
          </>
        )}
      </div>

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
