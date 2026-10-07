'use client';

import { useEffect, useId } from 'react';
import { Check, X } from 'lucide-react';
import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback, SimpleHint } from './SimpleFeedback';

// Wybór w trybie prostym (QUIZ, D-132): duże przyciski odpowiedzi; każde kliknięcie sprawdza serwer (/check) - od razu „Dobrze”/„Nie tym
// razem” i zdanie z treści. Błędna odpowiedź zostaje oznaczona i wyłączona, można próbować dalej; po 2 błędach - podpowiedź. „Dalej” w pasku
// po trafieniu (zapis z indeksem trafionej odpowiedzi; wynik serwer liczy z PIERWSZEJ próby). Bez wyniku w bloku.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export default function SimpleChoiceBlock({
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
  onSubmit: (answer: number) => void;
  onReady: (submit: (() => void) | null) => void;
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
  disabled?: boolean;
}) {
  const promptId = useId();
  const options = block.options ?? [];
  const { checks, hint, pending, error, check } = useSimpleCheck(courseId, block.id ?? '', progress);
  const hit = checks.find((entry) => entry.result === 'good');
  const hitIndex = typeof hit?.item === 'number' ? hit.item : null;
  const last = checks[checks.length - 1];

  useEffect(() => {
    onReady(hitIndex !== null ? () => onSubmit(hitIndex) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitIndex]);

  // Próby do podglądu „Wstecz” w tej samej sesji.
  useEffect(() => {
    if (checks.length > 0) onProgress?.({ checks, ...(hint ? { hint } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks, hint]);

  return (
    <div data-testid="simple-choice" className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <p id={promptId} className="text-xl font-semibold text-ink">
        {block.prompt}
      </p>
      <div role="group" aria-labelledby={promptId} className="flex flex-col gap-3">
        {options.map((option, index) => {
          const tried = checks.find((entry) => entry.item === index);
          const state = tried?.result ?? null;
          return (
            <button
              key={index}
              type="button"
              data-testid="simple-option"
              data-result={state ?? undefined}
              disabled={disabled || pending || hitIndex !== null || state !== null}
              onClick={() => void check({ option: index })}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-btn border-2 px-4 py-3 text-left text-base font-semibold ${FOCUS_RING} ${
                state === 'good'
                  ? 'border-success bg-success/10 text-ink'
                  : state === 'bad'
                    ? 'border-danger/60 bg-danger/5 text-ink/70'
                    : 'border-border bg-surface text-ink hover:border-accent hover:bg-paper'
              } disabled:cursor-default`}
            >
              {state === 'good' && <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-success" />}
              {state === 'bad' && <X aria-hidden="true" className="h-5 w-5 shrink-0 text-danger" />}
              <span>{option.text}</span>
              {state && <span className="sr-only">{state === 'good' ? ' - dobra odpowiedź' : ' - zła odpowiedź'}</span>}
            </button>
          );
        })}
      </div>
      <SimpleFeedback result={last?.result ?? null} text={last?.feedback} />
      <SimpleHint text={hitIndex === null ? hint : undefined} />
      <SimpleError text={error} />
    </div>
  );
}
