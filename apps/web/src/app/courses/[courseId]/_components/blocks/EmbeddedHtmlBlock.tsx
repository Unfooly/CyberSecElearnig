'use client';

import type { ContentBlock } from '@/lib/courses-types';

/**
 * Jedyny typ bloku, który wykonuje dowolny, nieznany JS - stąd `sandbox`
 * BEZ `allow-same-origin`. Kombinacja `allow-scripts` + `allow-same-origin`
 * pozwoliłaby skryptowi w środku czytać ciasteczka/localStorage/DOM tej
 * aplikacji (efektywnie znosząc sandboxing) - bez `allow-same-origin`
 * iframe działa w unikalnym, nieprzezroczystym originie: skrypt może się
 * wykonać i rysować UI, ale nie ma dostępu do sesji ani danych aplikacji.
 * `allow-downloads` tylko dla ewentualnego "zapisz wynik" wewnątrz gry -
 * nieszkodliwe (zapis lokalnego pliku), nie rozszerza dostępu do originu.
 *
 * `srcDoc` (nie `src` z blobem/data: URL) trzyma treść w pamięci, nigdy nie
 * jest serwowana jako nawigowalny adres URL.
 *
 * Wynik/punktacja policzone WEWNĄTRZ tego dokumentu są czysto kosmetyczne -
 * backend nigdy się o nie nie pyta (postMessage stąd, gdyby się pojawił,
 * i tak byłby niezaufany - pochodziłby z kodu, którego ta apka nie
 * kontroluje). Ukończenie bloku = kliknięcie przycisku POZA iframe'em,
 * dokładnie jak VIDEO/DRAG_AND_DROP (SCOREABLE_BLOCK_TYPES po stronie
 * backendu nie obejmuje EMBEDDED_HTML).
 */
export default function EmbeddedHtmlBlock({
  block,
  onSubmit,
  disabled,
}: {
  block: ContentBlock;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        Interaktywna gra
      </p>
      <iframe
        srcDoc={block.html ?? ''}
        sandbox="allow-scripts allow-downloads"
        title="Interaktywny moduł szkoleniowy"
        className="mb-4 h-[640px] w-full rounded-lg border border-slate-200 bg-white"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit()}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Ukończyłem
      </button>
      <p className="mt-2 text-xs text-slate-400">
        Wynik w grze powyżej jest informacyjny - kliknij &quot;Ukończyłem&quot;, gdy skończysz.
      </p>
    </div>
  );
}
