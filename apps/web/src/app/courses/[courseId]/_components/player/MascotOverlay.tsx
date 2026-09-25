'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import Mascot from '@/components/Mascot';
import { useAnyOverlayOpen } from './overlay-stack';

// Nakładka Fooli w lewym dolnym rogu obszaru bloku (feat/player-stage) - zastępuje dawny osobny wiersz NAD sceną w
// PlayerShell.tsx.
//
// Kod review PR #44 (a11y): dawna wersja chowała CAŁĄ nakładkę (ikonę + dymek RAZEM, jako jeden <button>) po 6 s
// albo kliknięciu - dymek znikał bezpowrotnie, a tekst leżał WEWNĄTRZ przycisku, więc czytnik ekranu odczytywał go
// jako etykietę przycisku, nie jako ogłoszenie. Teraz ikona i dymek to DWA oddzielne elementy:
//  - dymek to zwykły tekst w <p role="status" aria-live="polite"> (poza jakimkolwiek przyciskiem) - czytnik ekranu
//    ogłasza go jak żywy region za każdym nowym komunikatem;
//  - po 8 s dymek WIZUALNIE zwija się do samej ikony (max-height/opacity, NIE unmount/aria-hidden - zostaje w
//    drzewie dostępności, `mascot-says` z testId niżej trzyma testy z poprzedniej wersji);
//  - klik w ikonę rozwija dymek z powrotem; osobny mały X "Zwiń" zwija go ręcznie;
//  - zwinięcie NIE przenosi fokusu (inaczej niż NotesDrawer/TranscriptPanel - to nie modal, nie ma "powrotu");
//  - nowy komunikat (zmiana pose/text - CoursePlayer.tsx przekazuje `reaction ?? idleMascot`, więc każde zdarzenie
//    zmienia przynajmniej jedną z tych wartości) zawsze rozwija dymek od nowa i resetuje odliczanie 8 s;
//  - prefers-reduced-motion wyłącza animację zwijania (motion-reduce:transition-none, jak NotesDrawer/TranscriptPanel).
//
// Hotfix fix/mascot-overlap (dymek zasłaniał przyciski karty hotspotu "Dodaj do notatnika"/"Wróć"): PRZYCZYNA -
// karta hotspotu leży w z-30 WEWNĄTRZ własnego `isolate` (SceneHotspotsBlock.tsx) - `isolate` tworzy LOKALNY
// kontekst warstw, więc jej z-30 NIE jest w ogóle porównywane z z-index Fooli na zewnątrz tego kontekstu; z punktu
// widzenia reszty strony cała wyizolowana scena liczy się jako JEDNA warstwa bez własnego z-index (auto/0) - dymek
// Fooli (jawny z-index) malował się WYŻEJ niż ta warstwa, mimo że karta w środku deklaruje z-30. Dlatego samo
// "z-10 < z-30" nie wystarcza (patrz komentarz przy z-index niżej) - główną poprawką jest PEŁNE chowanie ikonki
// (nie tylko dymka) na czas otwartej JAKIEJKOLWIEK warstwy overlay-stack (karta hotspotu, notatnik, transkrypcja,
// nagroda kursu) - `useAnyOverlayOpen()`. Gdy którakolwiek jest otwarta: dymek zwija się natychmiast (bez animacji -
// nie może być momentu, w którym zasłania/łapie klik), a ikonka dostaje `invisible` (visibility:hidden - usuwa ją
// też z kolejności Tab i z drzewa dostępności, nie tylko z widoku - kod review, druga runda: samo opacity-0 nie
// wystarczało, klawiatura i czytnik ekranu wciąż mogły na nią trafić) + `aria-hidden`/`tabIndex=-1` jako dodatkowa,
// jawna warstwa. Po zamknięciu OSTATNIEJ warstwy ikonka wraca, ale dymek ZOSTAJE zwinięty - nie rozwija się sam
// (rozwija go tylko nowy pose/text albo klik w ikonę, patrz niżej).
export default function MascotOverlay({ pose, text }: { pose?: string; text?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const bubbleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const anyOverlayOpen = useAnyOverlayOpen();

  useEffect(() => {
    setCollapsed(false);
    if (!pose || !text) return undefined;
    const timer = setTimeout(() => setCollapsed(true), 8000);
    return () => clearTimeout(timer);
  }, [pose, text]);

  // Otwarcie JAKIEJKOLWIEK nakładki zwija dymek TRWALE (nie tylko wizualnie przez `bubbleVisible` niżej) - inaczej
  // po zamknięciu nakładki `collapsed` wróciłoby do swojej WCZEŚNIEJSZEJ wartości (np. false, jeśli overlay otworzył
  // się przed upływem 8 s), a dymek rozwinąłby się sam wbrew wymogowi "nie rozwija się ponownie sam". `bubbleVisible`
  // niżej i tak dodatkowo maskuje ten SAM render (efekt commit'uje dopiero PO nim) - to działa razem, nie zamiast.
  useEffect(() => {
    if (anyOverlayOpen) setCollapsed(true);
  }, [anyOverlayOpen]);

  // Pierwsza interakcja z BLOKIEM (klik w hotspot, fokus w polu klawiaturą, wybór w quizie/dialogu, ...) zwija
  // dymek od razu, bez czekania na 8 s - user, który już wchodzi w interakcję z treścią, nie potrzebuje podpowiedzi
  // na oczach. `pointerdown` (klik/dotyk) + `keydown` (klawiatura - Tab w pole, Enter/Spacja) + `change` (natywne
  // radio/checkbox/select) - CELOWO BEZ `focusin` (kod review, druga runda: prawdziwy regres): zmiana bloku i wiele
  // reakcji treści przenoszą fokus PROGRAMOWO (CoursePlayer.tsx - fokus na nagłówek nowego bloku po zmianie
  // displayedIndex/feedback; DialogueBlock.tsx, SceneHotspotsBlock.tsx, OrderingBlock.tsx, TabsBlock.tsx - fokus po
  // własnych zdarzeniach) - `element.focus()` wywołane z JS daje TRUSTED `focusin`, nierozróżnialne od fokusu
  // użytkownika, więc `focusin` zwijał dymek NATYCHMIAST po każdej zmianie bloku/reakcji, zanim user w ogóle go
  // zobaczył (wyścig z efektem NOWY POSE/TEXT wyżej - oba lecą w tym samym flushu, oba w tym samym komponencie
  // potomnym względem efektu CoursePlayer.tsx, więc `setCollapsed(true)` z focusin wygrywał). `keydown` NIE fatal
  // dla samego .focus() - odpala się WYŁĄCZNIE na prawdziwym naciśnięciu klawisza, więc Tab w pole (klawiatura)
  // nadal się liczy, a programowe przeniesienie fokusu bez klawisza - nie.
  // Nasłuch na document (capture) zamiast na konkretnym kontenerze bloku: MascotOverlay jest RODZEŃSTWEM treści
  // bloku (sibling w PlayerStage.tsx), nie jej rodzicem, więc nie ma własnego refa do "obszaru bloku" - jedyny
  // wyjątek to WŁASNE UI tej nakładki (klik w ikonę/X), świadomie wykluczone przez rootRef.contains poniżej, żeby
  // rozwinięcie dymku klikiem w ikonę nie zwijało go w tej samej klatce. Bez tablicy zależności z pose/text -
  // handler nie zależy od żadnego z nich (setCollapsed(true) jest bezwarunkowe i no-opem, gdy już zwinięty), więc
  // jeden nasłuch na cały czas życia komponentu wystarcza: kolejna interakcja po KAŻDYM nowym komunikacie (który
  // osobno rozwija dymek na nowo, efekt wyżej) zwinie go ponownie, dokładnie tak samo jak za pierwszym razem.
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

  if (!pose) return null;

  // Dymek: zwinięty (bez dymka) też, gdy JAKAKOLWIEK warstwa overlay-stack jest otwarta - NIE tylko `collapsed`
  // (broni przed wyścigiem klatek, gdyby oba stany zmieniły się w tym samym renderze inaczej niż zamierzone).
  const bubbleVisible = Boolean(text) && !collapsed && !anyOverlayOpen;

  return (
    <div
      ref={rootRef}
      data-testid="mascot-says"
      className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[30%] items-start gap-3 sm:gap-4"
    >
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={text ? 'Fooli - pokaż wiadomość' : 'Fooli'}
        aria-expanded={text ? !collapsed : undefined}
        aria-controls={text ? bubbleId : undefined}
        aria-hidden={anyOverlayOpen ? true : undefined}
        tabIndex={anyOverlayOpen ? -1 : undefined}
        // Gdy nakładka jest otwarta: `invisible` (visibility:hidden), NIE opacity-0 (kod review, druga runda) -
        // opacity nie wyjmuje elementu z kolejności Tab ani z drzewa dostępności, więc klawiatura mogła wciąż na
        // niego trafić (niewidoczny, ale "w grze") i czytnik ekranu wciąż go ogłaszał. `invisible` usuwa go z
        // obu na czas otwartej nakładki; `aria-hidden`/`tabIndex=-1` wyżej to dodatkowa, jawna warstwa (na wypadek
        // przeglądarek/AT, które i tak próbowałyby dotrzeć do elementu przez inną ścieżkę niż drzewo renderowania).
        // BEZ przejścia (żadnej klatki, w której ikonka jeszcze zasłania/łapie klik) - inaczej niż zwijanie dymku
        // (transition-[max-height,opacity] niżej), które MOŻE się animować, bo nigdy nie zasłania niczego poza sobą.
        className={`pointer-events-auto shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-600 ${
          anyOverlayOpen ? 'invisible pointer-events-none' : 'visible'
        }`}
      >
        <Mascot pose={pose} size={96} className="h-[76px] w-[76px] sm:h-24 sm:w-24" />
      </button>
      {text && (
        <div
          id={bubbleId}
          className={`pointer-events-auto relative mt-2 min-w-0 max-w-[280px] overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition-[max-height,opacity] duration-200 motion-reduce:transition-none sm:mt-5 ${
            bubbleVisible ? 'max-h-[400px] px-4 py-3 opacity-100' : 'pointer-events-none max-h-0 p-0 opacity-0'
          }`}
        >
          {/* Ogonek: obrócony kwadrat z obramowaniem tylko od strony maskotki, na wysokości jej głowy. */}
          <span
            aria-hidden="true"
            className="absolute -left-[7px] top-5 h-3.5 w-3.5 rotate-45 border-b border-l border-slate-200 bg-white sm:top-6"
          />
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Zwiń wiadomość maskotki"
            tabIndex={bubbleVisible ? undefined : -1}
            className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <p role="status" aria-live="polite" className="pr-6 text-sm leading-relaxed text-slate-800 sm:text-base">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
