'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Check, X } from 'lucide-react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { feedbackSentence } from '@/lib/evidence-board';
import { usePortraitContainer } from '@/lib/use-portrait-container';
import type { OrderingResult } from './OrderingBlock';

// Tablica z notatkami (ORDERING `look: 'notes'`, D-182 - jak na nagraniu właściciela): korkowa tablica (grafika `background`, wariant
// pionowy `backgroundPortrait`), na niej ponumerowane kartki z notesu z notatkami gracza o każdym etapie (`slots[N].notes`) i polem
// „Przeciągnij tutaj”; pod tablicą etykiety etapów (`items`, kolejność przetasowana przez serwer). Przypięcie: przeciągnięcie etykiety
// na kartkę, klik etykieta -> klik kartka albo klawiatura (te same przyciski). Etykieta na zajętej kartce = zamiana; klik w etykietę
// na kartce ją wybiera (przeniesienie albo „Odłóż”). „Sprawdź trop”, gdy wszystkie kartki mają etykietę - ocena wyłącznie na serwerze,
// odpowiedź jak w zwykłej tablicy: { order: [id etykiety na kartce 1, 2, ...] }.
// Poziomo: kartki w stałym układzie na tablicy (proporcje grafiki, „contain”) połączone czerwoną nicią. Pionowo (telefon): tablica
// jako tło, kartki jedna pod drugą (przewijane), etykiety pod nimi.

const DRAG_THRESHOLD_PX = 6;
const VERDICT_MS = 1400;
// Pozycje kartek na tablicy poziomej (% ramki tablicy o proporcjach grafiki) - wolne pole korka z grafiki z Dreaminy (zdjęcie i
// karteczki przy krawędziach). Dla 1-2 kartek - pierwsze pozycje; więcej niż 3 - kolejne w rzędzie (zawija się w siatkę).
const LANDSCAPE_SLOTS = [
  { left: 13, top: 13, width: 24 },
  { left: 39, top: 22, width: 24 },
  { left: 63, top: 46, width: 22 },
];
// Najmniejszy obszar bloku dla tablicy poziomej - poniżej kartki (22-24% szerokości) miałyby kilka słów w wierszu (telefon w poziomie).
const MIN_BOARD_WIDTH = 700;
const MIN_BOARD_HEIGHT = 420;
// Proporcje tła poziomego modułu 1 (1920×990 po kadrowaniu) - do czasu wczytania grafiki; zgodne z grafiką, żeby tablica nie
// przeskakiwała po wczytaniu (przeskok w trakcie przeciągania kładł etykietę obok kartki).
const DEFAULT_RATIO = 1920 / 990;

export default function NotesBoard({
  block,
  contentBase,
  onSubmit,
  disabled,
  result,
  live = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit?: (answer: { order: string[] }) => void;
  disabled?: boolean;
  result?: OrderingResult;
  live?: boolean;
}) {
  const items = block.items ?? [];
  const ids = items.map((item) => item.id ?? item.text);
  const textOf = (id: string) => items.find((item) => (item.id ?? item.text) === id)?.text ?? '';
  const slots = block.slots ?? [];
  const readOnly = !!result;
  const [rootRef, portraitMeasured] = usePortraitContainer<HTMLDivElement>();
  // Układ listy (kartki jedna pod drugą, przewijane): telefon w pionie albo obszar za mały na tablicę poziomą z czytelnymi kartkami
  // (telefon w poziomie, wąskie okno) - mierzony cały blok (zawsze zamontowany), więc układ nie przeskakuje.
  const [roomy, setRoomy] = useState(true);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setRoomy(width >= MIN_BOARD_WIDTH && height >= MIN_BOARD_HEIGHT);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // rootRef jest stabilny.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const portrait = portraitMeasured === true || !roomy;
  const [ratio, setRatio] = useState<number>(DEFAULT_RATIO);
  // Tablica pozioma „contain” w obszarze sceny: rozmiar sceny mierzony ResizeObserverem, ramka o proporcjach grafiki.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setStage((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [portraitMeasured]);
  const frameWidth = Math.max(0, Math.min(stage.width, stage.height * ratio));
  const frame = { width: frameWidth, height: frameWidth / ratio };

  const [placements, setPlacements] = useState<(string | null)[]>(() => slots.map(() => null));
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const suppressClickUntil = useRef(0);
  const checkRef = useRef<HTMLButtonElement>(null);

  const playerOrder = result?.answer?.order ?? [];
  const correctOrder = result?.detail?.correctOrder ?? [];
  const [phase, setPhase] = useState<'verdict' | 'settled'>(() => (result && (!live || correctOrder.length === 0) ? 'settled' : 'verdict'));
  useEffect(() => {
    if (!result || phase !== 'verdict') return undefined;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPhase('settled');
      return undefined;
    }
    const timer = window.setTimeout(() => setPhase('settled'), VERDICT_MS);
    return () => window.clearTimeout(timer);
    // Jednorazowo przy pokazaniu wyniku (nowy wynik = nowy komponent, key w CoursePlayer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown: (string | null)[] = readOnly ? (phase === 'settled' && correctOrder.length > 0 ? correctOrder : playerOrder) : placements;
  const verdictOf = (index: number): 'good' | 'bad' | null => {
    if (!readOnly || correctOrder.length === 0) return null;
    if (phase === 'settled') return playerOrder[index] === correctOrder[index] ? 'good' : null;
    return playerOrder[index] === correctOrder[index] ? 'good' : 'bad';
  };
  const tray = readOnly ? [] : ids.filter((id) => !placements.includes(id));
  const full = !readOnly && placements.length > 0 && placements.every((id) => id !== null);
  const inPlaceCount = playerOrder.filter((id, index) => correctOrder[index] === id).length;

  // Fokus po przypięciu (przycisk pustej kartki albo „Odłóż” znika z DOM - bez tego fokus spadłby na <body>): na etykietę na kartce,
  // po odłożeniu - na etykietę pod tablicą; przy pełnej tablicy - na „Sprawdź trop”.
  const focusAfter = useRef<{ slot: number } | { label: string } | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (full) {
      checkRef.current?.focus();
      return;
    }
    if (!target) return;
    const root = rootRef.current;
    const element =
      'slot' in target
        ? root?.querySelector<HTMLElement>(`button[data-testid="notes-slot"][data-slot="${target.slot}"]`)
        : Array.from(root?.querySelectorAll<HTMLElement>('button[data-testid="notes-label"]') ?? []).find((el) => el.dataset.label === target.label);
    element?.focus();
    // rootRef jest stabilny; efekt reaguje na zmianę ułożenia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, full]);

  function place(id: string, target: number | 'tray') {
    const from = placements.indexOf(id);
    const next = [...placements];
    focusAfter.current = target === 'tray' ? { label: id } : { slot: target };
    if (target === 'tray') {
      if (from >= 0) next[from] = null;
      setAnnouncement(`Etap „${textOf(id)}” wrócił pod tablicę.`);
    } else {
      const occupant = next[target];
      if (from >= 0) next[from] = occupant && occupant !== id ? occupant : null;
      next[target] = id;
      setAnnouncement(
        occupant && occupant !== id
          ? from >= 0
            ? `Zamienione: „${textOf(id)}” na kartce ${target + 1}, „${textOf(occupant)}” na kartce ${from + 1}.`
            : `„${textOf(id)}” na kartce ${target + 1}, „${textOf(occupant)}” wrócił pod tablicę.`
          : `„${textOf(id)}” przypięty do kartki ${target + 1}.`,
      );
    }
    setPlacements(next);
    setSelected(null);
  }

  function clickLabel(id: string, event?: { detail: number }) {
    if (readOnly || disabled) return;
    // Pomijamy wyłącznie klik MYSZY tuż po przeciągnięciu (detail > 0, do 300 ms po upuszczeniu); klik z klawiatury (Enter/spacja,
    // detail 0) nigdy - inaczej połknięty Enter psuł obsługę klawiaturą zaraz po przeciągnięciu.
    if ((event?.detail ?? 0) > 0 && performance.now() < suppressClickUntil.current) {
      suppressClickUntil.current = 0;
      return;
    }
    // Wybrana etykieta i klik w etykietę na kartce = zamiana (jak klik w tę kartkę).
    if (selected && selected !== id) {
      const target = placements.indexOf(id);
      if (target >= 0) {
        place(selected, target);
        return;
      }
    }
    setSelected((current) => (current === id ? null : id));
  }

  function clickSlot(index: number) {
    if (readOnly || disabled) return;
    if (selected) place(selected, index);
    else if (placements[index]) setSelected(placements[index]);
  }

  // Przeciąganie (pointer events): etykieta podąża za wskaźnikiem, upuszczenie nad kartką ([data-slot]) przypina, gdzie indziej - odkłada.
  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    // Nowe naciśnięcie = nowy, prawdziwy klik: kasuje okno pomijania kliku po poprzednim przeciągnięciu.
    suppressClickUntil.current = 0;
    if (readOnly || disabled || event.button !== 0) return;
    dragStart.current = { id, x: event.clientX, y: event.clientY };
    dragging.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function slotUnder(x: number, y: number): number | null {
    const element = (document.elementsFromPoint?.(x, y) ?? []).find((el) => el instanceof HTMLElement && el.dataset.slot !== undefined) as HTMLElement | undefined;
    return element ? Number(element.dataset.slot) : null;
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStart.current;
    if (!start) return;
    if (!dragging.current && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return;
    dragging.current = true;
    setDrag({ id: start.id, x: event.clientX, y: event.clientY });
    setHoverSlot(slotUnder(event.clientX, event.clientY));
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || !dragging.current) return;
    dragging.current = false;
    // Klik myszy po przeciągnięciu (jeśli przeglądarka go wyśle - przy przechwyconym wskaźniku nie zawsze) jest pomijany przez 300 ms.
    suppressClickUntil.current = performance.now() + 300;
    const target = slotUnder(event.clientX, event.clientY);
    setDrag(null);
    setHoverSlot(null);
    if (target !== null) place(start.id, target);
    else if (placements.includes(start.id)) place(start.id, 'tray');
  }

  // Przerwane przeciąganie (anulowanie wskaźnika, utrata przechwycenia, Escape): klon znika, nic się nie przypina.
  function cancelDrag() {
    dragStart.current = null;
    dragging.current = false;
    setDrag(null);
    setHoverSlot(null);
  }

  const labelProps = (id: string) => ({
    onClick: (event: { detail: number }) => clickLabel(id, event),
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => onPointerDown(event, id),
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelDrag,
    onLostPointerCapture: () => {
      // Po zwykłym puszczeniu pointerup już wyczyścił stan - tu tylko przerwane przeciąganie.
      if (dragging.current) cancelDrag();
    },
  });

  const card = (index: number, style?: CSSProperties) => {
    const id = shown[index] ?? null;
    const verdict = verdictOf(index);
    const hot = hoverSlot === index || (!!selected && !readOnly);
    return (
      <article
        key={index}
        data-testid="notes-card"
        data-result={verdict ?? undefined}
        style={style}
        // `relative` (telefon, kartki w kolumnie) albo `absolute` (tablica pozioma) - nigdy obie klasy naraz (w CSS wygrałaby `relative`).
        className={`notes-card flex flex-col rounded-sm bg-[#FBFAF6] px-[1.1em] pb-[1em] pt-[0.9em] text-[#1E1B16] shadow-[0_10px_24px_rgba(0,0,0,0.45)] ${
          portrait ? 'relative' : 'absolute'
        }`}
      >
        {/* Pinezka i dziurki notesu - dekoracja. */}
        <span aria-hidden="true" className="absolute -top-[0.55em] left-1/2 h-[1.1em] w-[1.1em] -translate-x-1/2 rounded-full bg-[#D9483B] shadow-[0_2px_3px_rgba(0,0,0,0.4)]" />
        <span aria-hidden="true" className="notes-card-holes absolute bottom-[0.8em] left-[0.35em] top-[0.8em] w-[0.45em]" />
        <div className="flex items-center gap-[0.6em] pl-[0.6em]">
          <span aria-hidden="true" className="flex h-[1.9em] w-[1.9em] shrink-0 items-center justify-center rounded-full bg-[#1E7F79] font-bold text-white">
            {index + 1}
          </span>
          {readOnly || !id ? (
            <span
              data-slot={readOnly ? undefined : index}
              data-testid="notes-slot"
              className={`flex min-h-[2.6em] flex-1 items-center justify-center rounded border px-[0.6em] text-center font-semibold ${
                id
                  ? verdict === 'good'
                    ? 'border-green-600 bg-green-50'
                    : verdict === 'bad'
                      ? 'border-red-600 bg-red-50'
                      : 'border-[#1E1B16]/30 bg-white'
                  : 'border-dashed border-[#1E1B16]/40 bg-white/60 text-[#6F6F6B]'
              }`}
            >
              {id ? textOf(id) : readOnly ? '—' : 'Przeciągnij tutaj'}
              {verdict === 'good' && (
                <>
                  <Check aria-hidden="true" className="ml-[0.4em] h-[1em] w-[1em] text-green-700" />
                  <span className="sr-only"> (na właściwym miejscu)</span>
                </>
              )}
              {verdict === 'bad' && (
                <>
                  <X aria-hidden="true" className="ml-[0.4em] h-[1em] w-[1em] text-red-700" />
                  <span className="sr-only"> (nie tutaj)</span>
                </>
              )}
            </span>
          ) : (
            <button
              type="button"
              data-slot={index}
              data-testid="notes-slot"
              aria-label={`Kartka ${index + 1}: ${textOf(id)}`}
              aria-pressed={selected === id}
              {...labelProps(id)}
              className={`flex min-h-[2.6em] flex-1 touch-none items-center justify-center rounded border border-[#6C5CE7] bg-[#EFEDFC] px-[0.6em] text-center font-semibold text-[#3D3570] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected === id ? 'ring-2 ring-[#6C5CE7]' : ''
              }`}
            >
              {textOf(id)}
            </button>
          )}
        </div>
        {/* Pusta kartka - sama kartka też przyjmuje upuszczenie i klik (większy cel niż pole). */}
        {!readOnly && !id && (
          <button
            type="button"
            data-slot={index}
            aria-label={`Kartka ${index + 1}: pusta${selected ? `, przypnij „${textOf(selected)}”` : ''}`}
            onClick={() => clickSlot(index)}
            className={`absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${hot ? 'ring-2 ring-[#6C5CE7]/60' : ''}`}
          />
        )}
        <ul className="pointer-events-none relative mt-[0.7em] list-disc space-y-[0.35em] pl-[2em] leading-snug">
          {(slots[index]?.notes ?? []).map((note, noteIndex) => (
            <li key={noteIndex}>{note}</li>
          ))}
        </ul>
      </article>
    );
  };

  // Grafika pionowa tylko przy pionowym obszarze; lista na niskim ekranie poziomym ma tło poziome.
  const backgroundPath = portraitMeasured === true && block.backgroundPortrait ? block.backgroundPortrait : block.background;
  const backgroundUrl = portraitMeasured === null ? null : contentAssetUrl(contentBase, backgroundPath, 'image');
  const feedback = result ? feedbackSentence(result.reaction?.text ?? result.detail?.explanation, result.correct) : null;
  // Jak w zwykłej tablicy (OrderingBlock): liczba kartek na miejscu i wynik w procentach z serwera.
  const resultLine = [
    correctOrder.length > 0 ? `Na właściwym miejscu: ${inPlaceCount} z ${ids.length}.` : null,
    typeof result?.points === 'number' ? `Wynik: ${Math.round(result.points * 100)}%.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const trayBar = (
    <div className="flex shrink-0 flex-col gap-2 pt-2">
      {!readOnly && (
        <div role="group" aria-label="Etapy ataku do przypięcia" className="flex flex-wrap justify-center gap-2">
          {tray.map((id) => (
            <button
              key={id}
              type="button"
              data-testid="notes-label"
              data-label={id}
              aria-label={`Etap: ${textOf(id)}`}
              aria-pressed={selected === id}
              {...labelProps(id)}
              className={`min-h-[44px] touch-none rounded-btn border bg-white px-4 font-semibold text-ink shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected === id ? 'border-accent ring-2 ring-accent' : 'border-border hover:bg-paper'
              } ${drag?.id === id ? 'opacity-40' : ''}`}
            >
              {textOf(id)}
            </button>
          ))}
          {tray.length === 0 && !full && <span className="text-sm text-muted">Wszystkie etapy są na tablicy.</span>}
        </div>
      )}
      {!readOnly && selected && placements.includes(selected) && (
        <button
          type="button"
          onClick={() => place(selected, 'tray')}
          className="min-h-[44px] self-center rounded-btn border border-border bg-surface px-4 font-semibold text-ink hover:bg-paper"
        >
          Odłóż pod tablicę
        </button>
      )}
      {full && (
        <button
          ref={checkRef}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit?.({ order: placements as string[] })}
          className="min-h-[44px] self-center rounded-btn bg-accent px-6 font-bold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Sprawdź trop
        </button>
      )}
      {feedback && (
        <div className="text-center">
          <p data-testid="board-feedback" className="font-semibold text-ink">
            {feedback}
          </p>
          <p className="text-sm text-muted">{resultLine}</p>
        </div>
      )}
      {/* Region ogłoszeń: przy układaniu - ruchy etykiet; po wyniku (komponent montowany od nowa) - zdanie i wynik, jak w zwykłej tablicy. */}
      <p role="status" className="sr-only">
        {readOnly && feedback ? `${feedback} ${resultLine}` : announcement}
      </p>
    </div>
  );

  // Czerwona nić między pinezkami kartek (tylko poziomo): kartki po kolei 1-2-3 i od zdjęcia w prawym górnym rogu tła do kartki 2 (nić
  // do kartki 3 przecinałaby zdjęcie).
  const pins = LANDSCAPE_SLOTS.slice(0, slots.length).map((slot) => ({ x: slot.left + slot.width / 2, y: slot.top }));
  const PHOTO_PIN = { x: 75, y: 8 };
  const yarnSegments = [
    ...pins.slice(1).map((pin, index) => [pins[index], pin] as const),
    ...(pins.length > 0 ? [[PHOTO_PIN, pins[Math.min(1, pins.length - 1)]] as const] : []),
  ];

  return (
    <div
      ref={rootRef}
      data-testid="notes-board"
      data-phase={readOnly ? phase : undefined}
      data-variant={portrait ? 'portrait' : 'landscape'}
      className="relative isolate flex min-h-0 w-full flex-1 flex-col"
      // Escape: przerywa przeciąganie i odznacza wybraną etykietę.
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || (!selected && !drag)) return;
        cancelDrag();
        setSelected(null);
      }}
    >
      {portrait ? (
        <>
          {backgroundUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
            <img src={backgroundUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-card object-cover" />
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-3 pt-5 text-[15px]">{slots.map((_, index) => card(index))}</div>
        </>
      ) : (
        <div ref={stageRef} data-testid="notes-board-stage" className="relative min-h-[240px] flex-1">
          <div
            className="absolute"
            style={{
              width: frame.width,
              height: frame.height,
              left: (stage.width - frame.width) / 2,
              top: (stage.height - frame.height) / 2,
              // Tekst kartek skalowany szerokością tablicy, nie mniejszy niż 12 px.
              fontSize: `${Math.min(17, Math.max(12, frame.width * 0.012))}px`,
            }}
          >
            {backgroundUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
              <img
                src={backgroundUrl}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                className="pointer-events-none absolute inset-0 h-full w-full rounded-card"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
                }}
              />
            )}
            <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              {yarnSegments.map(([from, to], index) => (
                <path
                  key={index}
                  d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${Math.max(from.y, to.y) + 6} ${to.x} ${to.y}`}
                  fill="none"
                  stroke="#C0392B"
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: 2 }}
                />
              ))}
            </svg>
            <div className="notes-board-cards absolute inset-0">
              {slots.map((_, index) => {
                const slot = LANDSCAPE_SLOTS[index] ?? { left: 13 + (index % 3) * 26, top: 13 + Math.floor(index / 3) * 40, width: 22 };
                return card(index, { left: `${slot.left}%`, top: `${slot.top}%`, width: `${slot.width}%` });
              })}
            </div>
          </div>
        </div>
      )}
      {trayBar}
      {drag && (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-btn border border-accent bg-white px-4 py-2 font-semibold text-ink shadow-card"
          style={{ left: drag.x, top: drag.y }}
        >
          {textOf(drag.id)}
        </span>
      )}
    </div>
  );
}
