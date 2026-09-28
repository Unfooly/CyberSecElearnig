'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';

/**
 * Jedyny typ bloku, który wykonuje dowolny, nieznany JS. Dokument bloku NIE idzie w treści modułu (`html` jest polem sekretnym): iframe ładuje
 * go z trasy `/api/courses/:id/blocks/:blockId/embed` (apps/web -> apps/api, tylko dla właściciela przypisania i bloku bieżącego lub
 * wcześniejszego) jako OSOBNY dokument z własnymi nagłówkami: restrykcyjne CSP (bez sieci, formularzy i zasobów spoza dokumentu), dyrektywa
 * `sandbox`, nosniff, no-store. Dlatego skrypty inline w tym dokumencie działają mimo CSP strony (iframe `srcdoc` dziedziczyłby jej politykę
 * i były blokowane), a strona nie musi poluzować własnego CSP.
 *
 * `sandbox="allow-scripts"` BEZ `allow-same-origin` (i bez allow-downloads, allow-forms, allow-popups): dokument ma nieprzezroczysty origin,
 * skrypt może się wykonać i rysować UI, ale nie widzi ciasteczek, localStorage ani DOM aplikacji. `referrerPolicy="no-referrer"`.
 *
 * Podczas podglądu "Wstecz" (`suspended`) iframe jest ODMONTOWANY, nie ukryty: skrypt bloku nie działa w tle (dźwięk, pętle), a po powrocie
 * ładuje się od nowa. Blok nie ma własnego stanu poza samym dokumentem (wynik w grze jest czysto informacyjny), więc nic nie ginie w powłoce.
 *
 * Wynik/punktacja policzone WEWNĄTRZ tego dokumentu są czysto kosmetyczne - backend nigdy się o nie nie pyta (postMessage stąd, gdyby się
 * pojawił, i tak byłby niezaufany). Ukończenie bloku = „Ukończyłem” POZA iframe'em (przełącznik): blok zgłasza gotowość, a zapis rusza
 * „Dalej” w dolnym pasku - jedyne przejście dalej (D-106), jak VIDEO/DRAG_AND_DROP.
 */
export default function EmbeddedHtmlBlock({
  block,
  courseId,
  onReady,
  disabled,
  suspended = false,
}: {
  block: ContentBlock;
  courseId: string;
  /** true = gracz oznaczył grę jako ukończoną - „Dalej” w pasku aktywny. */
  onReady: (ready: boolean) => void;
  disabled: boolean;
  suspended?: boolean;
}) {
  const src = block.id ? `/api/courses/${encodeURIComponent(courseId)}/blocks/${encodeURIComponent(block.id)}/embed` : null;
  const [finished, setFinished] = useState(false);
  const toggleFinished = () => {
    const next = !finished;
    setFinished(next);
    onReady(next);
  };

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        Interaktywna gra
      </p>
      {suspended ? null : src ? (
        // h-[min(70dvh,640px)] zamiast stałego h-[640px] (feat/player-stage): panel slajdu w ramce nie ma pełnej
        // wysokości viewportu jak dawny <main> strony, więc sztywne 640px potrafiłoby wystawać poza ramkę na
        // niskich ekranach (telefon w poziomie) - iframe skaluje się z dostępną wysokością, przewija się w środku.
        <iframe
          src={src}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title="Interaktywny moduł szkoleniowy"
          className="mb-4 h-[min(70dvh,640px)] w-full rounded-lg border border-slate-200 bg-white"
        />
      ) : (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Nie można wyświetlić modułu: brak identyfikatora bloku.
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-pressed={finished}
        onClick={toggleFinished}
        className={`min-h-[44px] rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${finished ? 'bg-accent' : 'bg-slate-900'}`}
      >
        {/* Stała nazwa przełącznika (stan mówi aria-pressed); znacznik tylko wizualny. */}
        Ukończyłem
        {finished && <span aria-hidden="true"> ✓</span>}
      </button>
      <p className="mt-2 text-xs text-slate-600">
        Wynik w grze powyżej jest informacyjny - kliknij &quot;Ukończyłem&quot;, gdy skończysz, a potem &quot;Dalej&quot; na dole.
      </p>
    </div>
  );
}
