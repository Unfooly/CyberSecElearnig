import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';
import ExploratoryBlock, { isExploratory } from '../blocks/ExploratoryBlock';
import ScoredBlock, { hasInlineResult, isScored } from '../blocks/ScoredBlock';

// Podgląd JUŻ ukończonego bloku (przycisk "Wstecz"): tylko do odczytu, bez zmiany stanu na serwerze. Serwer i tak nie pozwala ponownie
// zapisać ukończonego bloku (sekwencyjność). Bloki eksploracyjne (hotspoty, dialog, zakładki, notatnik, podsumowanie) można przejść
// ponownie interaktywnie (review: bez zapisu). Bloki oceniane pokazują WYBÓR GRACZA i wynik: mail i kolejność jak zaraz po zapisie (trafienia,
// wyjaśnienia; dane z serwera: answer i detail, id nieprzejrzyste), quiz i scenariusz wybraną opcję, zadanie tekstowe próby i rozwiązanie.
export default function ReviewBlock({
  block,
  result,
  contentBase,
  courseId,
}: {
  block: ContentBlock;
  result?: ClientProgressBlock;
  contentBase: string;
  courseId: string;
}) {
  if (isExploratory(block.type)) {
    return (
      <div data-testid="review-block">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
        <ExploratoryBlock block={block} contentBase={contentBase} onSubmit={() => {}} onReady={() => {}} disabled review />
      </div>
    );
  }

  if (isScored(block.type) && result && (block.type === 'TEXT_INPUT_GUIDED' || (hasInlineResult(block.type) && result.detail))) {
    return (
      <div data-testid="review-block">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
        <ScoredBlock
          block={block}
          courseId={courseId}
          progress={result}
          result={{ answer: result.answer, detail: result.detail, correct: result.correct, points: result.points, reaction: result.reaction }}
        />
        <p className="mt-2 text-xs text-slate-500">Ukończonego bloku nie można zmienić. Przejdź „Dalej”, aby wrócić do bieżącego miejsca.</p>
      </div>
    );
  }

  const headline = block.title ?? block.prompt ?? 'Ukończony blok';
  // Quiz i scenariusz: własny wybór (indeks opcji z serwera albo z tej sesji).
  const chosen = typeof result?.answer === 'number' ? block.options?.[result.answer]?.text : undefined;

  return (
    <div data-testid="review-block">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
      <p className="mb-3 text-lg text-slate-900">{headline}</p>
      {block.prompt && block.title && <p className="mb-3 text-slate-700">{block.prompt}</p>}
      {chosen && (
        <p className="mb-2 text-sm text-slate-800">
          Twoja odpowiedź: <span className="font-semibold">{chosen}</span>
        </p>
      )}

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
