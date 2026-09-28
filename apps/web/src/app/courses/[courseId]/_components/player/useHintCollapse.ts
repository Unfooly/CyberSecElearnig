'use client';

import { useEffect, useRef, useState } from 'react';
import { useAnyOverlayOpen } from './overlay-stack';

// Stan zwijania dymku podpowiedzi (D-093; zachowanie przeniesione z dawnego useMascotCollapse - D-080, kod review PR #44,
// fix/mascot-overlap - z jedną zmianą: interakcja to `click`, nie `pointerdown`, patrz niżej), wspólny dla dwóch prezentacji: nakładki na scenie i paska nad treścią bloku (player/Hint.tsx).
//
// - Nowy tekst zawsze rozwija dymek od nowa i resetuje odliczanie 8 s; po 8 s dymek zwija się WIZUALNIE (zostaje w drzewie
//   dostępności - czytnik, który zaczął czytać, nie traci treści).
// - Otwarcie JAKIEJKOLWIEK nakładki (overlay-stack) zwija dymek trwale. Reagujemy wyłącznie na PRZEJŚCIE zamknięta -> otwarta, nie na
//   `true` widziane przy montowaniu (nowy blok montuje się w tym samym commicie, w którym poprzednia scena odrejestrowuje swoją
//   nakładkę - render widzi jeszcze nieaktualne `true`; D-080).
// - Pierwsza interakcja z blokiem (click/keydown/input na document, capture) zwija dymek od razu. Bez `focusin`: programowe
//   przeniesienie fokusu po zmianie bloku jest nierozróżnialne od fokusu użytkownika i zwijałoby dymek, zanim ktoś go zobaczy.
//   `click`, nie `pointerdown` (D-093): pasek podpowiedzi jest w przepływie, więc jego zwinięcie przesuwa treść w górę - przy
//   `pointerdown` działo się to PRZED `click` i dotyk na telefonie trafiał obok przycisku (np. „Zakończ szkolenie”). Przy `click`
//   cel jest już ustalony, a przesunięcie następuje po nim. `input`, nie `change` (D-099): `change` pola tekstowego przychodzi przy
//   jego blur, czyli w chwili wciśnięcia przycisku obok („Sprawdź”) - dymek zwijał się między wciśnięciem a puszczeniem i dotyk
//   na telefonie (dwulinijkowy dymek, 360 px) trafiał obok przycisku. `input` przychodzi już przy pisaniu (także select/checkbox).
//   Wyjątek: interakcja z WŁASNYM UI dymku (`rootRef` - przycisk rozwinięcia/zwinięcia).
export function useHintCollapse(text: string | undefined) {
  const [collapsed, setCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anyOverlayOpen = useAnyOverlayOpen();
  const wasOverlayOpenRef = useRef(anyOverlayOpen);

  useEffect(() => {
    setCollapsed(false);
    if (!text) return undefined;
    const timer = setTimeout(() => setCollapsed(true), 8000);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (anyOverlayOpen && !wasOverlayOpenRef.current) setCollapsed(true);
    wasOverlayOpenRef.current = anyOverlayOpen;
  }, [anyOverlayOpen]);

  useEffect(() => {
    function handleInteraction(event: Event) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setCollapsed(true);
    }
    document.addEventListener('click', handleInteraction, true);
    document.addEventListener('keydown', handleInteraction, true);
    document.addEventListener('input', handleInteraction, true);
    return () => {
      document.removeEventListener('click', handleInteraction, true);
      document.removeEventListener('keydown', handleInteraction, true);
      document.removeEventListener('input', handleInteraction, true);
    };
  }, []);

  // Zwinięty wizualnie także, gdy otwarta jest jakakolwiek nakładka (broni przed wyścigiem klatek z efektem wyżej).
  const bubbleVisible = Boolean(text) && !collapsed && !anyOverlayOpen;

  return { collapsed, setCollapsed, bubbleVisible, rootRef, anyOverlayOpen };
}
