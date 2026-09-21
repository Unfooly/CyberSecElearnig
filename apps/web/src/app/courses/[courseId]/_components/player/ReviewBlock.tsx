import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';

// Podgląd JUŻ ukończonego bloku (przycisk "Wstecz"): tylko do odczytu, bez zmiany stanu na serwerze. Serwer i tak nie pozwala ponownie
// zapisać ukończonego bloku (sekwencyjność), więc podgląd pokazuje treść i wynik, nie formularz. Interaktywny podgląd bloków
// nieocenianych (hotspoty, dialog, zakładki, notatnik) dochodzi z ich komponentami.
export default function ReviewBlock({ block, result }: { block: ContentBlock; result?: ClientProgressBlock }) {
  const headline = block.title ?? block.prompt ?? 'Ukończony blok';

  return (
    <div data-testid="review-block">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
      <p className="mb-3 text-lg text-slate-900">{headline}</p>
      {block.prompt && block.title && <p className="mb-3 text-slate-700">{block.prompt}</p>}

      {result && result.correct !== undefined ? (
        <p className={`text-sm font-medium ${result.correct ? 'text-green-700' : 'text-red-700'}`}>
          {result.correct ? 'Twoja odpowiedź była poprawna.' : 'Twoja odpowiedź była niepoprawna.'}
          {typeof result.points === 'number' && result.points > 0 && result.points < 1 && ` Punkty: ${Math.round(result.points * 100)}%.`}
        </p>
      ) : (
        <p className="text-sm font-medium text-slate-700">Blok ukończony.</p>
      )}
      <p className="mt-2 text-xs text-slate-500">Ukończonego bloku nie można zmienić. Przejdź „Dalej”, aby wrócić do bieżącego miejsca.</p>
    </div>
  );
}
