'use client';

import { useEffect, useState } from 'react';
import MascotSays from '@/components/MascotSays';

// Nakładka Fooli w lewym dolnym rogu obszaru bloku (feat/player-stage) - zastępuje dawny osobny wiersz NAD sceną w
// PlayerShell.tsx. Znika po 6 s albo kliknięciu, wraca przy KOLEJNYM komunikacie (efekt resetuje `dismissed` przy
// każdej zmianie pose/text - CoursePlayer.tsx przekazuje `reaction ?? idleMascot`, więc nowe zdarzenie zawsze
// zmienia przynajmniej jedną z tych wartości). Owinięte w <button> zamiast osobnego "X": MascotSays nie ma
// zagnieżdżonych elementów interaktywnych (sam obrazek + tekst dymka), więc to bezpieczne, a aria-label nadpisuje
// nazwę dostępną, żeby czytnik ekranu nie odczytał całej treści dymka jako "etykiety przycisku".
export default function MascotOverlay({ pose, text }: { pose?: string; text?: string }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (!pose) return undefined;
    const timer = setTimeout(() => setDismissed(true), 6000);
    return () => clearTimeout(timer);
  }, [pose, text]);

  if (!pose || dismissed) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] sm:max-w-sm">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Zamknij wiadomość maskotki"
        className="pointer-events-auto block rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-indigo-600"
      >
        <MascotSays pose={pose} text={text} />
      </button>
    </div>
  );
}
