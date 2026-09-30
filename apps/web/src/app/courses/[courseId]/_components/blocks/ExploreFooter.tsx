// Wspólny licznik postępu bloków eksploracyjnych (hotspoty, dialog, zakładki): tylko tekst, żaden przycisk. Ukończenie (wymagane
// elementy pokryte) aktywuje "Dalej" w PASKU NAWIGACJI powłoki (CoursePlayer: onReady/canForward) - nie ma tu osobnego "Kontynuuj",
// żeby przejście do kolejnego bloku nie wymagało dwóch kliknięć (raport z pierwszego przejścia modułu 1). W podglądzie ("Wstecz")
// nawet licznika nie pokazujemy: blok jest już ukończony, ponowne przejście nie ma skutku na serwerze.
type ExploreFooterProps = {
  done: number;
  total: number;
  /** Czasownik licznika: "Obejrzano 1 z 3 elementów" (dialog ma własny `format`: „Wymagane pytania: 1/2”, D-130). */
  verb?: string;
  /** Tekst po spełnieniu wymagań (dialog: "Wszystkie wymagane pytania zadane."). */
  readyText?: string;
  review: boolean;
  /** Nadpisuje domyślne klasy, w OBU gałęziach - review i "gotowe" (SceneHotspotsBlock: mniejszy licznik NAD obrazem,
      nie stopka pod nim, niezależnie od tego, czy blok jest w podglądzie). Bez override każda gałąź ma swój dawny
      domyślny styl (inny rozmiar/kolor niż druga) - żeby nie zmieniać wyglądu pozostałych wywołujących. */
  className?: string;
} & (
  | {
      /** Rzeczownik w dopełniaczu liczby mnogiej, np. "elementów" - licznik „<verb> X z Y <noun>.”. */
      noun: string;
      format?: undefined;
    }
  | {
      /** Własny tekst licznika (rozmowa, D-130: „Wymagane pytania: X/Y”). */
      format: (done: number, total: number) => string;
      noun?: undefined;
    }
);

export default function ExploreFooter({ done, total, noun, verb = 'Obejrzano', readyText = 'Wszystko obejrzane.', review, className, format }: ExploreFooterProps) {
  if (review) {
    return <p className={className ?? 'mt-4 text-xs text-slate-500'}>Podgląd ukończonego bloku: możesz przejrzeć go ponownie, nic się nie zapisuje.</p>;
  }
  const ready = done >= total;
  return (
    <p className={className ?? 'mt-4 text-sm text-slate-600'} aria-live="polite">
      {ready ? readyText : format ? format(done, total) : `${verb} ${done} z ${total} ${noun}.`}
    </p>
  );
}
