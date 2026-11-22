import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';
import type { PlayerIdentity } from '@/lib/use-my-display-name';
import type { NotebookTask } from './notes';
import ExploratoryBlock, { isExploratory } from '../blocks/ExploratoryBlock';
import ScoredBlock, { BOARD_TYPES, hasInlineResult, isScored } from '../blocks/ScoredBlock';
import SwipeSortBlock from '../blocks/SwipeSortBlock';
import Illustrated from '../blocks/Illustrated';
import { OPTION, OptionFeedback, OptionMark, decidedMarks, optionTone } from '../blocks/simple-option';

// Podgląd JUŻ ukończonego bloku (przycisk "Wstecz"): tylko do odczytu, bez zmiany stanu na serwerze. Serwer i tak nie pozwala ponownie
// zapisać ukończonego bloku (sekwencyjność). Bloki eksploracyjne (hotspoty, dialog, zakładki, notatnik, podsumowanie) można przejść
// ponownie interaktywnie (review: bez zapisu). Bloki oceniane pokazują WYBÓR GRACZA i wynik: mail i kolejność jak zaraz po zapisie (trafienia,
// wyjaśnienia; dane z serwera: answer i detail, id nieprzejrzyste), quiz i scenariusz wybraną opcję, zadanie tekstowe próby i rozwiązanie.
export default function ReviewBlock({
  block,
  result,
  contentBase,
  courseId,
  myAvatarUrl = null,
  myInitials,
  tasks,
  identity,
  onBriefingStep,
  caseNo,
  moduleBlocks,
  simpleMode = false,
}: {
  /** Tryb prosty (D-132): pytanie quizu z rozstrzygnięciem (D-204 - jedna próba, zaznaczone i poprawne z oceną); bez prób - „Blok ukończony”. */
  simpleMode?: boolean;
  caseNo?: string;
  /** Bloki modułu (omówienie czyta transkrypcję z bloku nagrania). */
  moduleBlocks?: ContentBlock[];
  block: ContentBlock;
  result?: ClientProgressBlock;
  contentBase: string;
  courseId: string;
  myAvatarUrl?: string | null;
  myInitials?: string;
  tasks?: NotebookTask[];
  identity?: PlayerIdentity;
  onBriefingStep?: (index: number, byGesture: boolean) => void;
}) {
  if (isExploratory(block.type)) {
    // Łańcuch wysokości dla SCENE_HOTSPOTS/DIALOGUE (hotfix fix/player-scene-fit/B-100, druga runda code review;
    // DIALOGUE dołączony w fix/dialogue-sticky-questions - ten sam contentLayout='fill' co 'scene', ten sam powód):
    // ten div jest bezpośrednim dzieckiem flex-col wrappera PlayerStage.tsx w trybie "Wstecz" - bez własnych
    // flex-1/min-h-0/w-full byłby zwykłym blokowym divem, przerywającym łańcuch do SceneHotspotsBlock.tsx/
    // DialogueBlock.tsx (które mają flex-1 min-h-0 na WŁASNYM korzeniu obu). Pozostałe typy eksploracyjne
    // (NOTEPAD, TABS, NARRATIVE) mają contentLayout='slide' - klasy tu nic im nie zmieniają (rodzic nie jest
    // flex-col), ale i tak ograniczamy je do SCENE_HOTSPOTS/DIALOGUE, żeby diff dokładnie odzwierciedlał, co
    // faktycznie tego wymaga.
    // BRIEFING (D-081) i DOSSIER (D-083) też 'fill' - odprawa i teczka wypełniają ramkę jak rozmowa.
    const isFill =
      block.type === 'SCENE_HOTSPOTS' || block.type === 'DIALOGUE' || block.type === 'BRIEFING' || block.type === 'DOSSIER' || block.type === 'ANNOTATED_REPLAY';
    return (
      <div data-testid="review-block" className={isFill ? 'flex min-h-0 w-full flex-1 flex-col' : undefined}>
        <p className={`mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${isFill ? 'shrink-0' : ''}`}>Podgląd ukończonego bloku</p>
        {/* Ilustracja NARRATIVE (D-200) także w podglądzie - jak w bieżącym bloku. */}
        <Illustrated illustration={block.type === 'NARRATIVE' ? block.illustration : undefined} contentBase={contentBase}>
          <ExploratoryBlock
            block={block}
            contentBase={contentBase}
            onSubmit={() => {}}
            onReady={() => {}}
            disabled
            review
            myAvatarUrl={myAvatarUrl}
            myInitials={myInitials}
            tasks={tasks}
            identity={identity}
            onBriefingStep={onBriefingStep}
            moduleBlocks={moduleBlocks}
            simpleMode={simpleMode}
          />
        </Illustrated>
      </div>
    );
  }

  if (block.type === 'SWIPE_SORT') {
    // D-132: każda karta z własnym werdyktem i zdaniem (próby z postępu albo z tej sesji), bez wyniku.
    return (
      <div data-testid="review-block">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
        <SwipeSortBlock block={block} courseId={courseId} progress={result} review />
      </div>
    );
  }

  if (isScored(block.type) && result && (block.type === 'TEXT_INPUT_GUIDED' || (hasInlineResult(block.type) && result.detail))) {
    // Tablica śledcza (ORDERING, D-088) i odsłuch nagrania (D-115) wypełniają ramkę - ten sam łańcuch wysokości co bloki 'fill' wyżej.
    const isBoard = BOARD_TYPES.includes(block.type);
    return (
      <div data-testid="review-block" className={isBoard ? 'flex min-h-0 w-full flex-1 flex-col' : undefined}>
        <p className={`mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${isBoard ? 'shrink-0' : ''}`}>Podgląd ukończonego bloku</p>
        <ScoredBlock
          block={block}
          courseId={courseId}
          progress={result}
          result={{ answer: result.answer, detail: result.detail, correct: result.correct, points: result.points, reaction: result.reaction }}
          caseNo={caseNo}
          contentBase={contentBase}
        />
        <p className={`mt-2 text-xs text-slate-500 ${isBoard ? 'shrink-0' : ''}`}>Ukończonego bloku nie można zmienić. Przejdź „Dalej”, aby wrócić do bieżącego miejsca.</p>
      </div>
    );
  }

  if (simpleMode && block.type === 'QUIZ' && result?.checks && result.checks.length > 0) {
    // Pytanie quizu w trybie prostym (D-204): rozstrzygnięcie jak zaraz po „Sprawdź” - zaznaczone i poprawne z oceną i zdaniem (z postępu
    // albo z tej sesji; serwer pokazuje tylko pierwszą, rozstrzygającą próbę). Bez monitora - zwykły slajd podglądu.
    const decided = result.checks[0];
    const marks = decidedMarks(decided);
    const picked = Array.isArray(decided.item) ? decided.item : typeof decided.item === 'number' ? [decided.item] : [];
    return (
      <div data-testid="review-block">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
        <Illustrated illustration={block.illustration} contentBase={contentBase}>
          <div className="flex flex-col gap-2.5">
            <p className="text-lg font-bold text-slate-900">{block.prompt ?? block.title}</p>
            <ul className="flex flex-col gap-2.5">
              {(block.options ?? []).map((option, index) => {
                const mark = marks.get(index);
                return (
                  <li key={index} data-testid="review-option" data-result={mark?.result} className={`${OPTION} ${optionTone(mark?.result ?? null, true, picked.includes(index))}`}>
                    <OptionMark index={index} state={mark?.result ?? null} selected={picked.includes(index)} />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span>{option.text}</span>
                      {mark && <OptionFeedback mark={mark} testId="review-option-feedback" />}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className={`text-sm font-medium ${decided.result === 'good' ? 'text-green-700' : 'text-red-700'}`}>
              {decided.result === 'good' ? 'Odpowiedź była poprawna.' : 'Odpowiedź była niepoprawna - poprawne oznaczone znakiem ✓.'}
            </p>
            <p className="text-xs text-slate-500">Ukończonego bloku nie można zmienić. Przejdź „Dalej”, aby wrócić do bieżącego miejsca.</p>
          </div>
        </Illustrated>
      </div>
    );
  }

  const headline = block.title ?? block.prompt ?? 'Ukończony blok';
  // Quiz i scenariusz: własny wybór (indeks opcji z serwera albo z tej sesji).
  const chosen = typeof result?.answer === 'number' ? block.options?.[result.answer]?.text : undefined;

  return (
    <div data-testid="review-block">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Podgląd ukończonego bloku</p>
      <Illustrated illustration={block.type === 'QUIZ' ? block.illustration : undefined} contentBase={contentBase}>
        <div>
          <p className="mb-3 text-lg text-slate-900">{headline}</p>
          {block.prompt && block.title && <p className="mb-3 text-slate-700">{block.prompt}</p>}
          {chosen && (
            <p className="mb-2 text-sm text-slate-800">
              Twoja odpowiedź: <span className="font-semibold">{chosen}</span>
            </p>
          )}

          {result && result.correct !== undefined && !simpleMode ? (
            <p className={`text-sm font-medium ${result.correct ? 'text-green-700' : 'text-red-700'}`}>
              {result.correct ? 'Twoja odpowiedź była poprawna.' : 'Twoja odpowiedź była niepoprawna.'}
              {typeof result.points === 'number' && result.points > 0 && result.points < 1 && ` Punkty: ${Math.round(result.points * 100)}%.`}
            </p>
          ) : (
            <p className="text-sm font-medium text-slate-700">Blok ukończony.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">Ukończonego bloku nie można zmienić. Przejdź „Dalej”, aby wrócić do bieżącego miejsca.</p>
        </div>
      </Illustrated>
    </div>
  );
}
