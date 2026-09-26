'use client';

import { useEffect, useRef, useState } from 'react';
import { Phone, Square } from 'lucide-react';
import type { BriefingStep, ContentBlock, CourseObjective } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { badgeNumber, type PlayerIdentity } from '@/lib/use-my-display-name';
import Mascot from '@/components/Mascot';
import AvatarDisplay from '@/app/courses/_components/AvatarDisplay';
import { useCompleteReaction } from '../player/mascot-reaction';

// Odprawa (BRIEFING, schemaVersion 5, D-081): ciąg kroków na jasnym tle (paper) - maszyna do pisania z dzwoniącym
// telefonem, rozmowa (Fooli jako Komisarz albo postać), karta sprawy z listą zadań, legitymacja gracza. Blok nieoceniany,
// bez dowodów: przycisk ostatniego kroku zapisuje blok (ten sam zapis co "Dalej" bloku eksploracyjnego). "Pomiń odprawę"
// jest w górnym pasku ramki (PlayerStage.tsx, CoursePlayer) - to ten sam zapis, więc serwer nie odróżnia pominięcia od
// przejścia, a zadania i tak nie mogą wskazywać tego bloku (walidacja treści).
//
// Dane gracza (imię, inicjały, avatar, numer odznaki) liczy WYŁĄCZNIE przeglądarka z sesji (`identity`, `myAvatarUrl`) -
// nie ma ich w treści modułu i nie idą do progress.
//
// Animacje (pisanie, telefon, spadająca karta, pieczątka) tylko bez prefers-reduced-motion; z nim każdy krok od razu
// stoi w stanie końcowym (globals.css + usePrefersReducedMotion niżej dla samego pisania, które jest w JS).

const TYPE_INTERVAL_MS = 32;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  useEffect(() => {
    const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

/** Tekst "wystukiwany" znak po znaku; z reduced-motion od razu w całości. Zwraca widoczną część i czy już skończył. */
function useTypewriter(text: string, reducedMotion: boolean): { shown: string; done: boolean; finish: () => void } {
  const [count, setCount] = useState(reducedMotion ? text.length : 0);
  useEffect(() => {
    if (reducedMotion) {
      setCount(text.length);
      return undefined;
    }
    setCount(0);
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, TYPE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [text, reducedMotion]);
  return { shown: text.slice(0, count), done: count >= text.length, finish: () => setCount(text.length) };
}

function Cta({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-[44px] items-center justify-center rounded-btn bg-accent px-5 py-2 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function TypewriterStep({ step, reducedMotion, headingId }: { step: Extract<BriefingStep, { kind: 'typewriter' }>; reducedMotion: boolean; headingId: string }) {
  const { shown, done, finish } = useTypewriter(step.text, reducedMotion);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Klik w tekst kończy pisanie od razu (dla niecierpliwych); czytnik ekranu dostaje pełny tekst od razu (sr-only). */}
      <p id={headingId} className="sr-only">
        {step.text}
      </p>
      <p aria-hidden="true" onClick={finish} className="min-h-[3em] max-w-prose whitespace-pre-line text-xl font-bold leading-snug text-ink sm:text-2xl">
        {shown}
        {!done && <span className="briefing-caret ml-0.5 inline-block w-[0.5ch] border-b-2 border-ink" />}
      </p>
      {done && step.sub && <p className="briefing-step-enter text-sm text-muted">{step.sub}</p>}
      {done && (
        <span className="briefing-step-enter flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <Phone className="briefing-phone-ring h-7 w-7" />
        </span>
      )}
    </div>
  );
}

function CallStep({ step, contentBase, headingId }: { step: Extract<BriefingStep, { kind: 'call' }>; contentBase: string; headingId: string }) {
  const avatarSrc = contentAssetUrl(contentBase, step.caller.avatar, 'image');
  const initials = step.caller.name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="flex items-center gap-3">
        {step.caller.mascot ? (
          <Mascot pose={step.caller.mascot} size={72} className="h-16 w-16 sm:h-[72px] sm:w-[72px]" />
        ) : avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- zasób modułu z CONTENT_BASE_URL, SVG wyłącznie przez <img> (D-051)
          <img src={avatarSrc} alt="" className="h-16 w-16 rounded-full border border-border bg-surface object-cover" />
        ) : (
          <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent-ink">
            {initials}
          </span>
        )}
        <div>
          <p id={headingId} className="text-base font-bold text-ink">
            {step.caller.name}
          </p>
          {step.caller.role && <p className="text-sm text-muted">{step.caller.role}</p>}
        </div>
      </div>
      <p className="briefing-step-enter max-w-prose rounded-card border border-border bg-surface px-4 py-3 text-base text-ink shadow-card">{step.text}</p>
    </div>
  );
}

function CaseFileStep({
  step,
  objectives,
  headingId,
}: {
  step: Extract<BriefingStep, { kind: 'caseFile' }>;
  objectives: CourseObjective[];
  headingId: string;
}) {
  return (
    <div className="briefing-card-drop relative w-full max-w-md rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">
        Sprawa nr <span className="font-typewriter text-sm normal-case tracking-normal text-ink">{step.caseNo}</span>
      </p>
      <h3 id={headingId} className="mt-1 text-lg font-bold text-ink">
        {step.title}
      </h3>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {step.fields.map((field, index) => (
          <div key={index} className="contents">
            <dt className="text-muted">{field.label}</dt>
            <dd className="font-semibold text-ink">{field.value}</dd>
          </div>
        ))}
      </dl>
      {step.stamp && (
        <span
          aria-label={`Pieczątka: ${step.stamp}`}
          className="briefing-stamp absolute right-4 top-4 -rotate-6 rounded border-2 border-danger px-2 py-0.5 text-xs font-extrabold uppercase tracking-widest text-danger"
        >
          {step.stamp}
        </span>
      )}
      {objectives.length > 0 && (
        <section aria-labelledby={`${headingId}-tasks`} className="mt-4 border-t border-border pt-3">
          <h4 id={`${headingId}-tasks`} className="text-xs font-bold uppercase tracking-wide text-muted">
            Zadania
          </h4>
          <ul className="mt-2 space-y-1.5 text-sm text-ink">
            {objectives.map((objective, index) => (
              <li key={index} className="flex items-start gap-2">
                <Square aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <span>{objective.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BadgeStep({
  identity,
  myAvatarUrl,
  caseNo,
  headingId,
}: {
  identity: PlayerIdentity;
  myAvatarUrl: string | null;
  caseNo?: string;
  headingId: string;
}) {
  return (
    <div className="briefing-card-drop w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-card">
      <p id={headingId} className="text-xs font-bold uppercase tracking-wide text-accent-ink">
        Legitymacja śledczego
      </p>
      <div className="mt-3 flex items-center gap-4">
        <AvatarDisplay avatarUrl={myAvatarUrl} size="lg" initials={identity.initials} label="Twój avatar" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{identity.label}</p>
          <p className="text-sm text-muted">Śledczy ds. bezpieczeństwa</p>
          <p className="mt-1 text-sm text-muted">
            Nr odznaki <span className="font-bold text-ink">{badgeNumber(caseNo, identity.initials)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function BriefingBlock({
  block,
  contentBase,
  onSubmit,
  review = false,
  disabled = false,
  objectives = [],
  identity,
  myAvatarUrl = null,
  onStepChange,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: () => void;
  review?: boolean;
  disabled?: boolean;
  objectives?: CourseObjective[];
  identity: PlayerIdentity;
  myAvatarUrl?: string | null;
  /** Zmiana kroku (narracja w pasku powłoki idzie za krokiem); byGesture=true, gdy kliknięciem gracza. */
  onStepChange?: (index: number, byGesture: boolean) => void;
}) {
  const steps = block.steps ?? [];
  const [index, setIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const headingRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const step = steps[index];
  const isLast = index >= steps.length - 1;
  const headingId = `briefing-${block.id ?? 'b'}-step-${index}`;
  const caseNo = steps.find((candidate): candidate is Extract<BriefingStep, { kind: 'caseFile' }> => candidate.kind === 'caseFile')?.caseNo;

  // Reakcja na ukończenie (reactions.complete) dopiero na ostatnim kroku - wcześniej odprawa nie jest "zebrana".
  useCompleteReaction(block.reactions?.complete, isLast, review);

  useEffect(() => {
    onStepChange?.(index, !firstRender.current);
    // Po zmianie kroku (nie przy pierwszym renderze) fokus na treść nowego kroku: przycisk, który go wywołał, znika.
    if (!firstRender.current) headingRef.current?.focus();
    firstRender.current = false;
    // onStepChange celowo poza deps - remount przez `key` na zmianę bloku (jak inne bloki, patrz SceneHotspotsBlock.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!step) return null;

  const advance = () => {
    if (!isLast) setIndex((current) => Math.min(current + 1, steps.length - 1));
    else if (!review) onSubmit();
  };

  return (
    <div data-testid="briefing-block" className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-card bg-paper [scrollbar-width:thin]">
      <div className="m-auto flex w-full max-w-xl flex-col items-center gap-5 p-4 sm:p-6">
        <p className="sr-only" aria-live="polite">
          Odprawa, krok {index + 1} z {steps.length}
        </p>
        <div aria-hidden="true" className="flex gap-1.5">
          {steps.map((_, dot) => (
            <span key={dot} className={`h-1.5 w-6 rounded-full ${dot <= index ? 'bg-accent' : 'bg-border'}`} />
          ))}
        </div>
        <div key={index} ref={headingRef} tabIndex={-1} aria-labelledby={headingId} role="group" className="briefing-step-enter flex w-full flex-col items-center outline-none">
          {step.kind === 'typewriter' && <TypewriterStep step={step} reducedMotion={reducedMotion} headingId={headingId} />}
          {step.kind === 'call' && <CallStep step={step} contentBase={contentBase} headingId={headingId} />}
          {step.kind === 'caseFile' && <CaseFileStep step={step} objectives={objectives} headingId={headingId} />}
          {step.kind === 'badge' && <BadgeStep identity={identity} myAvatarUrl={myAvatarUrl} caseNo={caseNo} headingId={headingId} />}
        </div>
        {!(isLast && review) && <Cta label={step.cta} onClick={advance} disabled={disabled && isLast} />}
      </div>
    </div>
  );
}
