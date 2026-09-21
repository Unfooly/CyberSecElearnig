// Wspólna stopka bloków eksploracyjnych (hotspoty, dialog, zakładki): licznik wymaganych elementów i przycisk ukończenia bloku.
// W podglądzie ("Wstecz") przycisku nie ma: blok jest już ukończony, a ponowne przejście nie ma skutku na serwerze.
export default function ExploreFooter({
  done,
  total,
  noun,
  verb = 'Obejrzano',
  readyText = 'Wszystko obejrzane.',
  onSubmit,
  disabled,
  review,
}: {
  done: number;
  total: number;
  /** Rzeczownik w dopełniaczu liczby mnogiej, np. "elementów". */
  noun: string;
  /** Czasownik licznika: "Obejrzano 1 z 3 elementów" (dialog: "Zadano 1 z 2 pytań"). */
  verb?: string;
  /** Tekst po spełnieniu wymagań (dialog: "Wszystkie wymagane pytania zadane."). */
  readyText?: string;
  onSubmit: () => void;
  disabled: boolean;
  review: boolean;
}) {
  if (review) {
    return <p className="mt-4 text-xs text-slate-500">Podgląd ukończonego bloku: możesz przejrzeć go ponownie, nic się nie zapisuje.</p>;
  }
  const ready = done >= total;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSubmit}
        disabled={!ready || disabled}
        className="min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Kontynuuj
      </button>
      <p className="text-sm text-slate-600" aria-live="polite">
        {ready ? readyText : `${verb} ${done} z ${total} ${noun}.`}
      </p>
    </div>
  );
}
