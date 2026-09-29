'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Award, X } from 'lucide-react';
import type { PopupItem } from '@/lib/courses-types';

// Easter egg (Q, D-100): komiksowe okienka („wirusy”, „wygrana”, „okup”) po kliknięciu przedmiotu z media.kind "popups" (moduł 1:
// ikona gry na pulpicie Anny). Przesadzony, komiksowy wygląd w kolorach marki - celowo NIE imituje prawdziwych okien systemu ani
// antywirusa. Okienka wyskakują kolejno co 350 ms (lekki obrót, kaskada), ekran „mruga” przy otwarciu. Zamykanie tylko krzyżykiem
// (Esc = krzyżyk górnego okienka, SceneHotspotsBlock); przycisk w okienku nic nie robi - okienko drga, a „dodge” ucieka przed kursorem
// (2 razy, nie na dotyku). Po zamknięciu wszystkich: `outro` i ukryte wyróżnienie w notatniku (onFound - bez XP i dowodów).
// reduced-motion: wszystkie okienka od razu, bez mrugnięcia, drgań i uciekania.

export interface PopupsHandle {
  /** Zamyka górne okienko (Esc); false, gdy żadne nie jest otwarte. */
  closeTop: () => boolean;
  /** true, dopóki nie zamknięto wszystkich okienek (tło i „Odłóż” nie zamykają easter egga). */
  pending: () => boolean;
}

const STAGGER_MS = 350;
const BLINK_MS = 200;
const MAX_DODGES = 2;
const TILTS = [-3, 2.5, -2, 3, -1.5];
const DODGE_OFFSETS = [
  { x: 64, y: -14 },
  { x: -56, y: 12 },
];

/** GG:MM:SS -> sekundy (format pilnuje schemat treści). */
export function countdownSeconds(value: string): number {
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Tytuł do etykiety krzyżyka bez ozdobnych symboli na początku („⚠ Wykryto…” -> „Wykryto…”) - czytnik nie czyta „znak ostrzeżenia”. */
export function spokenTitle(title: string): string {
  return title.replace(/^[^\p{L}\p{N}]+/u, '') || title;
}

export function formatCountdown(total: number): string {
  const safe = Math.max(0, total);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor((safe % 3600) / 60))}:${pad(safe % 60)}`;
}

const PopupsEasterEgg = forwardRef<
  PopupsHandle,
  {
    items: PopupItem[];
    outro: string;
    badge?: { id: string; label: string };
    reducedMotion: boolean;
    /** Wszystkie okienka zamknięte - raz (hotspot do `visited`, wyróżnienie do notatnika). */
    onFound: () => void;
    /** Przycisk po outro (np. „Wróć do pulpitu” w scenie zagnieżdżonej, „Wróć” na scenie głównej). */
    onDone: () => void;
    backLabel?: string;
    /** Wyróżnienie już było w notatniku (ponowne otwarcie przedmiotu) - bez „Nowe”. */
    alreadyFound?: boolean;
    /**
     * Okienka na ekranie monitora (D-116): kontener = prostokąt ekranu (ucina wszystko poza nim), okno max 60% ekranu, kaskada ~6%
     * w jego wnętrzu, okno zmniejszane, gdy nie mieści się w wysokości ekranu.
     */
    onScreen?: boolean;
  }
>(function PopupsEasterEgg({ items, outro, badge, reducedMotion, onFound, onDone, backLabel = 'Wróć', alreadyFound = false, onScreen = false }, ref) {
  const [appeared, setAppeared] = useState(reducedMotion ? items.length : 0);
  const [closed, setClosed] = useState<number[]>([]);
  const [blink, setBlink] = useState(!reducedMotion);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openIndexes = items.map((_, index) => index).filter((index) => index < appeared && !closed.includes(index));
  const top = openIndexes.length > 0 ? openIndexes[openIndexes.length - 1] : null;
  const finished = closed.length === items.length;
  // Stan z chwili OTWARCIA przedmiotu: onFound dopisuje wyróżnienie do notatnika, więc rodzic przelicza `alreadyFound` na true
  // zaraz po znalezieniu - bez zamrożenia pierwsze znalezienie pokazywało outro bez „Nowe”.
  const [foundBefore] = useState(alreadyFound);
  // Wyróżnienie easter egga to osiągnięcie (D-111): serwer przyznaje je przy zapisie bloku, profil pokazuje je na stałe.
  const badgeText = badge ? `${foundBefore ? 'Osiągnięcie' : 'Nowe osiągnięcie'}: ${badge.label}` : '';

  useEffect(() => {
    if (reducedMotion) return undefined;
    const timers = items.map((_, index) => window.setTimeout(() => setAppeared((count) => Math.max(count, index + 1)), index * STAGGER_MS));
    timers.push(window.setTimeout(() => setBlink(false), BLINK_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Jednorazowo przy otwarciu (nowy przedmiot = nowy komponent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fokus na krzyżyk górnego okienka (nowe wyskakuje na wierzch; po zamknięciu - następne), po wszystkich - na „Wróć”.
  useEffect(() => {
    const target = finished
      ? rootRef.current?.querySelector<HTMLElement>('[data-testid="easter-outro"] button')
      : top !== null
        ? rootRef.current?.querySelector<HTMLElement>(`[data-popup-index="${top}"] [data-popup-close]`)
        : null;
    target?.focus();
  }, [top, finished]);

  const foundOnce = useRef(false);
  useEffect(() => {
    if (!finished || foundOnce.current) return;
    foundOnce.current = true;
    onFound();
    // onFound - jednorazowo przy zamknięciu ostatniego okienka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function close(index: number) {
    setClosed((list) => (list.includes(index) ? list : [...list, index]));
  }

  useImperativeHandle(ref, () => ({
    closeTop: () => {
      if (top === null) return false;
      close(top);
      return true;
    },
    pending: () => !finished,
  }));

  // Na ekranie monitora (D-116): okno, które nie mieści się w wysokości ekranu od swojego miejsca w kaskadzie, jest zmniejszane
  // (skala od lewego górnego rogu) - nic nie wystaje poza ekran. Przeliczane przy każdym pojawieniu się okna i zmianie rozmiaru.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!onScreen || !root) return undefined;
    const fit = () => {
      const box = root.getBoundingClientRect();
      // offset* nie uwzględniają transformu (skali), więc pomiar nie zależy od poprzedniego --fit.
      for (const popup of root.querySelectorAll<HTMLElement>('[data-testid="easter-popup"]')) {
        const top = popup.offsetTop;
        const left = popup.offsetLeft;
        // Zapas na obrót okienka (±3°: róg wychodzi o ok. szerokość × sin 3° ≈ 5% szerokości) i obramowanie.
        const margin = 6 + popup.offsetWidth * 0.06;
        const room = Math.min((box.height - top - margin) / popup.offsetHeight, (box.width - left - margin) / popup.offsetWidth);
        popup.style.setProperty('--fit', String(Math.max(0.3, Math.min(1, room))));
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    // Także same okienka: ich wysokość zmienia się np. po wczytaniu fontu.
    root.querySelectorAll<HTMLElement>('[data-testid="easter-popup"]').forEach((popup) => observer.observe(popup));
    return () => observer.disconnect();
  }, [onScreen, appeared, closed]);

  return (
    // .easter-popups (globals.css): kontener zapytań - pozycje kaskady i odstępy w okienku zależą od wysokości nakładki (telefon w poziomie).
    // Na ekranie monitora (D-116) kontenerem jest prostokąt ekranu i ucina wszystko poza nim.
    <div
      ref={rootRef}
      data-testid="easter-popups"
      data-on-screen={onScreen ? '' : undefined}
      className={`easter-popups pointer-events-none absolute inset-0 ${onScreen ? 'easter-popups--screen [overflow:clip]' : ''}`}
    >
      {blink && <div aria-hidden="true" className="popup-blink absolute inset-0 bg-white" />}
      {items.map((item, index) =>
        index < appeared && !closed.includes(index) ? (
          <Popup key={index} item={item} index={index} reducedMotion={reducedMotion} onScreen={onScreen} onClose={() => close(index)} />
        ) : null,
      )}
      {/* Stały region live (od montowania): czytnik ogłasza WYPEŁNIENIE regionu, nie region wstawiony razem z treścią - outro i
          wyróżnienie dochodzą do czytnika, choć fokus od razu przechodzi na przycisk. */}
      <p role="status" className="sr-only">
        {finished ? `${outro}${badge ? ` ${badgeText}` : ''}` : ''}
      </p>
      {finished && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center p-3">
          <div
            data-testid="easter-outro"
            // Na ekranie monitora (D-116) karta w granicach ekranu: max 92% jego szerokości i wysokości (przewijana treść), bez 448 px z sm:.
            className={`flex flex-col items-center gap-3 rounded-card bg-surface p-5 text-center text-[15px] text-ink shadow-card ${
              onScreen ? 'max-h-[92%] max-w-[92%] overflow-y-auto' : 'max-w-[88%] sm:max-w-md'
            }`}
          >
            <p aria-hidden="true">{outro}</p>
            {badge && (
              <p aria-hidden="true" data-testid="easter-badge" className="inline-flex items-center gap-2 font-bold text-accent-ink">
                <Award className="h-5 w-5 shrink-0" />
                {badgeText}
              </p>
            )}
            <button
              type="button"
              onClick={onDone}
              className="min-h-[44px] rounded-btn bg-ink px-5 font-bold text-white hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {backLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default PopupsEasterEgg;

function Popup({ item, index, reducedMotion, onScreen, onClose }: { item: PopupItem; index: number; reducedMotion: boolean; onScreen: boolean; onClose: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  const [dodges, setDodges] = useState(0);
  const [shakes, setShakes] = useState(0);
  const [left, setLeft] = useState(item.countdown ? countdownSeconds(item.countdown) : 0);

  useEffect(() => {
    if (!item.countdown) return undefined;
    const timer = window.setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [item.countdown]);

  // Ucieka tylko przed myszą (na dotyku nie ma „najechania” - przycisk musi dać się nacisnąć), maks. 2 razy, bez reduced-motion.
  function dodge(event: PointerEvent<HTMLButtonElement>) {
    if (item.behavior !== 'dodge' || reducedMotion || event.pointerType !== 'mouse') return;
    setDodges((count) => Math.min(MAX_DODGES, count + 1));
  }
  const offset = dodges > 0 ? DODGE_OFFSETS[(dodges - 1) % DODGE_OFFSETS.length] : { x: 0, y: 0 };

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="easter-popup"
      data-popup-index={index}
      className={`easter-popup pointer-events-auto absolute ${onScreen ? 'w-[min(60%,300px)] origin-top-left' : 'w-[min(80%,300px)]'}`}
      // Na ekranie (D-116) także skala dopasowania (--fit, liczona w PopupsEasterEgg); bez ekranu --fit nie jest ustawiane (1).
      style={{ '--i': index, transform: `rotate(${TILTS[index % TILTS.length]}deg) scale(var(--fit, 1))`, zIndex: 10 + index } as CSSProperties}
    >
      {/* Drgnięcie na wewnętrznym elemencie (transform animacji nie nadpisuje obrotu okienka); `key` powtarza animację. */}
      <div
        key={shakes}
        data-testid="easter-popup-card"
        // Bez overflow-hidden: uciekający przycisk może wyjść poza okienko.
        className={`${reducedMotion ? '' : 'popup-in'} ${shakes > 0 && !reducedMotion ? 'popup-shake' : ''} rounded-2xl border-[3px] border-ink bg-surface text-ink shadow-[6px_6px_0_var(--ink)]`}
      >
        <div className="flex items-center gap-2 rounded-t-[13px] bg-accent py-1 pl-3 pr-1 text-white">
          <h2 id={titleId} className="min-w-0 flex-1 text-[17px] font-extrabold leading-tight">
            {item.title}
          </h2>
          <button
            type="button"
            data-popup-close
            aria-label={`Zamknij okienko: ${spokenTitle(item.title)}`}
            onClick={onClose}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-white bg-danger text-white hover:brightness-110 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-1 focus-visible:outline-white"
          >
            {/* Pole trafienia min. 44 px także po zmniejszeniu okienka na ekranie monitora (--fit < 1, D-116): niewidoczne, wokół krzyżyka. */}
            <span
              aria-hidden="true"
              data-hit
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ width: 'max(100%, calc(44px / var(--fit, 1)))', height: 'max(100%, calc(44px / var(--fit, 1)))' }}
            />
            <X aria-hidden="true" className="h-5 w-5" strokeWidth={3} />
          </button>
        </div>
        <div className="easter-popup-body flex flex-col items-center gap-3 px-4 py-4 text-center">
          <p id={bodyId} className="text-[15px] font-semibold">
            {item.body}
          </p>
          {item.countdown && (
            <p data-testid="easter-countdown" className="easter-popup-countdown rounded-lg bg-ink px-3 py-1 font-typewriter text-2xl font-bold tabular-nums text-highlight">
              {/* Tyka co sekundę - czytnik dostaje stały opis zamiast ogłaszać każdą zmianę. */}
              <span className="sr-only">Odliczanie od {item.countdown}</span>
              <span aria-hidden="true">{formatCountdown(left)}</span>
            </p>
          )}
          <button
            type="button"
            data-testid="easter-popup-action"
            onPointerEnter={dodge}
            onClick={() => setShakes((count) => count + 1)}
            className="min-h-[44px] rounded-full border-[3px] border-ink bg-highlight px-5 text-[15px] font-extrabold text-ink shadow-[3px_3px_0_var(--ink)] transition-transform duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
          >
            {item.button}
          </button>
        </div>
      </div>
    </div>
  );
}
