'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { ContentBlock, ContentReaction, ResultDetail } from '@/lib/courses-types';
import {
  boardLayout,
  boardOrientation,
  boardRatio,
  feedbackSentence,
  pinOf,
  placeCard,
  tiltOf,
  yarnSegments,
  type BoardLayout,
  type BoardOrientation,
  type Rect,
} from '@/lib/evidence-board';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

// Układanie kroków w kolejności jako TABLICA ŚLEDCZA (feat/evidence-board, D-088). Korek w drewnianej ramie, pola 1..N w kształcie U
// (telefon w pionie: zygzak), czerwona nić między pinezkami (ciągła między przypiętymi, przerywana do pustych), "zdjęcia" początku i
// końca łańcucha z treści (start/end). Ślady leżą na tacce (kolejność przetasowana przez serwer - seed przypisania, D-051). Trzy
// sposoby przypięcia: przeciąganie (pointer events), klik ślad -> klik pole, klawiatura (te same przyciski; Esc anuluje wybór).
// Upuszczenie na zajęte pole = zamiana. "Sprawdź trop", gdy wszystkie pola są pełne; ocenę liczy wyłącznie serwer.
// Wynik: dobre pola - zielona pinezka z ✓, złe - drgnięcie; potem karty przelatują na poprawne miejsca, nić ciągła, pod tablicą jedno
// zdanie informacji zwrotnej (z reakcji wyniku). Podgląd ukończonego bloku i reduced-motion: od razu stan końcowy, bez lotów.
// Odpowiedź dla serwera bez zmian: { order: [id nieprzejrzyste...] }.

export interface OrderingResult {
  answer?: { order: string[] };
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
  reaction?: ContentReaction;
}

type Target = number | 'tray';
const DRAG_THRESHOLD_PX = 6;
const VERDICT_MS = 1400;
// Poniżej tej szerokości sceny poziomej tekst kart ma < ~8 px (telefon w poziomie).
const COMPACT_BOARD_PX = 700;

function reducedMotionNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Pozycja elementu w % sceny (scena skaluje się jak obraz, więc procenty trzymają układ). */
function place(rect: Rect, layout: BoardLayout): CSSProperties {
  return {
    left: `${(rect.x / layout.width) * 100}%`,
    top: `${(rect.y / layout.height) * 100}%`,
    width: `${(rect.w / layout.width) * 100}%`,
    height: `${(rect.h / layout.height) * 100}%`,
  };
}

/** Rozmiar czcionki/odstępu w jednostkach projektu sceny (--u = szerokość sceny / szerokość projektu). */
const u = (value: number) => `calc(var(--u) * ${value})`;

export default function OrderingBlock({
  block,
  onSubmit,
  disabled,
  result,
  onContinue,
  continueLabel = 'Dalej',
  caseNo,
}: {
  block: ContentBlock;
  onSubmit?: (answer: { order: string[] }) => void;
  disabled?: boolean;
  result?: OrderingResult;
  onContinue?: () => void;
  continueLabel?: string;
  /** Numer sprawy (karta sprawy w odprawie) na tabliczce tablicy. */
  caseNo?: string;
}) {
  const items = block.items ?? [];
  const ids = items.map((item) => item.id ?? item.text);
  const textOf = (id: string) => items.find((item) => (item.id ?? item.text) === id)?.text ?? '';
  const readOnly = !!result;
  const reducedMotion = usePrefersReducedMotion();
  const outerRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<BoardOrientation>('landscape');
  const [cramped, setCramped] = useState(false);
  const layout = boardLayout(ids.length, orientation, { start: !!block.start, end: !!block.end });

  const [placements, setPlacements] = useState<(string | null)[]>(() => ids.map(() => null));
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; offX: number; offY: number; w: number; h: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<Target | null>(null);
  const dragStart = useRef<{ id: string; x: number; y: number; rect: DOMRect; touchTray: boolean } | null>(null);
  // Czy przeciąganie już ruszyło - ref, nie stan: pointermove jest zdarzeniem ciągłym (React go grupuje), więc handler pointerup
  // mógłby jeszcze widzieć stary stan `drag`.
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const checkRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Wynik: najpierw werdykt na układzie gracza, potem (po VERDICT_MS) karty lecą na poprawne miejsca. Podgląd bez "Dalej" i
  // reduced-motion - od razu stan końcowy.
  const playerOrder = result?.answer?.order ?? [];
  const correctOrder = result?.detail?.correctOrder ?? [];
  // Bez poprawnej kolejności z serwera (starsza treść/postęp) nie ma czego pokazywać w werdykcie - od razu stan końcowy.
  const [phase, setPhase] = useState<'verdict' | 'settled'>(() => (result && (!onContinue || !result.detail?.correctOrder?.length) ? 'settled' : 'verdict'));
  useEffect(() => {
    if (!result || phase !== 'verdict') return undefined;
    if (reducedMotionNow()) {
      setPhase('settled');
      return undefined;
    }
    const timer = window.setTimeout(() => setPhase('settled'), VERDICT_MS);
    return () => window.clearTimeout(timer);
    // Jednorazowo przy pokazaniu wyniku: rodzic tworzy obiekt `result` przy każdym renderze (np. postęp narracji), więc zależność od
    // niego restartowałaby timer w kółko; nowy wynik = nowy komponent (key w CoursePlayer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orientacja z WŁASNEGO dostępnego miejsca (nie z okna): telefon w pionie -> zygzak.
  useLayoutEffect(() => {
    const element = outerRef.current;
    if (!element) return undefined;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const next = boardOrientation(width, height);
      setOrientation(next);
      // Telefon w poziomie: tablica 16:9 ograniczona niską wysokością ma drobny tekst kart - podpowiedź, by obrócić telefon (pionowy
      // zygzak jest dla tego ekranu). Szerokość sceny = min(szerokość, wysokość × 16/9). Tylko przy dotyku (pointer: coarse) - wąskie
      // okno desktopu z myszą nie jest telefonem (ta sama zasada co PlayerStage, PR #44).
      const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
      setCramped(touch && next === 'landscape' && Math.min(width, height * boardRatio('landscape')) < COMPACT_BOARD_PX);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown: (string | null)[] = readOnly ? (phase === 'settled' && correctOrder.length > 0 ? correctOrder : playerOrder) : placements;
  const inPlace = (id: string) => correctOrder.length > 0 && playerOrder.indexOf(id) === correctOrder.indexOf(id);
  const inPlaceCount = playerOrder.filter((id) => inPlace(id)).length;
  const tray = readOnly ? [] : ids.filter((id) => !placements.includes(id));
  const full = !readOnly && placements.every((id) => id !== null);
  const segments = yarnSegments(
    layout,
    shown.map((id) => id !== null),
  );
  const flying = readOnly && !reducedMotion;

  function move(id: string, target: Target) {
    const from = placements.indexOf(id);
    const occupant = typeof target === 'number' ? placements[target] : null;
    const next = placeCard(placements, id, target);
    setPlacements(next);
    setSelected(null);
    if (target === 'tray') setAnnouncement(`Ślad „${textOf(id)}” wrócił na tackę.`);
    else if (occupant && occupant !== id)
      setAnnouncement(
        from >= 0
          ? `Ślady zamienione: „${textOf(id)}” na polu ${target + 1}, „${textOf(occupant)}” na polu ${from + 1}.`
          : `Ślad „${textOf(id)}” przypięty do pola ${target + 1}, „${textOf(occupant)}” wrócił na tackę.`,
      );
    else setAnnouncement(`Ślad „${textOf(id)}” przypięty do pola ${target + 1}.`);
    // Fokus po przypięciu (przycisk pustego pola znika): z tacki - na następny ślad na tacce (tablica pełna - "Sprawdź trop", efekt
    // niżej); między polami i na tackę - na przeniesiony ślad.
    const nextTray = ids.find((candidate) => !next.includes(candidate) && candidate !== id);
    pendingFocus.current = target !== 'tray' && from < 0 ? (nextTray ?? null) : id;
  }

  // Fokus ustawiany po renderze (węzły kart zmieniają miejsce w DOM).
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    pendingFocus.current = null;
    if (id === null) return;
    // Id z serwera są nieprzejrzyste (hex), ale cudzysłów i tak ucieczkowany - selektor nie może się rozjechać.
    rootRef.current?.querySelector<HTMLElement>(`[data-card-id="${id.replace(/["\\]/g, '\\$&')}"]`)?.focus();
  }, [placements]);

  // Po ostatnim przypięciu fokus na "Sprawdź trop" (pojawia się, gdy tacka jest pusta).
  useEffect(() => {
    if (full) checkRef.current?.focus();
  }, [full]);

  function clickCard(id: string, byKeyboard: boolean) {
    if (suppressClick.current || readOnly || disabled) return;
    const slotIndex = placements.indexOf(id);
    if (selected && selected !== id && slotIndex >= 0) {
      move(selected, slotIndex);
      return;
    }
    const next = selected === id ? null : id;
    setSelected(next);
    setAnnouncement(next ? `Wybrano ślad „${textOf(id)}”. Wybierz pole na tablicy.` : 'Anulowano wybór śladu.');
    // Klawiatura: pola są w DOM przed tacką - po wyborze śladu fokus od razu na pierwsze puste pole (Tab/Shift+Tab między polami).
    if (next && byKeyboard) {
      const firstEmpty = placements.findIndex((candidate) => candidate === null);
      if (firstEmpty >= 0) window.setTimeout(() => rootRef.current?.querySelector<HTMLElement>(`[data-slot-index="${firstEmpty}"]:not([data-card-id])`)?.focus(), 0);
    }
  }

  function clickSlot(index: number) {
    if (readOnly || disabled) return;
    if (!selected) {
      setAnnouncement('Najpierw wybierz ślad z tacki.');
      return;
    }
    move(selected, index);
  }

  function clickTray() {
    if (!selected || placements.indexOf(selected) < 0) return;
    move(selected, 'tray');
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && selected) {
      event.stopPropagation();
      setSelected(null);
      setAnnouncement('Anulowano wybór śladu.');
    }
  }

  // Przeciąganie (mysz, dotyk, pióro): dopiero po przesunięciu o DRAG_THRESHOLD_PX - krótki klik zostaje wyborem.
  function pointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    // Tylko główny przycisk (prawy/środkowy nie przeciąga).
    if (readOnly || disabled || event.button > 0) return;
    const fromTray = placements.indexOf(id) < 0;
    dragStart.current = { id, x: event.clientX, y: event.clientY, rect: event.currentTarget.getBoundingClientRect(), touchTray: fromTray && event.pointerType === 'touch' };
    // Na tacce przy dotyku przechwytujemy dopiero, gdy ruch okaże się przeciąganiem (pionowym) - poziomy ruch przewija tackę.
    if (!dragStart.current.touchTray) event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function targetAt(x: number, y: number): Target | null {
    const element = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    const slot = element?.closest<HTMLElement>('[data-slot-index]');
    if (slot) return Number(slot.dataset.slotIndex);
    if (element?.closest('[data-board-tray]')) return 'tray';
    return null;
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStart.current;
    if (!start) return;
    if (!dragging.current) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Dotyk na tacce: ruch głównie poziomy to przewijanie tacki (touch-action: pan-x), nie przeciąganie śladu.
      if (start.touchTray && Math.abs(dx) > Math.abs(dy)) {
        dragStart.current = null;
        return;
      }
      dragging.current = true;
      if (start.touchTray) event.currentTarget.setPointerCapture?.(event.pointerId);
      setSelected(null);
    }
    const { clientX, clientY } = event;
    setDrag({ id: start.id, x: clientX, y: clientY, offX: start.x - start.rect.left, offY: start.y - start.rect.top, w: start.rect.width, h: start.rect.height });
    setHoverTarget(targetAt(clientX, clientY));
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStart.current;
    const wasDragging = dragging.current;
    dragStart.current = null;
    dragging.current = false;
    if (!start || !wasDragging) return;
    const target = targetAt(event.clientX, event.clientY);
    setDrag(null);
    setHoverTarget(null);
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (target !== null && !(target === 'tray' && placements.indexOf(start.id) < 0)) move(start.id, target);
  }

  function pointerCancel() {
    dragStart.current = null;
    dragging.current = false;
    setDrag(null);
    setHoverTarget(null);
  }

  const cardHandlers = (id: string) => ({
    // detail 0 = aktywacja klawiaturą (Enter/Spacja).
    onClick: (event: { detail: number }) => clickCard(id, event.detail === 0),
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => pointerDown(event, id),
    onPointerMove: pointerMove,
    onPointerUp: pointerUp,
    onPointerCancel: pointerCancel,
    // Karta znikła albo przeglądarka odebrała wskaźnik w trakcie - bez tego klon zostałby na ekranie.
    onLostPointerCapture: () => {
      if (dragging.current) pointerCancel();
    },
  });

  // Pion: 17 (nie 18) - przy 18 najdłuższy ślad modułu 1 mieścił się w karcie bez zapasu i zaokrąglenia glifów (390x844, ~11 px)
  // dawały dodatkową linię ucinaną przez overflow (layout-check b3).
  const cardText = { fontSize: u(orientation === 'portrait' ? 17 : 15), lineHeight: 1.3 } as CSSProperties;
  // Zdanie pod tablicą: z reakcji wyniku, a bez niej z wyjaśnienia autora (`explanation` z serwera), na końcu - zdanie ogólne.
  const feedback = feedbackSentence(result?.reaction?.text ?? result?.detail?.explanation, result?.correct);
  const titleText = caseNo ? `Tablica śledcza · ${caseNo}` : 'Tablica śledcza';

  return (
    <div ref={rootRef} className="evidence-board flex min-h-0 w-full flex-1 flex-col" onKeyDown={onKeyDown}>
      {block.prompt && <p className="mb-2 shrink-0 text-sm text-muted [@media(max-height:500px)]:sr-only">{block.prompt}</p>}
      {cramped && (
        <p data-testid="board-rotate-hint" className="mb-1 shrink-0 text-center text-xs font-semibold text-accent-ink">
          Obróć telefon pionowo, żeby wygodniej czytać i przypinać ślady.
        </p>
      )}
      <div ref={outerRef} className="relative flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
        <section
          aria-label={titleText}
          data-testid="evidence-board"
          data-orientation={orientation}
          data-phase={readOnly ? phase : 'play'}
          className="board-box relative select-none"
          style={{ '--board-ratio': String(boardRatio(orientation)), aspectRatio: 'var(--board-ratio)' } as CSSProperties}
        >
          <div className="absolute inset-0" style={{ '--u': `calc(100cqw / ${layout.width})` } as CSSProperties}>
            <div aria-hidden="true" className="absolute rounded-[calc(var(--u)*18)] bg-[var(--board-frame)] shadow-card" style={place(layout.frame, layout)} />
            <div aria-hidden="true" className="board-cork absolute rounded-[calc(var(--u)*8)]" style={place(layout.cork, layout)} />
            <p
              className="absolute z-[3] -rotate-[1.5deg] rounded-[calc(var(--u)*6)] bg-surface font-extrabold text-ink shadow-card"
              style={{ left: `${(layout.title.x / layout.width) * 100}%`, top: `${(layout.title.y / layout.height) * 100}%`, fontSize: u(18), padding: `${u(6)} ${u(12)}` }}
            >
              {titleText}
            </p>

            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] h-full w-full" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none">
              {segments.map((segment, index) => (
                <path
                  key={index}
                  d={segment.d}
                  fill="none"
                  stroke="var(--danger)"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeDasharray={segment.solid ? undefined : '10 8'}
                  opacity={segment.solid ? 1 : 0.8}
                  data-yarn={segment.solid ? 'solid' : 'dashed'}
                />
              ))}
            </svg>

            {block.start && layout.start && <Photo rect={layout.start} layout={layout} label={block.start.label} caption={block.start.caption} tone="accent" tilt={-4} />}
            {block.end && layout.end && <Photo rect={layout.end} layout={layout} label={block.end.label} caption={block.end.caption} tone="danger" tilt={3} />}

            {layout.slots.map((slot, index) => {
              const id = shown[index] ?? null;
              if (id !== null) return null;
              const active = !!selected || (drag !== null && hoverTarget === index);
              return (
                <button
                  key={`slot-${index}`}
                  type="button"
                  data-slot-index={index}
                  aria-label={`Pole ${index + 1}, puste${selected ? ' - przypnij tu wybrany ślad' : ''}`}
                  disabled={readOnly || disabled}
                  onClick={() => clickSlot(index)}
                  className={`absolute z-[1] flex items-center justify-center rounded-[calc(var(--u)*6)] border-[calc(var(--u)*3)] border-dashed font-extrabold outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    active ? 'border-accent bg-accent/15 text-accent' : 'border-ink/30 bg-white/10 text-ink/25'
                  } ${drag !== null && hoverTarget === index ? 'ring-4 ring-accent' : ''}`}
                  style={{ ...place(slot, layout), fontSize: u(40) }}
                >
                  {index + 1}
                </button>
              );
            })}

            {/* Wynik: karty w STAŁEJ kolejności `ids` - przy werdykcie -> stanie końcowym React nie przestawia węzłów w DOM, tylko zmienia
                left/top, więc przelot działa dla każdej karty. W trakcie gry: kolejność pól 1..N (kolejność Tab = kolejność na tablicy). */}
            {(readOnly ? ids : placements.filter((id): id is string => id !== null)).map((id) => {
              const index = shown.indexOf(id);
              if (index < 0) return null;
              const slot = layout.slots[index];
              const pin = pinOf(slot);
              const good = readOnly && inPlace(id);
              const wrong = readOnly && phase === 'verdict' && correctOrder.length > 0 && !inPlace(id);
              return (
                <div key={`placed-${id}`} className="contents">
                  <button
                    type="button"
                    data-slot-index={index}
                    data-card-id={id}
                    aria-label={`Pole ${index + 1}: ${textOf(id)}${good ? ' (na właściwym miejscu)' : ''}${selected === id ? ' - wybrany' : ''}`}
                    aria-pressed={readOnly ? undefined : selected === id}
                    aria-disabled={readOnly ? true : undefined}
                    disabled={disabled && !readOnly}
                    {...(readOnly ? {} : cardHandlers(id))}
                    className={`board-card absolute z-[4] text-left text-ink outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      flying ? 'board-fly' : ''
                    } ${selected === id ? 'ring-4 ring-accent' : ''} ${drag?.id === id ? 'opacity-40' : ''} ${readOnly ? 'cursor-default' : 'cursor-grab touch-none'}`}
                    style={{ ...place(slot, layout), transform: `rotate(${tiltOf(index)}deg)` }}
                  >
                    <span className={`block h-full w-full overflow-hidden ${wrong ? 'board-card-wrong' : ''}`} style={{ ...cardText, padding: `${u(20)} ${u(12)} ${u(8)}` }}>
                      {textOf(id)}
                    </span>
                  </button>
                  <span
                    key={`pin-${id}`}
                    aria-hidden="true"
                    className={`board-pin absolute z-[5] flex items-center justify-center rounded-full ${good ? 'board-pin--good' : ''} ${flying ? 'board-fly' : ''}`}
                    style={{ left: `${((pin.x - 9) / layout.width) * 100}%`, top: `${((pin.y - 9) / layout.height) * 100}%`, width: u(18), height: u(18) }}
                  >
                    {good && <Check className="text-white" style={{ width: u(13), height: u(13) }} strokeWidth={3} />}
                  </span>
                </div>
              );
            })}

            <div
              data-board-tray
              role="group"
              aria-label="Ślady do przypięcia"
              onClick={(event) => {
                if (event.target === event.currentTarget) clickTray();
              }}
              className={`absolute z-[3] flex flex-col rounded-[calc(var(--u)*14)] border border-border bg-paper ${drag !== null && hoverTarget === 'tray' ? 'ring-4 ring-accent' : ''}`}
              style={{ ...place(layout.tray, layout), padding: `${u(8)} ${u(14)}` }}
            >
              {readOnly ? (
                <div className="flex min-h-0 flex-1 flex-wrap items-center justify-between gap-[calc(var(--u)*10)]">
                  <div className="min-w-0 flex-1" style={{ fontSize: u(orientation === 'portrait' ? 22 : 18) }}>
                    <p data-testid="board-feedback" className="font-semibold text-ink">
                      {feedback}
                    </p>
                    <p className="text-muted" style={{ fontSize: u(orientation === 'portrait' ? 18 : 14) }}>
                      Na właściwym miejscu: {inPlaceCount} z {ids.length}
                      {typeof result?.points === 'number' && ` · Wynik: ${Math.round(result.points * 100)}%`}
                    </p>
                  </div>
                  {onContinue && (
                    <button
                      type="button"
                      onClick={onContinue}
                      className="shrink-0 rounded-btn bg-ink font-bold text-white hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      style={{ fontSize: u(orientation === 'portrait' ? 22 : 16), padding: `${u(10)} ${u(20)}`, minHeight: 44 }}
                    >
                      {continueLabel}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className="shrink-0 font-bold uppercase tracking-[0.08em] text-muted" style={{ fontSize: u(orientation === 'portrait' ? 16 : 12) }}>
                    Ślady do przypięcia · {tray.length}
                  </p>
                  <div className="flex min-h-0 flex-1 items-center gap-[calc(var(--u)*16)]">
                    <ul className="flex h-full min-w-0 flex-1 items-center gap-[calc(var(--u)*16)] overflow-x-auto overflow-y-hidden">
                      {tray.map((id) => (
                        <li key={id} className="shrink-0" style={{ width: u(layout.card.w), height: u(layout.card.h) }}>
                          <button
                            type="button"
                            data-card-id={id}
                            aria-label={`Ślad: ${textOf(id)}${selected === id ? ' - wybrany, wybierz pole' : ''}`}
                            aria-pressed={selected === id}
                            disabled={disabled}
                            {...cardHandlers(id)}
                            // pan-x: palcem w poziomie przewija się tacka; przeciąganie śladu - ruchem pionowym (pointerMove).
                            className={`board-card block h-full w-full cursor-grab touch-pan-x text-left text-ink outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent ${
                              selected === id ? 'ring-4 ring-accent' : ''
                            } ${drag?.id === id ? 'opacity-40' : ''}`}
                          >
                            <span className="block h-full w-full overflow-hidden" style={{ ...cardText, padding: `${u(18)} ${u(12)} ${u(8)}` }}>
                              {textOf(id)}
                            </span>
                          </button>
                        </li>
                      ))}
                      {selected && placements.includes(selected) && (
                        <li className="shrink-0">
                          <button
                            type="button"
                            onClick={clickTray}
                            className="rounded-btn border border-border bg-surface font-semibold text-ink hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                            style={{ fontSize: u(14), padding: `${u(8)} ${u(14)}`, minHeight: 44 }}
                          >
                            Odłóż na tackę
                          </button>
                        </li>
                      )}
                    </ul>
                    {full && (
                      <button
                        ref={checkRef}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSubmit?.({ order: placements as string[] })}
                        className="shrink-0 rounded-btn bg-accent font-bold text-white hover:bg-accent-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        style={{ fontSize: u(orientation === 'portrait' ? 22 : 17), padding: `${u(12)} ${u(22)}`, minHeight: 44 }}
                      >
                        Sprawdź trop
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
      {/* Jeden region ogłoszeń: przy wyniku zdanie + liczba trafień, w trakcie - ruchy śladów. */}
      <p className="sr-only" role="status" aria-live="polite">
        {readOnly ? `${feedback} Na właściwym miejscu: ${inPlaceCount} z ${ids.length}.` : announcement}
      </p>
      {drag &&
        typeof document !== 'undefined' &&
        createPortal(
          // Klon poza drzewem tablicy (portal): klasa evidence-board daje mu tokeny kartki, --u z rozmiaru karty - tę samą czcionkę.
          <div
            aria-hidden="true"
            className="evidence-board board-card pointer-events-none fixed z-[100] overflow-hidden text-ink shadow-2xl outline outline-[3px] outline-accent"
            style={
              {
                left: drag.x - drag.offX,
                top: drag.y - drag.offY,
                width: drag.w,
                height: drag.h,
                transform: 'rotate(4deg)',
                '--u': `${drag.w / layout.card.w}px`,
              } as CSSProperties
            }
          >
            <span className="block h-full w-full overflow-hidden" style={{ ...cardText, padding: `${u(18)} ${u(12)} ${u(8)}` }}>
              {textOf(drag.id)}
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Photo({ rect, layout, label, caption, tone, tilt }: { rect: Rect; layout: BoardLayout; label: string; caption: string; tone: 'accent' | 'danger'; tilt: number }) {
  const pin = pinOf(rect);
  return (
    <>
      <div
        data-board-photo
        className="absolute z-[3] flex flex-col bg-surface text-center shadow-card"
        style={{ ...place(rect, layout), transform: `rotate(${tilt}deg)`, padding: `${u(8)} ${u(8)} ${u(4)}` }}
      >
        <span
          className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-accent-soft font-extrabold ${tone === 'danger' ? 'text-danger' : 'text-accent'}`}
          style={{ fontSize: u(26) }}
        >
          <span className="sr-only">{tone === 'danger' ? 'Koniec łańcucha: ' : 'Początek łańcucha: '}</span>
          {label}
        </span>
        <span className="shrink-0 font-bold text-ink" style={{ fontSize: u(13), paddingTop: u(4) }}>
          {caption}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="board-pin absolute z-[5] rounded-full"
        style={{ left: `${((pin.x - 9) / layout.width) * 100}%`, top: `${((pin.y - 9) / layout.height) * 100}%`, width: u(18), height: u(18) }}
      />
    </>
  );
}
