'use client';

import { useEffect, useId, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { CheckedOption, ClientProgressBlock, ContentBlock, SimpleCheck } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback, SimpleHint } from './SimpleFeedback';

// Wielokrotny wybór w trybie prostym (QUIZ `multiple`, D-158): pola wyboru i „Sprawdź” - serwer (/check) ocenia cały zbiór. Trafienie to
// dokładnie wszystkie poprawne; po próbie każda ZAZNACZONA odpowiedź dostaje ocenę i zdanie z treści (brakującej poprawnej serwer nie
// zdradza). Zmiana zaznaczenia czyści oceny poprzedniej próby; po 2 błędach - podpowiedź. „Dalej” w pasku po trafieniu (zapis bez odpowiedzi,
// wynik serwer liczy z PIERWSZEJ próby).

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const pickedOf = (check: SimpleCheck | undefined): number[] => (Array.isArray(check?.item) ? check.item : []);
const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value) => b.includes(value));

export default function SimpleMultiChoiceBlock({
  block,
  courseId,
  progress,
  onSubmit,
  onReady,
  onProgress,
  disabled = false,
}: {
  block: ContentBlock;
  courseId: string;
  progress?: ClientProgressBlock;
  onSubmit: (answer: undefined) => void;
  onReady: (submit: (() => void) | null) => void;
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
  disabled?: boolean;
}) {
  const promptId = useId();
  const options = block.options ?? [];
  const { checks, hint, pending, error, check } = useSimpleCheck(courseId, block.id ?? '', progress);
  const hit = checks.some((entry) => entry.result === 'good');
  const last = checks[checks.length - 1];
  // Po odświeżeniu strony w trakcie bloku zaznaczenie wraca z ostatniej próby (z jej ocenami).
  const [selected, setSelected] = useState<number[]>(() => pickedOf(last));
  const shown = last && sameSet(selected, pickedOf(last)) ? last : undefined;
  const marks = new Map<number, CheckedOption>((shown?.options ?? []).map((entry) => [entry.option, entry]));
  const alreadyChecked = checks.some((entry) => sameSet(selected, pickedOf(entry)));
  const locked = disabled || pending || hit;

  useEffect(() => {
    onReady(hit ? () => onSubmit(undefined) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit]);

  // Próby do podglądu „Wstecz” w tej samej sesji.
  useEffect(() => {
    if (checks.length > 0) onProgress?.({ checks, ...(hint ? { hint } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks, hint]);

  const toggle = (index: number) => {
    if (locked) return;
    setSelected((list) => (list.includes(index) ? list.filter((value) => value !== index) : [...list, index].sort((a, b) => a - b)));
  };

  return (
    <div data-testid="simple-multi-choice" className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p id={promptId} className="text-xl font-semibold text-ink">
          {block.prompt}
        </p>
        <p className="text-base text-muted">Zaznacz wszystkie poprawne odpowiedzi.</p>
      </div>
      <div role="group" aria-labelledby={promptId} className="flex flex-col gap-3">
        {options.map((option, index) => {
          const mark = marks.get(index);
          const checked = selected.includes(index);
          return (
            <label
              key={index}
              data-testid="simple-multi-option"
              data-result={mark?.result}
              className={`flex min-h-[56px] w-full items-start gap-3 rounded-btn border-2 px-4 py-3 text-left text-base font-semibold text-ink ${
                mark?.result === 'good'
                  ? 'border-success bg-success/10'
                  : mark?.result === 'bad'
                    ? 'border-danger/60 bg-danger/5'
                    : checked
                      ? 'border-accent bg-accent-soft'
                      : `border-border bg-surface ${locked ? '' : 'hover:border-accent hover:bg-paper'}`
              } ${locked ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                // aria-disabled zamiast `disabled` w trakcie sprawdzania i po trafieniu - fokus zostaje na polu (jak w zwykłym wyborze).
                disabled={disabled}
                aria-disabled={locked || undefined}
                onChange={() => toggle(index)}
                className={`mt-0.5 h-5 w-5 shrink-0 accent-accent ${FOCUS_RING}`}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-start gap-2">
                  {mark?.result === 'good' && <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />}
                  {mark?.result === 'bad' && <X aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />}
                  <span>{option.text}</span>
                </span>
                {mark && (
                  <span data-testid="simple-multi-feedback" className="text-base font-normal text-ink/80">
                    <span className="sr-only">{mark.result === 'good' ? 'Dobra odpowiedź: ' : 'Zła odpowiedź: '}</span>
                    {mark.feedback}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {!hit && (
        <div>
          <button
            type="button"
            data-testid="simple-multi-check"
            disabled={disabled || pending || selected.length === 0 || alreadyChecked}
            onClick={() => void check({ options: selected })}
            className={`min-h-[44px] rounded-btn bg-accent px-5 text-base font-bold text-white disabled:cursor-default disabled:opacity-50 ${FOCUS_RING}`}
          >
            Sprawdź
          </button>
        </div>
      )}
      <SimpleFeedback
        result={shown?.result ?? null}
        text={shown?.result === 'good' ? 'Zaznaczono wszystkie poprawne odpowiedzi.' : 'Popraw zaznaczenie i sprawdź jeszcze raz.'}
      />
      <SimpleHint text={hit ? undefined : hint} />
      <SimpleError text={error} />
    </div>
  );
}
