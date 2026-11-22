'use client';

import { useEffect, useId, useState } from 'react';
import type { CheckedOption, ClientProgressBlock, ContentBlock, SimpleCheck } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback, SimpleHint } from './SimpleFeedback';
import { OPTION, OptionMark, optionTone, useRevealOnCheck } from './simple-option';
import MonitorStage from '../player/MonitorStage';

// Wielokrotny wybór w trybie prostym (QUIZ `multiple`, D-158): pola wyboru i „Sprawdź” - serwer (/check) ocenia cały zbiór. Trafienie to
// dokładnie wszystkie poprawne; po próbie każda ZAZNACZONA odpowiedź dostaje ocenę i zdanie z treści (brakującej poprawnej serwer nie
// zdradza). Zmiana zaznaczenia czyści oceny poprzedniej próby; po 2 błędach - podpowiedź. „Dalej” w pasku po trafieniu (zapis bez odpowiedzi,
// wynik serwer liczy z PIERWSZEJ próby).
// Wygląd (szablon modułu, D-164): na ekranie monitora (MonitorStage), odpowiedzi A/B/C jak w pojedynczym wyborze - pole wyboru jest
// natywne, ale schowane (sr-only) za literą; zaznaczona odpowiedź fioletowa, po ocenie zielona/czerwona z ✓/✕ i zdaniem z treści.

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
  questionLabel,
  contentBase = '',
}: {
  /** „Pytanie 2 z 5” - numer wśród pytań quizu modułu (CoursePlayer). */
  questionLabel?: string;
  /** Baza adresów zasobów - ilustracja obok pytania (D-200). */
  contentBase?: string;
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
  const revealRef = useRevealOnCheck(checks.length);
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
    <MonitorStage label="Pytanie quizu" illustration={block.illustration} contentBase={contentBase}>
      <div data-testid="simple-multi-choice" className="flex flex-col gap-3">
        {/* Napisy interfejsu (polskie) w obszarze z `lang` języka treści - lang="pl" (WCAG 3.1.2). */}
        {questionLabel && (
          <p lang="pl" className="text-xs font-bold uppercase tracking-[0.08em] text-accent-ink">
            {questionLabel}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <p id={promptId} data-monitor-prompt className="text-xl font-bold leading-snug tracking-[-0.01em] text-ink">
            {block.prompt}
          </p>
          <p lang="pl" className="text-base text-muted">
            Zaznacz wszystkie poprawne odpowiedzi.
          </p>
        </div>
        <div role="group" aria-labelledby={promptId} className="flex flex-col gap-2.5">
          {options.map((option, index) => {
            const mark = marks.get(index);
            const checked = selected.includes(index);
            return (
              <label
                key={index}
                data-testid="simple-multi-option"
                data-result={mark?.result}
                // Fokus klawiatury na schowanym polu wyboru - obwódka na całej odpowiedzi.
                className={`${OPTION} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${optionTone(
                  mark?.result ?? null,
                  locked,
                  checked,
                )} ${locked ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  // aria-disabled zamiast `disabled` w trakcie sprawdzania i po trafieniu - fokus zostaje na polu (jak w zwykłym wyborze).
                  disabled={disabled}
                  aria-disabled={locked || undefined}
                  onChange={() => toggle(index)}
                  className="sr-only"
                />
                <OptionMark index={index} state={mark?.result ?? null} selected={checked} />
                <span className="flex min-w-0 flex-col gap-1">
                  <span>{option.text}</span>
                  {mark && (
                    <span data-testid="simple-multi-feedback" className="text-base font-normal">
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
              className={`min-h-[44px] rounded-[10px] bg-ink px-5 text-base font-bold text-white hover:bg-slate-800 disabled:cursor-default disabled:opacity-50 ${FOCUS_RING}`}
            >
              Sprawdź
            </button>
          </div>
        )}
        <div ref={revealRef} lang="pl">
          <SimpleFeedback
            variant="plain"
            result={shown?.result ?? null}
            text={shown?.result === 'good' ? 'Zaznaczono wszystkie poprawne odpowiedzi.' : 'Popraw zaznaczenie i sprawdź jeszcze raz.'}
          />
        </div>
        <SimpleHint text={hit ? undefined : hint} />
        <SimpleError text={error} />
      </div>
    </MonitorStage>
  );
}
