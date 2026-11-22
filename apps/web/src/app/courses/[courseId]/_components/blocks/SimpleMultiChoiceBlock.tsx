'use client';

import { useEffect, useId, useState } from 'react';
import type { ClientProgressBlock, ContentBlock, SimpleCheck } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback } from './SimpleFeedback';
import { OPTION, OptionFeedback, OptionMark, decidedMarks, optionTone, useRevealOnCheck } from './simple-option';
import MonitorStage from '../player/MonitorStage';

// Wielokrotny wybór w trybie prostym (QUIZ `multiple`, D-158; D-204): pola wyboru i „Sprawdź” - serwer (/check) ocenia cały zbiór, JEDNA
// próba rozstrzyga pytanie (dobrze = dokładnie wszystkie poprawne). Po niej każda zaznaczona odpowiedź dostaje ocenę i zdanie z treści,
// a poprawne niezaznaczone są pokazane na zielono („Poprawna odpowiedź”); „Dalej” w pasku od razu. Bez prób do skutku i podpowiedzi.
// Wygląd (szablon modułu, D-164): na ekranie monitora (MonitorStage), odpowiedzi A/B/C jak w pojedynczym wyborze - pole wyboru jest
// natywne, ale schowane (sr-only) za literą; zaznaczona odpowiedź fioletowa, po ocenie zielona/czerwona z ✓/✕ i zdaniem z treści.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const pickedOf = (check: SimpleCheck | undefined): number[] => (Array.isArray(check?.item) ? check.item : []);

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
  const { checks, pending, error, check } = useSimpleCheck(courseId, block.id ?? '', progress);
  // Rozstrzyga pierwsza próba (wpisy sprzed D-204 mogą mieć ich więcej - serwer pokazuje tylko pierwszą).
  const decided = checks[0];
  const marks = decidedMarks(decided);
  const revealRef = useRevealOnCheck(checks.length);
  // Po odświeżeniu strony zaznaczenie wraca z rozstrzygniętej próby.
  const [selected, setSelected] = useState<number[]>(() => pickedOf(decided));
  const locked = disabled || pending || decided !== undefined;

  useEffect(() => {
    onReady(decided ? () => onSubmit(undefined) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided !== undefined]);

  // Próba do podglądu „Wstecz” w tej samej sesji.
  useEffect(() => {
    if (checks.length > 0) onProgress?.({ checks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks]);

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
          <p id={`${promptId}-how`} lang="pl" className="text-base text-muted">
            Zaznacz wszystkie poprawne odpowiedzi i kliknij „Sprawdź”.
          </p>
        </div>
        <div role="group" aria-labelledby={promptId} aria-describedby={`${promptId}-how`} className="flex flex-col gap-2.5">
          {options.map((option, index) => {
            const mark = marks.get(index);
            const checked = selected.includes(index);
            return (
              <label
                key={index}
                data-testid="simple-multi-option"
                data-result={mark?.result}
                data-picked={mark ? String(mark.picked !== false) : undefined}
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
                  // aria-disabled zamiast `disabled` w trakcie sprawdzania i po rozstrzygnięciu - fokus zostaje na polu.
                  disabled={disabled}
                  aria-disabled={locked || undefined}
                  onChange={() => toggle(index)}
                  className="sr-only"
                />
                <OptionMark index={index} state={mark?.result ?? null} selected={checked} />
                <span className="flex min-w-0 flex-col gap-1">
                  <span>{option.text}</span>
                  {mark && <OptionFeedback mark={mark} testId="simple-multi-feedback" />}
                </span>
              </label>
            );
          })}
        </div>
        <div>
          {/* Po rozstrzygnięciu przycisk zostaje (aria-disabled, „Sprawdzone”) - fokus klawiatury i czytnika nie ucieka na początek strony. */}
          <button
            type="button"
            data-testid="simple-multi-check"
            disabled={disabled || (decided === undefined && (pending || selected.length === 0))}
            aria-disabled={decided !== undefined || undefined}
            onClick={() => {
              if (decided === undefined) void check({ options: selected });
            }}
            className={`min-h-[44px] rounded-[10px] bg-ink px-5 text-base font-bold text-white hover:bg-slate-800 disabled:cursor-default disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 ${FOCUS_RING}`}
          >
            {decided === undefined ? 'Sprawdź' : 'Sprawdzone'}
          </button>
        </div>
        <div ref={revealRef} lang="pl">
          <SimpleFeedback
            variant="plain"
            result={decided?.result ?? null}
            text={decided?.result === 'good' ? 'Zaznaczono wszystkie poprawne odpowiedzi.' : 'Poprawne odpowiedzi oznaczyliśmy znakiem ✓.'}
          />
        </div>
        <SimpleError text={error} />
      </div>
    </MonitorStage>
  );
}
