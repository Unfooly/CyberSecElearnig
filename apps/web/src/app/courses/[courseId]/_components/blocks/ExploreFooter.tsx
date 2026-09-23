// Wspólny licznik postępu bloków eksploracyjnych (hotspoty, dialog, zakładki): tylko tekst, żaden przycisk. Ukończenie (wymagane
// elementy pokryte) aktywuje "Dalej" w PASKU NAWIGACJI powłoki (CoursePlayer: onReady/canForward) - nie ma tu osobnego "Kontynuuj",
// żeby przejście do kolejnego bloku nie wymagało dwóch kliknięć (raport z pierwszego przejścia modułu 1). W podglądzie ("Wstecz")
// nawet licznika nie pokazujemy: blok jest już ukończony, ponowne przejście nie ma skutku na serwerze.
export default function ExploreFooter({
  done,
  total,
  noun,
  verb = 'Obejrzano',
  readyText = 'Wszystko obejrzane.',
  review,
  className = 'mt-4 text-sm text-slate-600',
}: {
  done: number;
  total: number;
  /** Rzeczownik w dopełniaczu liczby mnogiej, np. "elementów". */
  noun: string;
  /** Czasownik licznika: "Obejrzano 1 z 3 elementów" (dialog: "Zadano 1 z 2 pytań"). */
  verb?: string;
  /** Tekst po spełnieniu wymagań (dialog: "Wszystkie wymagane pytania zadane."). */
  readyText?: string;
  review: boolean;
  /** Nadpisuje domyślne klasy (SceneHotspotsBlock: mniejszy licznik NAD obrazem, nie stopka pod nim). */
  className?: string;
}) {
  if (review) {
    return <p className="mt-4 text-xs text-slate-500">Podgląd ukończonego bloku: możesz przejrzeć go ponownie, nic się nie zapisuje.</p>;
  }
  const ready = done >= total;
  return (
    <p className={className} aria-live="polite">
      {ready ? readyText : `${verb} ${done} z ${total} ${noun}.`}
    </p>
  );
}
