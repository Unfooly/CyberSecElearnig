'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { usePortraitContainer } from '@/lib/use-portrait-container';

// Omówienie z adnotacjami (ANNOTATED_REPLAY, D-115): numerowane znaczniki 1..N na transkrypcji nagrania (segmenty bloku CALL_RECORDING
// tego modułu) albo na grafice (punkty { x, y } w %). Przejście znacznikami w bloku („Poprzedni”/„Następny”, strzałki ← →), karta
// znacznika od dołu jak karta przedmiotu sceny. „Dalej” w pasku (D-106) aktywny po znaczniku N - blok zgłasza gotowość, zapis `{ seen: N }`.
// Narrację bieżącego znacznika gra pasek powłoki (onStepChange - jak kroki odprawy). Nieoceniane, wszystko publiczne.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export default function AnnotatedReplayBlock({
  block,
  moduleBlocks,
  contentBase,
  onSubmit,
  onReady,
  review = false,
  onStepChange,
}: {
  block: ContentBlock;
  /** Bloki modułu - źródło transkrypcji (source.fromBlock). */
  moduleBlocks: ContentBlock[];
  contentBase: string;
  onSubmit: (answer?: unknown) => void;
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
  /** Zmiana znacznika (narracja w pasku powłoki): indeks i czy zmienił ją gest gracza. */
  onStepChange?: (index: number, byGesture: boolean) => void;
}) {
  const markers = useMemo(() => block.markers ?? [], [block.markers]);
  const source = block.source;
  const segments = useMemo(
    () => (source?.kind === 'transcript' ? (moduleBlocks.find((candidate) => candidate.id === source.fromBlock)?.segments ?? []) : []),
    [source, moduleBlocks],
  );
  const [index, setIndex] = useState(0);
  // Odwiedzone znaczniki (zbiór, nie „najdalszy” - klik w ostatni numer nie może zaliczyć pominiętych; D-115: przejście WSZYSTKICH).
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set(review ? markers.map((_, i) => i) : [0]));
  const reducedMotion = usePrefersReducedMotion();
  const lineRefs = useRef(new Map<string, HTMLLIElement>());
  const cardRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const current = markers[index];
  const last = markers.length - 1;

  // Gotowość do „Dalej” po ostatnim znaczniku (podgląd „Wstecz” - bez zapisu). onReady/onSubmit z powłoki są nowe przy każdym renderze
  // rodzica (a onReady go wywołuje) - w refach, efekt tylko przy zmianie gotowości (inaczej pętla renderów).
  const callbacks = useRef({ onReady, onSubmit });
  callbacks.current = { onReady, onSubmit };
  const count = markers.length;
  // Blok bez znaczników (np. wstrzymany przez API, D-115) nigdy nie jest gotowy - serwer i tak odrzuciłby { seen: 0 }.
  const ready = count > 0 && markers.every((_, i) => seen.has(i));
  useEffect(() => {
    if (review) return;
    callbacks.current.onReady(ready ? () => callbacks.current.onSubmit({ seen: count }) : null);
  }, [ready, count, review]);

  useEffect(() => {
    onStepChange?.(index, !firstRender.current);
    // Przewinięcie do kwestii bieżącego znacznika (bez animacji przy reduced-motion).
    const segmentId = current?.anchor.segmentId;
    if (segmentId && !firstRender.current) {
      lineRefs.current.get(segmentId)?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    firstRender.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tylko przy zmianie znacznika
  }, [index]);

  function go(to: number) {
    const next = Math.max(0, Math.min(last, to));
    setIndex(next);
    setSeen((current) => (current.has(next) ? current : new Set([...current, next])));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight' && index < last) {
      event.preventDefault();
      go(index + 1);
    }
  }

  const markerForSegment = (segmentId: string) => markers.findIndex((marker) => marker.anchor.segmentId === segmentId);

  // Treść wstrzymana przez API (D-115) i nieujawniona - np. odpowiedź /progress z pełnym blokiem nie dotarła. Po odświeżeniu /start
  // odda pełny blok (gracz już tu dotarł).
  if (block.withheld || markers.length === 0) {
    return (
      <p data-testid="replay-withheld" role="status" className="mx-auto w-full max-w-[760px] rounded-card border border-border bg-surface px-4 py-3 text-ink shadow-card">
        Omówienie jeszcze się nie wczytało. Odśwież stronę, aby je zobaczyć.
      </p>
    );
  }

  return (
    <div data-testid="annotated-replay" onKeyDown={onKeyDown} className="flex min-h-0 w-full flex-1 flex-col">
      {source?.kind === 'image' ? (
        <ReplayImage block={block} contentBase={contentBase} index={index} onPick={go} />
      ) : (
        <ol className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col gap-2 overflow-y-auto pb-1" data-testid="replay-transcript">
          {segments.map((segment) => {
            const markerIndex = markerForSegment(segment.id);
            const active = markerIndex === index;
            return (
              <li
                key={segment.id}
                ref={(element) => {
                  if (element) lineRefs.current.set(segment.id, element);
                  else lineRefs.current.delete(segment.id);
                }}
                className="flex items-start gap-2"
              >
                {markerIndex >= 0 ? (
                  <button
                    type="button"
                    onClick={() => go(markerIndex)}
                    aria-label={`Znacznik ${markers[markerIndex].n}: ${markers[markerIndex].title}`}
                    aria-current={active ? 'step' : undefined}
                    data-testid={`replay-marker-${markers[markerIndex].n}`}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${FOCUS_RING} ${
                      active ? 'border-accent bg-accent text-white' : seen.has(markerIndex) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-border bg-surface text-ink'
                    }`}
                  >
                    {markers[markerIndex].n}
                  </button>
                ) : (
                  <span aria-hidden="true" className="h-11 w-11 shrink-0" />
                )}
                <p
                  className={`min-w-0 flex-1 break-words rounded-card border px-3 py-2 text-ink shadow-card ${
                    active ? 'border-accent bg-accent-soft ring-2 ring-accent' : 'border-border bg-surface'
                  }`}
                >
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{segment.speaker}</span>
                  {segment.narration.text}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {current && (
        <div
          ref={cardRef}
          data-testid="replay-card"
          aria-live="polite"
          className="mx-auto mt-3 w-full max-w-[760px] shrink-0 rounded-card border border-border bg-surface p-4 shadow-card"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Znacznik {current.n} z {markers.length}
          </p>
          <h3 className="mt-1 text-lg font-bold text-ink">{current.title}</h3>
          <p className="mt-1 whitespace-pre-line text-ink">{current.text}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-btn border border-border bg-surface px-3 font-semibold text-ink hover:bg-paper disabled:opacity-40 ${FOCUS_RING}`}
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
              Poprzedni
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index >= last}
              data-testid="replay-next"
              className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-btn bg-accent px-3 font-semibold text-white hover:bg-accent-hover disabled:opacity-40 ${FOCUS_RING}`}
            >
              Następny
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Źródło-grafika: obraz "contain" (wariant pionowy na telefonie w pionie) z numerowanymi punktami znaczników. */
function ReplayImage({ block, contentBase, index, onPick }: { block: ContentBlock; contentBase: string; index: number; onPick: (index: number) => void }) {
  const source = block.source?.kind === 'image' ? block.source : undefined;
  const [frameRef, portrait] = usePortraitContainer<HTMLDivElement>();
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const path = portrait && source?.imagePortrait ? source.imagePortrait : source?.image;
  // Grafika dopiero po pomiarze orientacji (usePortraitContainer: null) - bez mignięcia wariantu poziomego na telefonie w pionie.
  const url = portrait === null ? null : contentAssetUrl(contentBase, path, 'image');
  const markers = block.markers ?? [];
  return (
    <div ref={frameRef} className="hotspot-nested-scene-frame relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
      {source && url && (
      <div className="hotspot-nested-scene-box relative overflow-hidden rounded border border-slate-200" style={{ '--scene-ratio': String(aspectRatio), aspectRatio: 'var(--scene-ratio)' } as CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL */}
        <img
          src={url}
          alt={source?.alt ?? ''}
          referrerPolicy="no-referrer"
          className="block h-full w-full object-contain"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
          }}
        />
        {markers.map((marker, markerIndex) => (
          <button
            key={marker.n}
            type="button"
            onClick={() => onPick(markerIndex)}
            aria-label={`Znacznik ${marker.n}: ${marker.title}`}
            aria-current={markerIndex === index ? 'step' : undefined}
            data-testid={`replay-marker-${marker.n}`}
            style={{ left: `${marker.anchor.x ?? 0}%`, top: `${marker.anchor.y ?? 0}%` }}
            className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-sm font-bold shadow-card ${FOCUS_RING} ${
              markerIndex === index ? 'border-white bg-accent text-white' : 'border-accent bg-surface text-accent-ink'
            }`}
          >
            {marker.n}
          </button>
        ))}
      </div>
      )}
    </div>
  );
}
