'use client';

import { useEffect, useRef, useState } from 'react';
import { useAnyOverlayOpen } from './overlay-stack';

// Stan zwijania/rozwijania dymku Fooli - wydzielony z MascotOverlay.tsx (fix/dialogue-polish) do współdzielenia z
// MascotBanner.tsx (pasek na górze panelu bloku, poza SCENE_HOTSPOTS), żeby DWIE różne prezentacje (floating
// nakładka na scenie vs. pasek w normalnym przepływie gdzie indziej) dzieliły JEDNĄ logikę zwijania, zamiast ją
// duplikować. Timer 8s i nasłuch pierwszej interakcji (kod review PR #44 + hotfix fix/mascot-overlap) to CZYSTA
// mechaniczna ekstrakcja, zachowanie 1:1 - `MascotOverlay.test.tsx` (już istniejący, sprzed tego PR-a) przechodzi
// bez ŻADNEJ zmiany oczekiwań. Efekt reagujący na `anyOverlayOpen` NIE jest 1:1 - dostał NOWY guard (`wasOverlayOpenRef`
// niżej, D-080), bo to renderowanie WARUNKOWE po `contentLayout` (nie jedna, trwała instancja na cały odtwarzacz jak
// dawny MascotOverlay.tsx) ujawniło realną regresję: patrz komentarz przy `wasOverlayOpenRef` niżej.
//
// Nowy komunikat (zmiana pose/text - CoursePlayer.tsx przekazuje `reaction ?? idleMascot`, więc każde zdarzenie
// zmienia przynajmniej jedną z tych wartości) zawsze rozwija dymek od nowa i resetuje odliczanie 8 s. Po 8 s dymek
// zwija się sam (WIZUALNIE, nie unmount - `bubbleVisible` niżej, wywołujący komponent decyduje, jak to pokazać -
// nadal w drzewie dostępności, żeby czytnik ekranu, który już zaczął czytać, nie stracił treści w połowie).
//
// Otwarcie JAKIEJKOLWIEK nakładki (overlay-stack) zwija dymek TRWALE (nie tylko wizualnie przez `bubbleVisible`) -
// inaczej po zamknięciu nakładki `collapsed` wróciłoby do swojej WCZEŚNIEJSZEJ wartości (np. false, jeśli overlay
// otworzył się przed upływem 8 s), a dymek rozwinąłby się sam wbrew wymogowi "nie rozwija się ponownie sam".
// `bubbleVisible` i tak dodatkowo maskuje ten SAM render (efekt commit'uje dopiero PO nim) - to działa razem, nie
// zamiast.
//
// Pierwsza interakcja z BLOKIEM (klik, fokus klawiaturą, wybór w quizie/dialogu, ...) zwija dymek od razu, bez
// czekania na 8 s - user, który już wchodzi w interakcję z treścią, nie potrzebuje podpowiedzi na oczach.
// `pointerdown` (klik/dotyk) + `keydown` (klawiatura) + `change` (natywne radio/checkbox/select) - CELOWO BEZ
// `focusin` (kod review, druga runda: prawdziwy regres - programowe przeniesienie fokusu po zmianie bloku dawało
// TRUSTED `focusin`, nierozróżnialne od fokusu użytkownika, i zwijało dymek natychmiast po każdej zmianie bloku,
// zanim user w ogóle go zobaczył). Nasłuch na document (capture) - wywołujący komponent jest RODZEŃSTWEM/przodkiem
// treści bloku, nie jej rodzicem, więc `rootRef` (WŁASNE UI komponentu - klik w ikonę/X) jest jedynym wyjątkiem,
// świadomie wykluczonym przez `rootRef.contains`, żeby rozwinięcie dymku klikiem w ikonę nie zwijało go w tej samej
// klatce.
export function useMascotCollapse({ pose, text }: { pose?: string; text?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anyOverlayOpen = useAnyOverlayOpen();
  // Reaguje na PRZEJŚCIE closed->open, NIE na samą wartość `anyOverlayOpen=true` widzianą przy montowaniu (kod
  // review, fix/dialogue-polish - regresja znaleziona przy przenoszeniu Fooli z jedynej, trwałej instancji
  // MascotOverlay na wymienne MascotOverlay/MascotBanner po contentLayout): overlay-stack to WSPÓLNY rejestr,
  // aktualizowany przez `unregister()` w efekcie odmontowania. Gdy blok zmienia się w TYM SAMYM commit'cie, w
  // którym stara scena (z wciąż zarejestrowaną, otwartą kartą hotspotu - np. po kliknięciu "Dodaj do notatnika",
  // które NIE zamyka karty) odmontowuje się, a nowy blok montuje SWÓJ, ŚWIEŻY Fooli - ten świeży komponent RENDERUJE
  // SIĘ z domknięciem sprzed commitu, więc na WŁASNYM pierwszym renderze widzi jeszcze `anyOverlayOpen=true` z
  // NIEPOWIĄZANEJ karty, która go w ogóle nie dotyczy (React w React 18 uruchamia WSZYSTKIE cleanupy usuwanego
  // poddrzewa przed WSZYSTKIMI nowymi efektami tego samego commitu, więc kolejność efektów nie jest tu problemem -
  // problemem jest to, że render, z którego POCHODZI wartość domknięta w tym efekcie, zdarzył się PRZED tym
  // commitem). Naiwne "pomiń pierwsze wywołanie efektu" (poprzednia wersja) łamało się pod React.StrictMode (dev) -
  // podwójne mount/cleanup/mount symuluje montowanie DWA razy, ale `useRef` PRZETRWAŁ obie symulacje, więc drugie
  // "pierwsze" wywołanie już nie było pierwsze i regresja wracała dokładnie w środowisku, w którym miała być
  // złapana. Zamiast tego porównujemy z POPRZEDNIO zaobserwowaną wartością: tylko prawdziwe przejście false->true
  // (nakładka faktycznie OTWIERA SIĘ, obserwowane przez TEN komponent) zwija na trwałe - wartość `true` widziana
  // od razu przy montowaniu (bez wcześniejszego `false` do porównania) NIE zwija. Świadomy kompromis (udokumentowany
  // też w D-080): komponent zamontowany, gdy notatnik/transkrypcja są JUŻ otwarte, może rozwinąć dymek sam po ich
  // zamknięciu (nie ma testowanego wymogu, że nie powinien) - w przeciwieństwie do "nakładka otwiera się PO
  // zamontowaniu", co ten efekt nadal poprawnie łapie, patrz MascotOverlay.test.tsx/MascotBanner.test.tsx.
  const wasOverlayOpenRef = useRef(anyOverlayOpen);

  useEffect(() => {
    setCollapsed(false);
    if (!pose || !text) return undefined;
    const timer = setTimeout(() => setCollapsed(true), 8000);
    return () => clearTimeout(timer);
  }, [pose, text]);

  useEffect(() => {
    if (anyOverlayOpen && !wasOverlayOpenRef.current) setCollapsed(true);
    wasOverlayOpenRef.current = anyOverlayOpen;
  }, [anyOverlayOpen]);

  useEffect(() => {
    function handleInteraction(event: Event) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setCollapsed(true);
    }
    document.addEventListener('pointerdown', handleInteraction, true);
    document.addEventListener('keydown', handleInteraction, true);
    document.addEventListener('change', handleInteraction, true);
    return () => {
      document.removeEventListener('pointerdown', handleInteraction, true);
      document.removeEventListener('keydown', handleInteraction, true);
      document.removeEventListener('change', handleInteraction, true);
    };
  }, []);

  // Dymek: zwinięty (bez dymka) też, gdy JAKAKOLWIEK warstwa overlay-stack jest otwarta - NIE tylko `collapsed`
  // (broni przed wyścigiem klatek, gdyby oba stany zmieniły się w tym samym renderze inaczej niż zamierzone).
  const bubbleVisible = Boolean(text) && !collapsed && !anyOverlayOpen;

  return { collapsed, setCollapsed, bubbleVisible, rootRef, anyOverlayOpen };
}
