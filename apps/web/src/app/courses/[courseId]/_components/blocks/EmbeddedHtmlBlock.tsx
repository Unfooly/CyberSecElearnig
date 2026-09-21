'use client';

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
 * pojawił, i tak byłby niezaufany). Ukończenie bloku = kliknięcie przycisku POZA iframe'em, jak VIDEO/DRAG_AND_DROP.
 */
export default function EmbeddedHtmlBlock({
  block,
  courseId,
  onSubmit,
  disabled,
  suspended = false,
}: {
  block: ContentBlock;
  courseId: string;
  onSubmit: () => void;
  disabled: boolean;
  suspended?: boolean;
}) {
  const src = block.id ? `/api/courses/${encodeURIComponent(courseId)}/blocks/${encodeURIComponent(block.id)}/embed` : null;

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        Interaktywna gra
      </p>
      {suspended ? null : src ? (
        <iframe
          src={src}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title="Interaktywny moduł szkoleniowy"
          className="mb-4 h-[640px] w-full rounded-lg border border-slate-200 bg-white"
        />
      ) : (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Nie można wyświetlić modułu: brak identyfikatora bloku.
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit()}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Ukończyłem
      </button>
      <p className="mt-2 text-xs text-slate-600">
        Wynik w grze powyżej jest informacyjny - kliknij &quot;Ukończyłem&quot;, gdy skończysz.
      </p>
    </div>
  );
}
