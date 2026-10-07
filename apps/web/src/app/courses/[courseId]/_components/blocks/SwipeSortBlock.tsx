'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, MessageCircle, MessageSquare, Paperclip } from 'lucide-react';
import type { ClientProgressBlock, ContentBlock, SimpleCheck, SwipeCard, SwipeVerdict } from '@/lib/courses-types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback, SimpleHint } from './SimpleFeedback';

// Segregowanie wiadomości (SWIPE_SORT, D-132): po jednej karcie-wiadomości (SMS albo komunikator). Przesunięcie w lewo = „Podejrzane”,
// w prawo = „W porządku”; dwa duże przyciski pod kartą robią to samo (klawiatura, czytnik ekranu, osoby, którym gest sprawia trudność).
// Werdykt każdej karty sprawdza serwer (/check) - od razu „Dobrze”/„Nie tym razem” i zdanie z treści; po 2 błędach podpowiedź. Karty mają
// id nieprzejrzyste i kolejność z serwera; klient nie zna poprawnych werdyktów. „Dalej” w pasku po ocenie wszystkich kart. Bez wyniku w bloku.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
/** Przesunięcie (px), od którego puszczona karta liczy się jako werdykt - albo ćwierć szerokości karty, jeśli to więcej. */
export const SWIPE_THRESHOLD_PX = 80;

const VERDICT_LABEL: Record<SwipeVerdict, string> = { suspicious: 'Podejrzane', ok: 'W porządku' };

function CardBody({ card }: { card: SwipeCard }) {
  const Icon = card.channel === 'sms' ? MessageSquare : MessageCircle;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 truncate text-base font-bold text-ink">{card.from}</p>
        <span className="shrink-0 text-base text-muted">
          {card.channel === 'sms' ? 'SMS' : 'Komunikator'}
          {card.time ? ` · ${card.time}` : ''}
        </span>
      </div>
      <p className="whitespace-pre-line break-words pt-3 text-lg text-ink">{card.text}</p>
      {card.attachment && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-btn border border-border bg-paper px-3 py-2 text-base text-ink">
          <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0" />
          {card.attachment}
        </p>
      )}
    </>
  );
}

/** Podgląd ukończonego bloku („Wstecz”): każda karta z własnym werdyktem i zdaniem. */
function SwipeReview({ cards, checks }: { cards: SwipeCard[]; checks: SimpleCheck[] }) {
  return (
    <ul data-testid="swipe-review" className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
      {cards.map((card) => {
        const own = checks.find((check) => check.item === card.id);
        return (
          <li key={card.id} className="rounded-card border border-border bg-surface p-4 shadow-card">
            <CardBody card={card} />
            {own && (
              <p className="mt-3 flex items-start gap-2 text-base text-ink">
                {own.result === 'good' ? (
                  <CircleCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                ) : (
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                )}
                <span>
                  <span className="font-bold">{own.result === 'good' ? 'Dobrze. ' : 'Nie tym razem. '}</span>
                  {own.feedback}
                </span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function SwipeSortBlock({
  block,
  courseId,
  progress,
  onSubmit,
  onReady,
  onProgress,
  disabled = false,
  review = false,
}: {
  block: ContentBlock;
  courseId: string;
  progress?: ClientProgressBlock;
  onSubmit?: () => void;
  onReady?: (submit: (() => void) | null) => void;
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
  disabled?: boolean;
  /** Podgląd ukończonego bloku („Wstecz”) - karty z własnymi werdyktami, bez interakcji. */
  review?: boolean;
}) {
  const cards = block.cards ?? [];
  const reducedMotion = usePrefersReducedMotion();
  const { checks, hint, pending, error, check } = useSimpleCheck(courseId, block.id ?? '', progress);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; id: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  // Werdykt w tej sesji (nie stan z postępu po odświeżeniu) - fokus na komunikacie po ostatniej karcie tylko wtedy.
  const decided = useRef(false);

  const current = cards.find((card) => !checks.some((entry) => entry.item === card.id));
  const done = cards.length > 0 && !current;
  const last = checks[checks.length - 1];
  const lastCard = last ? cards.find((card) => card.id === last.item) : undefined;

  useEffect(() => {
    if (done && decided.current) statusRef.current?.focus({ preventScroll: true });
  }, [done]);

  useEffect(() => {
    if (review) return;
    onReady?.(done ? () => onSubmit?.() : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, review]);

  // Próby do podglądu „Wstecz” w tej samej sesji.
  useEffect(() => {
    if (!review && checks.length > 0) onProgress?.({ checks, ...(hint ? { hint } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks, hint]);

  if (review) return <SwipeReview cards={cards} checks={progress?.checks ?? []} />;

  async function decide(verdict: SwipeVerdict) {
    if (!current || disabled || pending) return;
    decided.current = true;
    await check({ card: current.id, verdict });
    setDx(0);
  }

  const threshold = () => Math.max(SWIPE_THRESHOLD_PX, (cardRef.current?.getBoundingClientRect().width ?? 0) / 4);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!current || disabled || pending || event.button !== 0) return;
    start.current = { x: event.clientX, id: event.pointerId };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== event.pointerId) return;
    setDx(event.clientX - start.current.x);
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== event.pointerId) return;
    const moved = event.clientX - start.current.x;
    start.current = null;
    setDragging(false);
    if (Math.abs(moved) >= threshold()) void decide(moved < 0 ? 'suspicious' : 'ok');
    else setDx(0);
  }
  function onPointerCancel() {
    start.current = null;
    setDragging(false);
    setDx(0);
  }

  const leaning: SwipeVerdict | null = dx <= -24 ? 'suspicious' : dx >= 24 ? 'ok' : null;
  const position = current ? cards.indexOf(current) + 1 : cards.length;

  return (
    <div data-testid="swipe-sort" className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      {block.prompt && <p className="text-xl font-semibold text-ink">{block.prompt}</p>}
      {/* Licznik z nadawcą ogłasza czytnikowi nową kartę; po ostatniej - fokus tutaj (przyciski werdyktu znikają). */}
      {/* Po ostatniej karcie bez aria-live - komunikat czyta czytnik raz, przy przeniesieniu fokusu. */}
      <p ref={statusRef} tabIndex={-1} data-testid="swipe-status" className="text-base text-muted focus:outline-none" aria-live={current ? 'polite' : undefined}>
        {!current ? 'Wszystkie wiadomości ocenione.' : `Wiadomość ${position} z ${cards.length}: ${current.from}`}
      </p>

      {current && (
        <div
          ref={cardRef}
          key={current.id}
          data-testid="swipe-card"
          data-card-id={current.id}
          data-leaning={leaning ?? undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          role="group"
          aria-label={`Wiadomość od: ${current.from}`}
          className={`relative cursor-grab touch-pan-y select-none rounded-card border-2 bg-surface p-4 shadow-card ${
            leaning === 'suspicious' ? 'border-danger' : leaning === 'ok' ? 'border-success' : 'border-border'
          } ${dragging ? 'cursor-grabbing' : reducedMotion ? '' : 'transition-transform duration-200'}`}
          style={{ transform: dx === 0 ? undefined : `translateX(${dx}px)${reducedMotion ? '' : ` rotate(${dx / 30}deg)`}` }}
        >
          {leaning && (
            <span
              aria-hidden="true"
              className={`absolute right-3 top-3 rounded-btn px-3 py-1 text-base font-bold text-white ${leaning === 'suspicious' ? 'bg-danger' : 'bg-success'}`}
            >
              {VERDICT_LABEL[leaning]}
            </span>
          )}
          <CardBody card={current} />
        </div>
      )}

      {current && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            data-testid="swipe-suspicious"
            // W trakcie sprawdzania aria-disabled (decide() i tak czeka) - `disabled` zdjąłby fokus z przycisku po każdej karcie.
            disabled={disabled}
            aria-disabled={pending || undefined}
            onClick={() => void decide('suspicious')}
            className={`inline-flex min-h-[56px] items-center justify-center gap-2 rounded-btn bg-danger px-4 text-base font-bold text-white disabled:opacity-50 ${pending ? 'cursor-wait opacity-70' : 'hover:bg-danger/90'} ${FOCUS_RING}`}
          >
            <ArrowLeft aria-hidden="true" className="h-5 w-5" />
            {VERDICT_LABEL.suspicious}
          </button>
          <button
            type="button"
            data-testid="swipe-ok"
            disabled={disabled}
            aria-disabled={pending || undefined}
            onClick={() => void decide('ok')}
            className={`inline-flex min-h-[56px] items-center justify-center gap-2 rounded-btn bg-success px-4 text-base font-bold text-white disabled:opacity-50 ${pending ? 'cursor-wait opacity-70' : 'hover:bg-success/90'} ${FOCUS_RING}`}
          >
            {VERDICT_LABEL.ok}
            <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
      )}

      <SimpleFeedback result={last?.result ?? null} text={last?.feedback} about={lastCard ? `Wiadomość od: ${lastCard.from}` : undefined} />
      <SimpleHint text={done ? undefined : hint} />
      <SimpleError text={error} />
    </div>
  );
}
