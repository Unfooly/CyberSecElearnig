'use client';

import { useId } from 'react';
import { X } from 'lucide-react';
import Mascot from '@/components/Mascot';
import { useMascotCollapse } from './useMascotCollapse';

// Nakładka Fooli w lewym dolnym rogu obszaru bloku (feat/player-stage) - WYŁĄCZNIE SCENE_HOTSPOTS od
// fix/dialogue-polish (PlayerStage.tsx renderuje ją tylko dla contentLayout==='scene' - Fooli "stoi" na scenie, więc
// floating nakładka ma sens; wszędzie indziej to była zwykła nakładka na treść bloku, patrz MascotBanner.tsx i
// B-103). Stan zwijania/rozwijania (timer 8s, zwijanie na otwartą nakładkę/pierwszą interakcję z blokiem) jest we
// WSPÓLNYM hooku `useMascotCollapse` (dzielonym z MascotBanner.tsx) - ten plik zajmuje się WYŁĄCZNIE markupem
// floating nakładki, patrz useMascotCollapse.ts po wyjaśnienie samego zachowania.
//
// Kod review PR #44 (a11y): dymek to zwykły tekst w <p role="status" aria-live="polite"> (poza jakimkolwiek
// przyciskiem) - czytnik ekranu ogłasza go jak żywy region za każdym nowym komunikatem; ikona i dymek to DWA
// oddzielne elementy (dawna wersja chowała oba razem jako jeden <button>, tekst wewnątrz przycisku czytany jako
// jego etykieta, nie jako ogłoszenie). Klik w ikonę rozwija dymek z powrotem; osobny mały X "Zwiń" zwija go
// ręcznie; zwinięcie NIE przenosi fokusu (inaczej niż NotesDrawer/TranscriptPanel - to nie modal, nie ma "powrotu").
//
// Hotfix fix/mascot-overlap (dymek zasłaniał przyciski karty hotspotu "Dodaj do notatnika"/"Wróć"): PRZYCZYNA -
// karta hotspotu leży w z-30 WEWNĄTRZ własnego `isolate` (SceneHotspotsBlock.tsx) - `isolate` tworzy LOKALNY
// kontekst warstw, więc jej z-30 NIE jest w ogóle porównywane z z-index Fooli na zewnątrz tego kontekstu; z punktu
// widzenia reszty strony cała wyizolowana scena liczy się jako JEDNA warstwa bez własnego z-index (auto/0) - dymek
// Fooli (jawny z-index) malował się WYŻEJ niż ta warstwa, mimo że karta w środku deklaruje z-30. Dlatego samo
// "z-10 < z-30" nie wystarcza (patrz komentarz przy z-index niżej) - główną poprawką jest PEŁNE chowanie ikonki
// (nie tylko dymka) na czas otwartej JAKIEJKOLWIEK warstwy overlay-stack (karta hotspotu, notatnik, transkrypcja,
// nagroda kursu) - dymek zwija się natychmiast (bez animacji - nie może być momentu, w którym zasłania/łapie klik),
// a ikonka dostaje `invisible` (visibility:hidden - usuwa ją też z kolejności Tab i z drzewa dostępności, nie tylko
// z widoku - kod review, druga runda: samo opacity-0 nie wystarczało, klawiatura i czytnik ekranu wciąż mogły na
// nią trafić) + `aria-hidden`/`tabIndex=-1` jako dodatkowa, jawna warstwa. Po zamknięciu OSTATNIEJ warstwy ikonka
// wraca, ale dymek ZOSTAJE zwinięty - nie rozwija się sam.
export default function MascotOverlay({ pose, text }: { pose?: string; text?: string }) {
  const { collapsed, setCollapsed, bubbleVisible, rootRef, anyOverlayOpen } = useMascotCollapse({ pose, text });
  const bubbleId = useId();

  if (!pose) return null;

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
