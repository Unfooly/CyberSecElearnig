'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';

// Kaskada Escape w PlayerStage: LIFO wg kolejności OTWARCIA (Escape zamyka to, co zostało otwarte NAJPÓŹNIEJ), nie
// stały priorytet typu warstwy (kod review PR #44: stała kolejność potrafiła zamknąć niewidoczną warstwę pod spodem,
// zostawiając otwartą tę, na którą user faktycznie patrzy - np. karta hotspotu otwarta, potem notatnik NAD nią,
// Escape zamykał kartę pod tłem zamiast notatnika). Zamiast każdej warstwy z WŁASNYM
// document.addEventListener('keydown', ...) (konkurowałyby o to samo zdarzenie, bez gwarancji kolejności) - jeden
// rejestr: każda warstwa zgłasza swój stan (otwarta/zamknięta) i funkcję zamykającą, PlayerStage na Escape woła
// closeTop(), który zamyka WYŁĄCZNIE najpóźniej otwartą, wciąż otwartą warstwę.
//
// D-075: w prawdziwej przeglądarce, gdy dokument JEST w trybie pełnoekranowym, pierwszy Escape jest ZWYKLE
// przechwytywany przez samą przeglądarkę (natywne wyjście z fullscreena) - dzieje się to NIEZALEŻNIE od tego rejestru
// i zwykle PRZED tym, zanim strona w ogóle dostanie zdarzenie keydown w niezawodny, przenośny sposób (dokładne
// zachowanie zależy od przeglądarki). Efekt: kaskada LIFO, którą closeTop() implementuje poniżej, jest poprawna i
// przewidywalna WYŁĄCZNIE poza fullscreenem - w fullscreenie pierwszy Escape zwykle najpierw wychodzi z pełnego
// ekranu (obsługa przeglądarki, nie tego kodu), otwarta karta/panel zostają otwarte do kolejnego Escape. Świadomie
// tego nie obchodzimy (Keyboard Lock API działa tylko w Chromium i wymaga dodatkowych uprawnień/kontekstu) -
// 'fullscreen' to warstwa jak każda inna w LIFO (dotyczy ścieżek innych niż "Escape w trakcie fullscreena", np.
// programowe wywołanie closeTop()), nie zmienia natywnego zachowania przeglądarki.
// 'reward' USUNIĘTE (fix/course-finish-flow): CourseRewardModal.tsx (jedyny konsument tej warstwy) skasowany -
// karta nagrody na SummaryScreen (RewardCard.tsx) jest zwykłą treścią ekranu, nie nakładką overlay-stack.
export type OverlayLayer = 'hotspotCard' | 'transcript' | 'notebook' | 'fullscreen';

interface OverlayEntry {
  isOpen: boolean;
  onClose: () => void;
}

interface OverlayStackContextValue {
  register: (layer: OverlayLayer, entry: OverlayEntry) => void;
  unregister: (layer: OverlayLayer) => void;
  /** Zamyka najpóźniej otwartą, wciąż otwartą warstwę (LIFO); zwraca true, jeśli coś zamknęła. */
  closeTop: () => boolean;
}

const OverlayStackContext = createContext<OverlayStackContextValue | null>(null);

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<OverlayLayer, OverlayEntry>());
  // Stos LIFO id-ów otwartych warstw, w kolejności otwarcia (ostatni = na wierzchu, jego Escape zamyka jako
  // pierwszy). Osobno od `entries`, bo `entries` trzyma AKTUALNY stan/onClose każdej warstwy (nadpisywany przy
  // każdej zmianie), a `order` pamięta TYLKO kolejność przejść zamknięta->otwarta.
  const order = useRef<OverlayLayer[]>([]);

  const register = useCallback((layer: OverlayLayer, entry: OverlayEntry) => {
    entries.current.set(layer, entry);
    const index = order.current.indexOf(layer);
    if (entry.isOpen) {
      if (index === -1) order.current.push(layer);
    } else if (index !== -1) {
      order.current.splice(index, 1);
    }
  }, []);
  const unregister = useCallback((layer: OverlayLayer) => {
    entries.current.delete(layer);
    const index = order.current.indexOf(layer);
    if (index !== -1) order.current.splice(index, 1);
  }, []);
  const closeTop = useCallback(() => {
    const layer = order.current[order.current.length - 1];
    if (!layer) return false;
    const entry = entries.current.get(layer);
    // Zdejmujemy ze stosu OD RAZU (synchronicznie), nie czekamy na re-render/efekt po onClose() - closeTop() ma
    // wołać dokładnie jedną warstwę na jedno wywołanie, nawet gdyby coś (błąd w onClose, kolejne zdarzenie) sprawiło,
    // że closeTop() wywoła się ponownie zanim React zdąży przeliczyć stan.
    order.current.pop();
    entry?.onClose();
    return true;
  }, []);

  const value = useMemo(() => ({ register, unregister, closeTop }), [register, unregister, closeTop]);
  return <OverlayStackContext.Provider value={value}>{children}</OverlayStackContext.Provider>;
}

/** Rejestruje warstwę na czas, gdy komponent jest zamontowany; stan/onClose aktualizuje się przy każdej zmianie. */
export function useOverlayLayer(layer: OverlayLayer, isOpen: boolean, onClose: () => void): void {
  const ctx = useContext(OverlayStackContext);
  // onClose w REFIE (kod review PR #44, druga runda - pierwsza wersja tego hooka miała onClose W DEPS, co samo w
  // sobie było błędem): większość wołających przekazuje inline funkcję (CoursePlayer.tsx `onToggleNotes`,
  // useNarrationBar.ts `toggleTranscript`, ...) - nowa tożsamość przy KAŻDYM renderze rodzica, niezwiązanym z tą
  // warstwą (np. `positionMs` narracji aktualizuje się kilka razy na sekundę).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Rejestracja na KAŻDYM renderze, BEZ tablicy zależności - celowo NIE ograniczona do zmiany `isOpen` (druga runda
  // kod review PR #44: SceneHotspotsBlock.tsx ma kartę z zagnieżdżoną sceną, gdzie `goBack()` zdejmuje TYLKO JEDEN
  // poziom - `isOpen` tej warstwy, activeId !== null, zostaje `true` przez CAŁY czas trwania obu poziomów. Efekt
  // ograniczony do `[ctx, layer, isOpen]` nigdy by się nie przeliczył po pierwszym Escape - warstwę zdjętą ze stosu
  // `order` EAGERLY przez closeTop() (patrz niżej) nic by tam nie zwróciło, więc drugi Escape nic by już nie
  // zamykał). `register()` w tym pliku jest IDEMPOTENTNY względem BIEŻĄCEGO stanu `order` - dotyka go WYŁĄCZNIE przy
  // prawdziwym przejściu nieobecna<->obecna (porównanie z tym, co już tam jest, nie z poprzednim wywołaniem tego
  // efektu), więc wołanie go na każdym renderze NIE reshuffle'uje kolejności LIFO przy niepowiązanym re-renderze
  // (ten sam scenariusz, który miał naprawić ref wyżej) - a JEDNOCZEŚNIE poprawnie PRZYWRACA na stos warstwę, która
  // po eager pop w closeTop() okazuje się wciąż otwarta (przypadek zagnieżdżonej karty).
  useEffect(() => {
    if (!ctx) return;
    ctx.register(layer, { isOpen, onClose: () => onCloseRef.current() });
  });

  // Odrębny efekt WYŁĄCZNIE na odmontowanie (stabilne deps - `layer` to literał typu OverlayLayer, w praktyce nigdy
  // się nie zmienia dla danego wywołania). Gdyby komponent zniknął z drzewa (np. zmiana bloku) bez przejścia przez
  // normalne zamknięcie, wpis i tak znika ze stosu/rejestru - efekt WYŻEJ (bez tablicy zależności) nie ma własnego
  // cleanup, więc to jedyne miejsce, które to gwarantuje.
  useEffect(() => {
    return () => {
      if (ctx) ctx.unregister(layer);
    };
  }, [ctx, layer]);
}

/** closeTop() poza komponentem-warstwą (np. PlayerStage na Escape) - no-op (false), gdy provider nie istnieje. */
export function useCloseTopOverlay(): () => boolean {
  const ctx = useContext(OverlayStackContext);
  return ctx?.closeTop ?? (() => false);
}
