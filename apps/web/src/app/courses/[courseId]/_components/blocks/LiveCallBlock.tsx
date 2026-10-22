'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { CircleAlert, CircleCheck, CircleDot, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import type { ContentBlock, LiveCallContent, ResultDetail, SlotRect } from '@/lib/courses-types';
import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { DEFAULT_HINT, useHints } from '../player/hints';
import { useBlockingOverlayOpen } from '../player/overlay-stack';
import Hint from '../player/Hint';
import LineAudio from './LineAudio';

// Rozmowa na żywo (LIVE_CALL, D-122/D-123). Ekran przed połączeniem: kto dzwoni, przełącznik „Wyłącz limit czasu” (WCAG 2.2.1 - domyślnie
// z ustawienia konta, dotyczy tego podejścia) i „Odbierz”. Połączenie: kwestia dzwoniącego (napis + nagranie; „Wycisz” w nagłówku - WCAG
// 1.4.2), odpowiedzi jako duże przyciski (klawisze 1-4, nie przy otwartej nakładce ani przy przytrzymanym klawiszu). Limit czasu rusza PO
// kwestii dzwoniącego i tylko w węźle z krawędzią ciszy; po upływie - cisza (`silence`). Przy reduced-motion pasek odliczania bez animacji
// (zmiana co sekundę), limit działa tak samo. Po zakończeniu „Dalej” w pasku zapisuje `{ path, timed }`; ocenę (good/partial/bad) i
// odpowiedzi, które oddały informację, zwraca serwer - wynik na tym samym ekranie. D-129: „Odrzuć” na ekranie przychodzącym i „Rozłącz”
// przez całą rozmowę (gdy treść ma `reject` / `hangUp`) prowadzą od razu do wskazanego zakończenia; kolejność odpowiedzi w węźle tasuje
// serwer (toClientBlock).

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SILENCE = 'silence';
// D-129 (te same stałe co LIVE_CALL_REJECT / LIVE_CALL_HANG_UP w packages/content): odrzucenie połączenia - jedyny krok ścieżki;
// rozłączenie się - ostatni krok, w dowolnym węźle.
const REJECT = 'reject';
const HANG_UP = 'hangup';
const HANG_UP_LINE = 'Rozłączasz się.';
// Domyślny limit - ten sam co w treści (packages/content LIVE_CALL_DEFAULT_TIME_LIMIT_SEC; web nie importuje wartości z pakietu Node).
export const DEFAULT_CHOICE_TIME_LIMIT_SEC = 12;

export interface LiveCallAnswer {
  path: string[];
  timed: boolean;
}

type Line = { who: 'caller' | 'me' | 'silence'; text: string; choiceId?: string };

/** Wiersz gracza po kroku ścieżki: cisza, rozłączenie się albo wybrana odpowiedź. */
function stepLine(step: string, choice: { text: string } | undefined): Line {
  if (step === SILENCE) return { who: 'silence', text: 'Cisza…' };
  if (step === HANG_UP) return { who: 'silence', text: HANG_UP_LINE };
  return { who: 'me', text: choice?.text ?? '', choiceId: step };
}

/** Przejście drzewa po ścieżce (jak serwer, bez oceny): transkrypcja rozmowy i zakończenie - do widoku wyniku („Wstecz”). */
export function walkLiveCall(call: LiveCallContent, path: readonly string[]): { lines: Line[]; ending?: string } {
  const lines: Line[] = [];
  // Połączenie odrzucone (D-129): bez rozmowy, od razu zakończenie.
  if (path.length === 1 && path[0] === REJECT) return call.reject?.startsWith('#') ? { lines, ending: call.reject.slice(1) } : { lines };
  let nodeId: string | undefined = call.start;
  for (const step of path) {
    const node = call.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) break;
    lines.push({ who: 'caller', text: node.narration.text });
    const choice = node.choices.find((candidate) => candidate.id === step);
    const next = step === SILENCE ? node.silence : step === HANG_UP ? call.hangUp : choice?.next;
    lines.push(stepLine(step, choice));
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

// Ramka telefonu (B-138b): proporcje grafiki 700×1260 i minimalna wysokość, przy której slot przycisków mieści przełącznik limitu czasu i
// dwa przyciski po 44 px (slot 30% wysokości). Niżej - karta jak dotąd (telefon w poziomie, niskie okno).
export const RING_FRAME_RATIO = 700 / 1260;
export const RING_FRAME_MIN_HEIGHT = 520;

// `undefined` - jeszcze nie zmierzono (nic nie rysujemy - bez mignięcia karty przed ramką i bez fokusu na przycisku, który zaraz zniknie),
// `null` - ramka się nie mieści albo nieaktywna (karta), rozmiar - ramka.
// `enabled` - treść ma ramkę; `active` - ekran przychodzący na ekranie (poza nim - znów „niezmierzone”, ponowienie mierzy od nowa).
function useRingFrame(enabled: boolean, active: boolean): [RefObject<HTMLDivElement>, { width: number; height: number } | null | undefined] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null | undefined>(enabled ? undefined : null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled) {
      setSize(null);
      return undefined;
    }
    if (!active || !element) {
      setSize(undefined);
      return undefined;
    }
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const frameHeight = Math.floor(Math.min(height, width / RING_FRAME_RATIO));
      const next = frameHeight >= RING_FRAME_MIN_HEIGHT ? { width: Math.floor(frameHeight * RING_FRAME_RATIO), height: frameHeight } : null;
      // Ten sam rozmiar - bez nowego obiektu (ResizeObserver woła przy każdej zmianie, także bez zmiany ramki).
      setSize((current) => (current && next && current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, active]);
  return [ref, size];
}

const slotStyle = (rect: SlotRect): CSSProperties => ({ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` });

export default function LiveCallBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  disabled = false,
  noTimeLimitDefault = false,
  submitFailed = false,
  onRetry,
  result,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit?: (answer: LiveCallAnswer) => void;
  onReady?: (submit: (() => void) | null) => void;
  disabled?: boolean;
  /** Ustawienie konta „Bez limitów czasu” (D-124): rozmowa bez limitu, bez przełącznika (serwer stosuje ustawienie konta przy ocenie). */
  noTimeLimitDefault?: boolean;
  /**
   * Zapis zakończonej rozmowy się nie udał (B-137, np. 400 - ścieżka z ciszą przy koncie „Bez limitów czasu”, gdy odczyt preferencji w
   * page.tsx zawiódł): „Zadzwoń ponownie” wraca do ekranu przed połączeniem z czystą ścieżką - bez odświeżania strony.
   */
  submitFailed?: boolean;
  /** Wołane przy „Zadzwoń ponownie” - CoursePlayer zdejmuje komunikat o błędzie (i `submitFailed`) z poprzedniego zapisu. */
  onRetry?: () => void;
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
  // „Odbierz” - fokus po „Zadzwoń ponownie” (przycisk ponowienia znika, klawiatura nie może zgubić miejsca).
  const pickUpRef = useRef<HTMLButtonElement | null>(null);
  const redialed = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Ramka telefonu na ekranie przychodzącym (B-138b): rozmiar z pomiaru obszaru, null - za nisko (telefon w poziomie) albo przed pomiarem.
  const [ringAreaRef, ringFrame] = useRingFrame(!!call.ringScreen, stage === 'ring' && !result);
  const ringMeasured = ringFrame !== undefined;
  const [ringImageFailed, setRingImageFailed] = useState(false);
  // Przepełnienie slotu przycisków (code review B-138b): przy ramce blisko minimum dwuwierszowy podpis przełącznika wypycha przyciski poza
  // slot - wtedy karta. Sprawdzane po każdej zmianie rozmiaru ramki (nowy rozmiar - nowa próba ramki).
  const ringActionsRef = useRef<HTMLDivElement>(null);
  const [ringOverflow, setRingOverflow] = useState(false);
  useLayoutEffect(() => {
    setRingOverflow(false);
  }, [ringFrame?.width, ringFrame?.height]);
  // Pomiar przed wczytaniem fontu (szerszy font zastępczy łamie podpis na dwie linie) dałby trwałą kartę - po wczytaniu fontów nowa próba.
  // Przejście karta <-> ramka (font, zmiana rozmiaru okna) montuje przyciski od nowa: fokus na nich wraca na body - świadomy przypadek
  // brzegowy (code review B-138b), bez przenoszenia fokusu między wariantami.
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return undefined;
    let alive = true;
    const retry = () => {
      if (alive) setRingOverflow(false);
    };
    void fonts.ready.then(retry);
    fonts.addEventListener?.('loadingdone', retry);
    return () => {
      alive = false;
      fonts.removeEventListener?.('loadingdone', retry);
    };
  }, []);
  useLayoutEffect(() => {
    const element = ringActionsRef.current;
    if (element && !ringOverflow && element.scrollHeight > element.clientHeight + 1) setRingOverflow(true);
  });
  const timed = hasSilence && !noLimit;
  const node = call.nodes.find((candidate) => candidate.id === nodeId);
  // Limit biegnie także przy otwartym notatniku (presja rozmowy; WCAG 2.2.1 zapewnia przełącznik przed połączeniem).
  const countdown = stage === 'call' && timed && lineDone && node?.silence !== undefined;

  const choose = useCallback(
    (step: string) => {
      if (!node || stage !== 'call' || disabled) return;
      const choice = node.choices.find((candidate) => candidate.id === step);
      const next = step === SILENCE ? node.silence : step === HANG_UP ? call.hangUp : choice?.next;
      if (!next) return;
      setPath((list) => [...list, step]);
      setLines((list) => [...list, { who: 'caller', text: node.narration.text }, stepLine(step, choice)]);
      setLineDone(false);
      setRemainingMs(limitSec * 1000);
      if (next.startsWith('#')) {
        setEndingId(next.slice(1));
        setStage('ended');
      } else {
        setNodeId(next);
      }
    },
    [node, stage, disabled, limitSec, call.hangUp],
  );

  // „Odrzuć” na ekranie przychodzącym (D-129): bez rozmowy - od razu zakończenie z treści (`reject`).
  function reject() {
    if (stage !== 'ring' || disabled || !call.reject?.startsWith('#')) return;
    setPath([REJECT]);
    setEndingId(call.reject.slice(1));
    setStage('ended');
  }

  // „Zadzwoń ponownie” (B-137): tylko po nieudanym zapisie - przed zapisem rozmowy nie da się powtórzyć.
  function redial() {
    if (stage !== 'ended' || result || !submitFailed) return;
    redialed.current = true;
    onRetry?.();
    setPath([]);
    setLines([]);
    setEndingId(null);
    setNodeId(call.start);
    setLineDone(false);
    setRemainingMs(limitSec * 1000);
    setStage('ring');
  }

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
    // Ekran przed połączeniem po ponowieniu (B-137); przy pierwszym montażu fokus zostaje na nagłówku bloku (D-076).
    if (stage === 'ring' && path.length === 0 && redialed.current) pickUpRef.current?.focus({ preventScroll: true });
    if (stage === 'ended' && !result) endingRef.current?.focus({ preventScroll: true });
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    // result - tylko stan początkowy (widok wyniku nie przenosi fokusu). ringMeasured: przycisk „Odbierz” w ramce telefonu istnieje
    // dopiero po pomiarze obszaru (B-138b) - fokus po ponowieniu czeka na niego. Przy wyjściu z ekranu przychodzącego (ring -> call/ended)
    // efekt biegnie drugi raz i ustawia ten sam fokus ponownie - bez skutku dla gracza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, nodeId, ringMeasured]);

  const answer = result?.answer ?? (stage === 'ended' ? { path, timed } : undefined);
  const review = result && answer ? walkLiveCall(call, answer.path) : null;
  const shownLines = review ? review.lines : lines;
  const shownEnding = call.endings.find((ending) => ending.id === (review?.ending ?? result?.detail?.ending ?? endingId));
  const gaveInfo = new Set(result?.detail?.gaveInfo ?? []);
  const outcome = result?.detail?.outcome ? OUTCOME[result.detail.outcome] : null;

  if (stage === 'ring' && !result) {
    // Przełącznik limitu czasu i przyciski - te same w karcie i w ramce telefonu (B-138b); `compact` - niższe elementy w slocie ramki.
    const ringActions = (compact: boolean) => (
      <>
        {hasSilence && noTimeLimitDefault && (
          // Konto z „Bez limitów czasu” (D-124): serwer i tak nie przyjmie ciszy po limicie, więc tu bez przełącznika - inaczej
          // włączony limit prowadziłby do ścieżki odrzuconej przy zapisie (ślepa uliczka, code review D-124).
          <p data-testid="live-call-no-limit-account" className={`rounded-btn bg-white/10 px-3 py-2 text-left ${compact ? 'text-sm' : 'text-base'}`}>
            Bez limitu czasu
            <span className="block text-sm text-white/70">Ustawienie Twojego konta (Ustawienia konta → Dostępność).</span>
          </p>
        )}
        {hasSilence && !noTimeLimitDefault && (
          <label className={`flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-3 rounded-btn bg-white/10 px-3 text-left ${compact ? 'py-1 text-sm' : 'text-base'}`}>
            <span>
              Wyłącz limit czasu
              {/* W ramce telefonu krótszy podpis w jednej linii - slot przycisków ma stałą wysokość (B-138b). */}
              <span className="block text-sm text-white/70">{compact ? `Bez odliczania ${limitSec} s.` : `Bez odliczania ${limitSec} s na odpowiedź.`}</span>
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
          ref={pickUpRef}
          data-testid="live-call-answer"
          disabled={disabled}
          onClick={() => setStage('call')}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-btn bg-success px-4 text-base font-semibold text-white hover:bg-success/90 ${compact ? 'min-h-[44px]' : 'min-h-[48px]'} ${FOCUS_RING}`}
        >
          <Phone aria-hidden="true" className="h-5 w-5" />
          Odbierz
        </button>
        {call.reject && (
          <button
            type="button"
            data-testid="live-call-reject"
            disabled={disabled}
            onClick={reject}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-btn bg-danger px-4 text-base font-semibold text-white hover:bg-danger/90 ${compact ? 'min-h-[44px]' : 'min-h-[48px]'} ${FOCUS_RING}`}
          >
            <PhoneOff aria-hidden="true" className="h-5 w-5" />
            Odrzuć
          </button>
        )}
      </>
    );
    // Reduced motion: `#static` zatrzymuje fale dzwonienia w SVG (D-084), jak pulsowanie ikony w karcie.
    const ringImage = call.ringScreen ? withStaticFragment(contentAssetUrl(contentBase, call.ringScreen.image, 'image'), reducedMotion) : null;
    // Grafika się nie wczytała albo przełącznik i przyciski nie mieszczą się w slocie (niska ramka, dwuwierszowy podpis) - karta.
    const frame = call.ringScreen && ringImage && ringFrame && !ringImageFailed && !ringOverflow ? { ...ringFrame, slots: call.ringScreen.slots } : null;
    return (
      <div data-testid="live-call" data-stage="ring" className="flex min-h-0 w-full flex-1 flex-col">
        <Hint variant="bar" text={hints.hint ?? block.tip ?? DEFAULT_HINT.LIVE_CALL} />
        {/* Ramka telefonu (B-138b), gdy obszar jest dość wysoki; niski ekran (telefon w poziomie) i treść bez grafiki - karta. */}
        <div ref={ringAreaRef} className="flex min-h-0 flex-1 items-center justify-center">
          {ringFrame === undefined ? null : frame ? (
            <div data-testid="live-call-ring-frame" className="relative shrink-0 text-center text-white" style={{ width: frame.width, height: frame.height }}>
              {/* Ciemne podłoże w miejscu obudowy telefonu (5,7/2,4/88,6/93,7% sceny 700×1260) - biały tekst czytelny, zanim grafika się wczyta. */}
              <div aria-hidden="true" className="absolute left-[5.7%] top-[2.4%] h-[93.7%] w-[88.6%] rounded-[2rem] bg-ink" />
              {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL; dekoracja (status i nazwa są w HTML) */}
              <img
                src={ringImage!}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                onError={() => setRingImageFailed(true)}
                className="absolute inset-0 h-full w-full"
              />
              <p className="absolute flex items-center justify-center whitespace-nowrap text-sm text-white/80" style={slotStyle(frame.slots.status)}>
                Połączenie przychodzące
              </p>
              <p data-testid="live-call-caller" className="absolute flex items-center justify-center text-2xl font-bold leading-tight" style={slotStyle(frame.slots.caller)}>
                <span className="min-w-0 truncate">{call.caller.display}</span>
              </p>
              {call.caller.number && (
                <p className="absolute flex items-center justify-center text-sm tracking-wider text-white/80" style={slotStyle(frame.slots.number)}>
                  {call.caller.number}
                </p>
              )}
              {/* Dociśnięte do dołu przez `mt-auto` (nie `justify-end`): nadmiar idzie w dół i liczy się do scrollHeight - przy justify-end
                  wystawałby w górę, poza obszar przewijania, i pomiar przepełnienia by go nie widział (code review B-138b). */}
              <div ref={ringActionsRef} data-testid="live-call-ring-actions" className="absolute flex flex-col" style={slotStyle(frame.slots.actions)}>
                <div className="mt-auto flex flex-col gap-2">{ringActions(true)}</div>
              </div>
            </div>
          ) : (
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
            <div className="flex w-full flex-col gap-3 [@media(max-height:500px)]:flex-1">{ringActions(false)}</div>
          </div>
          )}
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
          {stage === 'call' && node && call.hangUp && (
            // „Rozłącz” (D-129) - dostępne przez całą rozmowę, także przed końcem kwestii dzwoniącego.
            <button
              type="button"
              data-testid="live-call-hangup"
              disabled={disabled}
              onClick={() => choose(HANG_UP)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-btn bg-danger px-3 text-sm font-semibold text-white hover:bg-danger/90 ${FOCUS_RING}`}
            >
              <PhoneOff aria-hidden="true" className="h-4 w-4" />
              Rozłącz
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
            {stage === 'ended' && !result && submitFailed && (
              <button
                type="button"
                data-testid="live-call-redial"
                disabled={disabled}
                onClick={redial}
                className={`inline-flex min-h-[48px] items-center gap-2 rounded-btn bg-success px-4 text-base font-semibold text-white hover:bg-success/90 ${FOCUS_RING}`}
              >
                <Phone aria-hidden="true" className="h-5 w-5" />
                Zadzwoń ponownie
              </button>
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
      {/* Nagranie kwestii (LineAudio.tsx): koniec, błąd, blokada odtwarzania albo zawieszenie = kwestia wysłuchana - od tej chwili
          biegnie limit czasu. */}
      {stage === 'call' && node && (
        <LineAudio key={nodeId} testId="live-call-audio" src={nodeAudio} muted={muted} durationMs={node.narration.durationMs} onDone={() => setLineDone(true)} />
      )}
      {endingAudio && <LineAudio key={`ending-${endingId}`} testId="live-call-audio" src={endingAudio} muted={muted} durationMs={shownEnding?.narration.durationMs} />}
    </div>
  );
}
