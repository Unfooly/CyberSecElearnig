'use client';

import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import Mascot from '@/components/Mascot';

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
export default function MascotOverlay({ pose, text }: { pose?: string; text?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const bubbleId = useId();

  useEffect(() => {
    setCollapsed(false);
    if (!pose || !text) return undefined;
    const timer = setTimeout(() => setCollapsed(true), 8000);
    return () => clearTimeout(timer);
  }, [pose, text]);

  if (!pose) return null;

  return (
    <div
      data-testid="mascot-says"
      className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-start gap-3 sm:max-w-sm sm:gap-4"
    >
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={text ? 'Fooli - pokaż wiadomość' : 'Fooli'}
        aria-expanded={text ? !collapsed : undefined}
        aria-controls={text ? bubbleId : undefined}
        className="pointer-events-auto shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-600"
      >
        <Mascot pose={pose} size={128} className="h-[76px] w-[76px] sm:h-32 sm:w-32" />
      </button>
      {text && (
        <div
          id={bubbleId}
          className={`pointer-events-auto relative mt-2 min-w-0 max-w-[62ch] overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition-[max-height,opacity] duration-200 motion-reduce:transition-none sm:mt-5 ${
            collapsed ? 'pointer-events-none max-h-0 p-0 opacity-0' : 'max-h-[400px] px-4 py-3 opacity-100'
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
            tabIndex={collapsed ? -1 : undefined}
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
