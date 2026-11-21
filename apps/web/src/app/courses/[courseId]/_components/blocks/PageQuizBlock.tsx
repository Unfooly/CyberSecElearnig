'use client';

import { useEffect, useId, useState } from 'react';
import { urlDomainMarks } from '@cyberszkolo/content';
import type { ContentBlock, ContentReaction } from '@/lib/courses-types';
import BrowserWindow, { FakeLoginPage } from './BrowserWindow';
import AddressMarker from './AddressMarker';
import DesktopStage from '../player/DesktopStage';
import { useBarAction, useHasBarAction } from '../player/bar-action';
import { useHints } from '../player/hints';

// Pytanie na fałszywej stronie na pulpicie (QUIZ z `frame: 'monitor'`, D-190, uwaga właściciela 2026-11-21: pytanie Tak/Nie o link ma się
// pokazać po wpisaniu domeny „w tym samym widoku gdzie fałszywa strona”). Ten sam widok co zadanie z domeną (TextInputBlock z `page` i
// `background`): okno przeglądarki w ekranie monitora ze sceny, w pasku adres z zaznaczoną domeną (bez klikania - domena jest już znana),
// w pasku zadania pytanie z odpowiedziami, pod nim fałszywa strona logowania (obrazek, bez pól). Scena bez najazdu (`still`) - gracz
// przychodzi tu wprost z zadania z domeną, więc widok ma zostać w miejscu. Ocena wyłącznie na serwerze: klient wysyła indeks odpowiedzi.
// Wynik (`result`) zostaje na tej samej stronie: wybrana odpowiedź, werdykt i komentarz z treści. Podgląd „Wstecz” - zwykły slajd
// (ReviewBlock).

export interface PageQuizResult {
  /** Indeks wybranej odpowiedzi (z zapisanej odpowiedzi; starszy zapis może go nie mieć). */
  selected?: number;
  correct?: boolean;
  reaction?: ContentReaction;
}

export default function PageQuizBlock({
  block,
  contentBase,
  onSubmit,
  disabled = false,
  result,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit?: (answer: number) => void;
  disabled?: boolean;
  result?: PageQuizResult;
}) {
  const promptId = useId();
  const groupName = useId();
  const hints = useHints();
  const options = block.options ?? [];
  const readOnly = !!result;
  const [selected, setSelected] = useState<number | null>(result?.selected ?? null);
  const marks = block.markUrl ? urlDomainMarks(block.markUrl) : null;

  // „Wybierz odpowiedź” w miejscu „Dalej” (D-187); po odpowiedzi pasek wraca do „Dalej”. Własny przycisk tylko bez paska odtwarzacza.
  const inBar = useHasBarAction();
  useBarAction(
    readOnly ? null : { label: 'Wybierz odpowiedź', enabled: selected !== null && !disabled, run: () => selected !== null && onSubmit?.(selected) },
  );

  // Zła odpowiedź: ostrzeżenie dymkiem jak w innych blokach ocenianych (komentarz z treści jest pokazany na stronie, nie w dymku).
  useEffect(() => {
    if (result?.correct === false) hints.notify('wrong');
    // Jednorazowo przy pokazaniu wyniku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addressBar =
    marks && block.markUrl ? (
      <AddressMarker url={block.markUrl} step={2} slash={marks.slash} dot={marks.dot} onPick={() => undefined} />
    ) : (
      <span className="min-w-0 flex-1 break-all py-2.5 text-sm text-ink">{block.markUrl ?? ''}</span>
    );

  return (
    <DesktopStage contentBase={contentBase} background={block.background ?? ''} screen={block.backgroundScreen} label="Przeglądarka" still>
      <BrowserWindow tabTitle={block.page?.tabTitle ?? 'Nowa karta'} addressBar={addressBar} bodyClassName="">
        <div data-testid="page-task" className="border-b border-accent/30 bg-accent-soft px-4 py-3">
          <p id={promptId} className="block text-base font-semibold text-ink" data-monitor-prompt>
            {block.prompt}
          </p>
          {/* aria-disabled zamiast `disabled` na wyniku: wybrana odpowiedź zostaje czytelna, a zmiana jest zablokowana w onChange. */}
          <fieldset data-testid="page-quiz-options" aria-labelledby={promptId} disabled={disabled && !readOnly} className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {options.map((option, index) => {
              const chosen = selected === index;
              const tone = readOnly && chosen ? (result?.correct ? 'border-green-600 bg-green-50' : 'border-red-600 bg-red-50') : chosen ? 'border-accent bg-white' : 'border-border bg-white';
              return (
                <label
                  key={index}
                  data-testid="page-quiz-option"
                  // Węższe odpowiedzi (D-197, uwaga właściciela 2026-11-21): na szerokim ekranie najwyżej 380 px każda, od lewej - nie na
                  // całą szerokość okna; na telefonie jedna pod drugą na całą szerokość.
                  className={`flex min-h-[44px] flex-1 items-center gap-3 rounded-lg border-2 px-3 py-2 text-base text-ink sm:max-w-[380px]${tone} ${readOnly ? '' : 'cursor-pointer hover:border-accent'}`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    checked={chosen}
                    aria-disabled={readOnly || undefined}
                    onChange={() => {
                      if (!readOnly) setSelected(index);
                    }}
                    className="h-4 w-4 shrink-0"
                  />
                  <span>{option.text}</span>
                </label>
              );
            })}
          </fieldset>
          {readOnly && (
            <div role="status" data-testid="page-quiz-result" className="mt-3">
              {result?.correct !== undefined && (
                <p className={`text-base font-semibold ${result.correct ? 'text-green-700' : 'text-red-700'}`}>
                  {result.correct ? 'Poprawna odpowiedź!' : 'Niepoprawna odpowiedź.'}
                </p>
              )}
              {result?.reaction?.text && (
                <p data-testid="feedback-reaction" className="mt-1 text-sm text-slate-800">
                  {result.reaction.text}
                </p>
              )}
            </div>
          )}
          {!readOnly && !inBar && (
            <button
              type="button"
              disabled={selected === null || disabled}
              onClick={() => selected !== null && onSubmit?.(selected)}
              className="mt-3 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Wybierz odpowiedź
            </button>
          )}
        </div>
        {block.page && <FakeLoginPage page={block.page} compact />}
      </BrowserWindow>
    </DesktopStage>
  );
}

/** QUIZ pokazywany na fałszywej stronie na pulpicie (D-190) - komplet pól pilnuje walidacja treści. */
export function isPageQuiz(block: ContentBlock | undefined): boolean {
  return block?.type === 'QUIZ' && block.frame === 'monitor' && !!block.background;
}
