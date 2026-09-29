'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CircleDot, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import type { ContentBlock, LiveCallContent, ResultDetail } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { DEFAULT_HINT, useHints } from '../player/hints';
import { useBlockingOverlayOpen } from '../player/overlay-stack';
import Hint from '../player/Hint';

// Rozmowa na żywo (LIVE_CALL, D-122/D-123). Ekran przed połączeniem: kto dzwoni, przełącznik „Wyłącz limit czasu” (WCAG 2.2.1 - domyślnie
// z ustawienia konta, dotyczy tego podejścia) i „Odbierz”. Połączenie: kwestia dzwoniącego (napis + nagranie; „Wycisz” w nagłówku - WCAG
// 1.4.2), odpowiedzi jako duże przyciski (klawisze 1-4, nie przy otwartej nakładce ani przy przytrzymanym klawiszu). Limit czasu rusza PO
// kwestii dzwoniącego i tylko w węźle z krawędzią ciszy; po upływie - cisza (`silence`). Przy reduced-motion pasek odliczania bez animacji
// (zmiana co sekundę), limit działa tak samo. Po zakończeniu „Dalej” w pasku zapisuje `{ path, timed }`; ocenę (good/partial/bad) i
// odpowiedzi, które oddały informację, zwraca serwer - wynik na tym samym ekranie.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SILENCE = 'silence';
// Domyślny limit - ten sam co w treści (packages/content LIVE_CALL_DEFAULT_TIME_LIMIT_SEC; web nie importuje wartości z pakietu Node).
export const DEFAULT_CHOICE_TIME_LIMIT_SEC = 12;
// Nagranie, które ani się nie skończyło, ani nie zgłosiło błędu (zawieszone ładowanie): limit rusza po długości kwestii + zapas.
const STALL_FALLBACK_MS = 3000;
const STALL_FALLBACK_NO_DURATION_MS = 20000;

export interface LiveCallAnswer {
  path: string[];
  timed: boolean;
}

type Line = { who: 'caller' | 'me' | 'silence'; text: string; choiceId?: string };

/** Przejście drzewa po ścieżce (jak serwer, bez oceny): transkrypcja rozmowy i zakończenie - do widoku wyniku („Wstecz”). */
export function walkLiveCall(call: LiveCallContent, path: readonly string[]): { lines: Line[]; ending?: string } {
  const lines: Line[] = [];
  let nodeId: string | undefined = call.start;
  for (const step of path) {
    const node = call.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) break;
    lines.push({ who: 'caller', text: node.narration.text });
    const choice = node.choices.find((candidate) => candidate.id === step);
    const next = step === SILENCE ? node.silence : choice?.next;
    lines.push(step === SILENCE ? { who: 'silence', text: 'Cisza…' } : { who: 'me', text: choice?.text ?? '', choiceId: step });
    if (!next) break;
    if (next.startsWith('#')) return { lines, ending: next.slice(1) };
    nodeId = next;
  }
  return { lines };
}

/** Klawisz ze skrótu odpowiedzi trafił do pola edycji (np. notatka) - nie przechwytujemy. */
function inEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

const OUTCOME: Record<NonNullable<ResultDetail['outcome']>, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  good: { label: 'Dobra reakcja', tone: 'text-success', Icon: CircleCheck },
  partial: { label: 'Częściowo dobrze', tone: 'text-amber-600', Icon: CircleDot },
  bad: { label: 'Oszust dopiął swego', tone: 'text-danger', Icon: CircleAlert },
};

export default function LiveCallBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  disabled = false,
  noTimeLimitDefault = false,
  result,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit?: (answer: LiveCallAnswer) => void;
  onReady?: (submit: (() => void) | null) => void;
  disabled?: boolean;
  /** Ustawienie konta „Bez limitów czasu” - domyślny stan przełącznika na ekranie przed połączeniem. */
  noTimeLimitDefault?: boolean;
  /** Wynik (po zapisie albo podgląd „Wstecz”): ścieżka gracza i rozstrzygnięcie z serwera. */
  result?: { detail?: ResultDetail; answer?: LiveCallAnswer; points?: number };
}) {
  const call = block as unknown as LiveCallContent;
  const hints = useHints();
  const reducedMotion = usePrefersReducedMotion();
  const overlayOpen = useBlockingOverlayOpen();
  const limitSec = call.choiceTimeLimitSec ?? DEFAULT_CHOICE_TIME_LIMIT_SEC;
  const hasSilence = call.nodes.some((node) => node.silence !== undefined);
  const [stage, setStage] = useState<'ring' | 'call' | 'ended'>(result ? 'ended' : 'ring');
  const [noLimit, setNoLimit] = useState(noTimeLimitDefault);
  const [muted, setMuted] = useState(false);
  const [nodeId, setNodeId] = useState(call.start);
  const [path, setPath] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [lineDone, setLineDone] = useState(false);
  const [remainingMs, setRemainingMs] = useState(limitSec * 1000);
  const answerRef = useRef<HTMLButtonElement | null>(null);
  const endingRef = useRef<HTMLParagraphElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const timed = hasSilence && !noLimit;
  const node = call.nodes.find((candidate) => candidate.id === nodeId);
  // Limit biegnie także przy otwartym notatniku (presja rozmowy; WCAG 2.2.1 zapewnia przełącznik przed połączeniem).
  const countdown = stage === 'call' && timed && lineDone && node?.silence !== undefined;

  const choose = useCallback(
    (step: string) => {
      if (!node || stage !== 'call' || disabled) return;
      const choice = node.choices.find((candidate) => candidate.id === step);
      const next = step === SILENCE ? node.silence : choice?.next;
      if (!next) return;
      setPath((list) => [...list, step]);
      setLines((list) => [
        ...list,
        { who: 'caller', text: node.narration.text },
        step === SILENCE ? { who: 'silence', text: 'Cisza…' } : { who: 'me', text: choice?.text ?? '', choiceId: step },
      ]);
      setLineDone(false);
      setRemainingMs(limitSec * 1000);
      if (next.startsWith('#')) {
        setEndingId(next.slice(1));
        setStage('ended');
      } else {
        setNodeId(next);
      }
    },
    [node, stage, disabled, limitSec],
  );

  // „Dalej” w pasku zapisuje dopiero po zakończeniu rozmowy.
  useEffect(() => {
    if (result) return;
    onReady?.(stage === 'ended' && endingId ? () => onSubmit?.({ path, timed }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, endingId, path, timed, result]);

  // Odliczanie od końca kwestii dzwoniącego; po upływie - cisza.
  useEffect(() => {
    if (!countdown) return undefined;
    const startedAt = Date.now();
    const total = limitSec * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, total - (Date.now() - startedAt));
      setRemainingMs(left);
      if (left === 0) {
        window.clearInterval(timer);
        choose(SILENCE);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [countdown, limitSec, choose]);

  // Klawisze 1-4 wybierają odpowiedź w trakcie połączenia - jak skróty powłoki (PlayerStage): nie przy otwartej nakładce (notatnik),
  // nie z pola edycji, nie przy przytrzymanym klawiszu (auto-repeat przeskakiwałby kolejne węzły).
  useEffect(() => {
    if (stage !== 'call' || !node || overlayOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (inEditable(event.target)) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < node.choices.length) {
        event.preventDefault();
        choose(node.choices[index].id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stage, node, choose, overlayOpen]);

  // Nowa kwestia: fokus na pierwszej odpowiedzi (kwestię czyta region live i opis odpowiedzi); po zakończeniu - fokus na zakończeniu, żeby
  // klawiatura i czytnik nie zgubiły miejsca. Rozmowa przewinięta do najnowszej kwestii (scrollTop, nie scrollIntoView - to przewijałoby
  // też ramkę odtwarzacza).
  useEffect(() => {
    if (stage === 'call') answerRef.current?.focus({ preventScroll: true });
    if (stage === 'ended' && !result) endingRef.current?.focus({ preventScroll: true });
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    // result - tylko stan początkowy (widok wyniku nie przenosi fokusu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, nodeId]);

  const answer = result?.answer ?? (stage === 'ended' ? { path, timed } : undefined);
  const review = result && answer ? walkLiveCall(call, answer.path) : null;
  const shownLines = review ? review.lines : lines;
  const shownEnding = call.endings.find((ending) => ending.id === (review?.ending ?? result?.detail?.ending ?? endingId));
  const gaveInfo = new Set(result?.detail?.gaveInfo ?? []);
  const outcome = result?.detail?.outcome ? OUTCOME[result.detail.outcome] : null;

  if (stage === 'ring' && !result) {
    return (
      <div data-testid="live-call" data-stage="ring" className="flex min-h-0 w-full flex-1 flex-col">
        <Hint variant="bar" text={hints.hint ?? block.tip ?? DEFAULT_HINT.LIVE_CALL} />
        {/* Niski ekran (telefon w poziomie, max-height 500 px): karta w poziomie - dzwoniący po lewej, przełącznik i „Odbierz” po prawej.
            Klasy wariantu wypisane dosłownie - Tailwind nie widzi klas sklejanych w czasie działania. */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div
            className="flex w-full max-w-sm flex-col items-center gap-4 rounded-card bg-ink p-6 text-center text-white shadow-card [@media(max-height:500px)]:max-w-2xl [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:p-4"
          >
            <div className="flex flex-col items-center gap-3 [@media(max-height:500px)]:flex-1">
              <span
                aria-hidden="true"
                className={`flex h-16 w-16 items-center justify-center rounded-full bg-success [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12 ${reducedMotion ? '' : 'motion-safe:animate-pulse'}`}
              >
                <Phone className="h-8 w-8 [@media(max-height:500px)]:h-6 [@media(max-height:500px)]:w-6" />
              </span>
              <div>
                <p className="text-sm uppercase tracking-wide text-white/70">Połączenie przychodzące</p>
                <p data-testid="live-call-caller" className="text-2xl font-bold">
                  {call.caller.display}
                </p>
                {call.caller.number && <p className="text-white/80">{call.caller.number}</p>}
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 [@media(max-height:500px)]:flex-1">
              {hasSilence && (
                <label className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-3 rounded-btn bg-white/10 px-3 text-left text-base">
                  <span>
                    Wyłącz limit czasu
                    <span className="block text-sm text-white/70">Bez odliczania {limitSec} s na odpowiedź.</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    data-testid="live-call-no-limit"
                    checked={noLimit}
                    onChange={(event) => setNoLimit(event.target.checked)}
                    className={`h-5 w-5 shrink-0 accent-accent ${FOCUS_RING}`}
                  />
                </label>
              )}
              <button
                type="button"
                data-testid="live-call-answer"
                disabled={disabled}
                onClick={() => setStage('call')}
                className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-btn bg-success px-4 text-base font-semibold text-white hover:bg-success/90 ${FOCUS_RING}`}
              >
                <Phone aria-hidden="true" className="h-5 w-5" />
                Odbierz
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const nodeAudio = stage === 'call' && node ? contentAssetUrl(contentBase, node.narration.audioUrl, 'audio') : null;
  const endingAudio = stage === 'ended' && !result && shownEnding ? contentAssetUrl(contentBase, shownEnding.narration.audioUrl, 'audio') : null;
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const barPercent = reducedMotion ? (secondsLeft / limitSec) * 100 : (remainingMs / (limitSec * 1000)) * 100;
  const lineId = `live-call-line-${block.id ?? 'blok'}`;

  return (
    <div data-testid="live-call" data-stage={result ? 'result' : stage} className="flex min-h-0 w-full flex-1 flex-col">
      {result && outcome && (
        <p data-testid="live-call-outcome" className={`mb-2 flex shrink-0 items-center gap-2 font-semibold ${outcome.tone}`}>
          <outcome.Icon aria-hidden="true" className="h-5 w-5" />
          {outcome.label}
          {result.points !== undefined ? <span className="font-normal text-slate-600">· wynik {Math.round(result.points * 100)}%</span> : null}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col rounded-card bg-ink text-white shadow-card">
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
          <Phone aria-hidden="true" className="h-5 w-5 text-success" />
          <p className="min-w-0 flex-1 truncate font-semibold">{call.caller.display}</p>
          {(stage === 'call' || (stage === 'ended' && !result)) && (
            <button
              type="button"
              data-testid="live-call-mute"
              aria-pressed={muted}
              onClick={() => setMuted((value) => !value)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-2 text-sm text-white/80 hover:bg-white/10 ${FOCUS_RING}`}
            >
              {muted ? <VolumeX aria-hidden="true" className="h-4 w-4" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
              Wycisz
            </button>
          )}
          {stage === 'ended' && (
            <span className="inline-flex items-center gap-1 text-sm text-white/70">
              <PhoneOff aria-hidden="true" className="h-4 w-4" />
              Rozmowa zakończona
            </span>
          )}
        </div>

        {/* Niski ekran: rozmowa po lewej, odpowiedzi po prawej - inaczej odpowiedzi zasłaniałyby kwestię dzwoniącego. */}
        <div className="flex min-h-0 flex-1 flex-col [@media(max-height:500px)]:flex-row">
          <div ref={transcriptRef} data-testid="live-call-transcript" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {shownLines.map((line, index) => (
              <p
                key={index}
                className={
                  line.who === 'caller'
                    ? 'w-fit max-w-[85%] rounded-card bg-white/10 px-3 py-2'
                    : line.who === 'silence'
                      ? 'ml-auto w-fit max-w-[85%] px-3 py-1 text-right italic text-white/60'
                      : `ml-auto w-fit max-w-[85%] rounded-card px-3 py-2 text-right ${
                          line.choiceId && gaveInfo.has(line.choiceId) ? 'bg-danger/80' : 'bg-accent/80'
                        }`
                }
              >
                {line.text}
                {line.choiceId && gaveInfo.has(line.choiceId) && (
                  <span data-testid="live-call-gave-info" className="mt-1 block text-sm font-semibold">
                    Tu oddałeś informację.
                  </span>
                )}
              </p>
            ))}
            <div aria-live="polite">
              {stage === 'call' && node && (
                <p id={lineId} data-testid="live-call-line" className="w-fit max-w-[85%] rounded-card bg-white/15 px-3 py-2 text-lg">
                  {node.narration.text}
                </p>
              )}
            </div>
            {stage === 'ended' && shownEnding && (
              <p
                ref={endingRef}
                tabIndex={-1}
                data-testid="live-call-ending"
                className={`rounded-card border border-white/20 px-3 py-2 ${FOCUS_RING}`}
              >
                {shownEnding.narration.text}
              </p>
            )}
          </div>

          {stage === 'call' && node && (
            <div className="shrink-0 overflow-y-auto border-t border-white/10 px-4 py-3 [@media(max-height:500px)]:w-1/2 [@media(max-height:500px)]:shrink [@media(max-height:500px)]:border-l [@media(max-height:500px)]:border-t-0">
              {countdown && (
                <div className="mb-2 flex items-center gap-2" data-testid="live-call-timer">
                  <div
                    role="progressbar"
                    aria-label="Czas na odpowiedź"
                    aria-valuemin={0}
                    aria-valuemax={limitSec}
                    aria-valuenow={secondsLeft}
                    className="h-2 flex-1 overflow-hidden rounded-full bg-white/20"
                  >
                    <div className="h-full bg-amber-400" style={{ width: `${barPercent}%` }} />
                  </div>
                  <span className="w-10 text-right text-sm tabular-nums" aria-hidden="true">
                    {secondsLeft} s
                  </span>
                </div>
              )}
              <div className="grid gap-2 [@media(min-width:640px)_and_(min-height:501px)]:grid-cols-2">
                {node.choices.map((choice, index) => (
                  <button
                    key={choice.id}
                    ref={index === 0 ? answerRef : undefined}
                    type="button"
                    data-testid="live-call-choice"
                    disabled={disabled}
                    aria-describedby={index === 0 ? lineId : undefined}
                    onClick={() => choose(choice.id)}
                    className={`flex min-h-[48px] items-center gap-2 rounded-btn bg-white px-3 py-2 text-left text-base font-semibold text-ink hover:bg-white/90 ${FOCUS_RING}`}
                  >
                    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-sm text-white">
                      {index + 1}
                    </span>
                    {choice.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {stage === 'call' && node && (
        <LineAudio key={nodeId} src={nodeAudio} muted={muted} durationMs={node.narration.durationMs} onDone={() => setLineDone(true)} />
      )}
      {endingAudio && <LineAudio key={`ending-${endingId}`} src={endingAudio} muted={muted} durationMs={shownEnding?.narration.durationMs} />}
    </div>
  );
}

/**
 * Nagranie kwestii: koniec (albo błąd, albo przeglądarka zablokowała odtwarzanie, albo nagranie utknęło dłużej niż kwestia + zapas) =
 * kwestia wysłuchana - od tej chwili biegnie limit czasu. Bez nagrania (przed potokiem TTS) - od razu po pokazaniu napisu. `onDone` najwyżej
 * raz; po odmontowaniu (następna kwestia) - wcale, żeby spóźnione zdarzenie nie uruchomiło limitu NOWEJ kwestii.
 */
function LineAudio({ src, muted, durationMs, onDone }: { src: string | null; muted: boolean; durationMs?: number; onDone?: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current?.();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  // Zapas na zawieszone nagranie liczony od montażu i od nowa od startu odtwarzania (`playing`) - wolne ładowanie nie może uruchomić
  // limitu, gdy dzwoniący jeszcze mówi.
  const restartFallback = useRef<() => void>(() => {});

  useEffect(() => {
    const audio = audioRef.current;
    if (!src || !audio) {
      finishRef.current();
      return undefined;
    }
    let cancelled = false;
    let fallback = 0;
    const guarded = () => !cancelled && finishRef.current();
    restartFallback.current = () => {
      window.clearTimeout(fallback);
      fallback = window.setTimeout(guarded, (durationMs ?? STALL_FALLBACK_NO_DURATION_MS) + STALL_FALLBACK_MS);
    };
    restartFallback.current();
    const played = audio.play();
    if (played && typeof played.catch === 'function') played.catch(guarded);
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      restartFallback.current = () => {};
      audio.pause();
    };
  }, [src, durationMs]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  if (!src) return null;
  return <audio ref={audioRef} data-testid="live-call-audio" src={src} preload="auto" hidden onPlaying={() => restartFallback.current()} onEnded={() => finish()} onError={() => finish()} />;
}
